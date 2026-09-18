import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToolFormDialog, type ToolFormTool } from "./tool-form-dialog";

type SaveOptions = {
  onSuccess?: (result: {
    id: string;
    compileIssues?: Array<{
      path: string;
      id?: string;
      code: string;
      message: string;
      severity: "error" | "warning";
    }>;
  }) => void;
};

type PreviewResult = {
  ok: boolean;
  issues: Array<{
    path: string;
    code: string;
    message: string;
    severity: "error" | "warning";
  }>;
  plan: unknown;
};

const createMutate = vi.fn<(input: unknown, options?: SaveOptions) => void>();
const updateMutate = vi.fn<(input: unknown, options?: SaveOptions) => void>();
const previewMutate = vi.fn<(input: unknown) => void>();
let previewResultQueue: PreviewResult[] = [];

const editorStateRef = vi.hoisted(() => ({
  value: undefined as
    | {
        data: unknown;
        isLoading: boolean;
        isError: boolean;
        error: null;
      }
    | undefined,
}));

vi.mock("@/hooks/use-mcp", () => ({
  useCreateMcpTool: () => ({ mutate: createMutate, isPending: false }),
  useUpdateMcpTool: () => ({ mutate: updateMutate, isPending: false }),
  useMcpToolEditorState: () =>
    editorStateRef.value ?? {
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
    },
  // A real useState-backed mock so `.data` reactively drives re-renders,
  // mirroring the real TanStack Query mutation hook's behavior.
  usePreviewToolCompile: () => {
    const [data, setData] = useState<PreviewResult | undefined>(undefined);
    return {
      data,
      isPending: false,
      mutate: (input: unknown) => {
        previewMutate(input);
        const next = previewResultQueue.shift();
        if (next) setData(next);
      },
    };
  },
}));

const toolFixture: ToolFormTool = {
  id: "mct_1",
  name: "get_contact",
  description: null,
  method: "GET",
  pathTemplate: "/contacts",
  requestTemplate: null,
  params: null,
  allowMutation: false,
  enabled: true,
};

async function selectOrigin(
  user: ReturnType<typeof userEvent.setup>,
  label: string | RegExp,
) {
  await user.click(screen.getByLabelText(/value origin/i));
  await user.click(screen.getByRole("option", { name: label }));
}

describe("ToolFormDialog", () => {
  beforeEach(() => {
    createMutate.mockReset();
    updateMutate.mockReset();
    previewMutate.mockReset();
    previewResultQueue = [];
    editorStateRef.value = undefined;
  });

  it("blocks enabling a tool once the preview reports a compile error", async () => {
    const user = userEvent.setup();
    previewResultQueue = [
      {
        ok: false,
        issues: [
          {
            path: "query.limit",
            code: "MCP_TEMPLATE_UNRESOLVED",
            message: "Placeholder has no declared source.",
            severity: "error",
          },
        ],
        plan: null,
      },
    ];

    render(
      <ToolFormDialog serverId="mcs_1" variableNames={[]} onClose={() => {}} />,
    );

    await user.type(screen.getByLabelText(/tool name/i), "search");
    await user.type(screen.getByLabelText(/^path$/i), "/search");

    expect(screen.getByLabelText(/^enabled$/i)).not.toBeDisabled();

    await user.click(
      screen.getByRole("button", { name: /effective request preview/i }),
    );
    await user.click(screen.getByRole("button", { name: /^preview$/i }));

    expect(previewMutate).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/no declared source/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^enabled$/i)).toBeDisabled();
  });

  it("switches to editing the saved tool when the create returns compile errors", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    createMutate.mockImplementation((_input, options) => {
      options?.onSuccess?.({
        id: "mct_new",
        compileIssues: [
          {
            path: "query[0]",
            id: "entry_1",
            code: "MCP_TEMPLATE_UNRESOLVED",
            message: "Agent input is not declared.",
            severity: "error",
          },
        ],
      });
    });
    updateMutate.mockImplementation((_input, options) => {
      options?.onSuccess?.({ id: "mct_new", compileIssues: [] });
    });

    render(
      <ToolFormDialog serverId="mcs_1" variableNames={[]} onClose={onClose} />,
    );

    expect(
      screen.getByRole("heading", { name: /add tool/i }),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText(/tool name/i), "get_contacts");
    await user.type(screen.getByLabelText(/^path$/i), "/contacts");
    await user.click(screen.getByRole("button", { name: /save tool/i }));

    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: /edit tool/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /save tool/i }));

    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        toolId: "mct_new",
        serverId: "mcs_1",
        name: "get_contacts",
      }),
      expect.anything(),
    );
    expect(createMutate).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it("prefills a _copy name on duplicate and saves through create", async () => {
    const user = userEvent.setup();
    createMutate.mockImplementation((_input, options) => {
      options?.onSuccess?.({ id: "mct_2" });
    });

    render(
      <ToolFormDialog
        serverId="mcs_1"
        variableNames={[]}
        tool={toolFixture}
        duplicate
        onClose={() => {}}
      />,
    );

    expect(screen.getByLabelText(/tool name/i)).toHaveValue("get_contact_copy");
    expect(
      screen.getByRole("heading", { name: /add tool/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /save tool/i }));

    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "get_contact_copy", serverId: "mcs_1" }),
      expect.anything(),
    );
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("compiles an Agent query row and does not render a Params section", async () => {
    const user = userEvent.setup();
    createMutate.mockImplementation((_input, options) => {
      options?.onSuccess?.({ id: "mct_new" });
    });

    render(
      <ToolFormDialog serverId="mcs_1" variableNames={[]} onClose={() => {}} />,
    );

    await user.type(screen.getByLabelText(/tool name/i), "search");
    await user.type(screen.getByLabelText(/^path$/i), "/search");
    await user.click(screen.getByRole("button", { name: /add row/i }));
    await user.type(screen.getByLabelText(/^key$/i), "locationId");
    await selectOrigin(user, /^agent$/i);
    await user.type(
      screen.getByPlaceholderText(/what is this value/i),
      "Location to search",
    );

    expect(screen.queryByText(/^params$/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /save tool/i }));

    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        requestDefinition: expect.objectContaining({
          query: [
            expect.objectContaining({
              name: "locationId",
              value: expect.objectContaining({ kind: "agentInput" }),
            }),
          ],
          agentInputs: [
            expect.objectContaining({
              name: "location_id",
              description: "Location to search",
            }),
          ],
        }),
      }),
      expect.anything(),
    );
  });

  it("compiles a Variable header with a prefix", async () => {
    const user = userEvent.setup();
    createMutate.mockImplementation((_input, options) => {
      options?.onSuccess?.({ id: "mct_new" });
    });

    render(
      <ToolFormDialog
        serverId="mcs_1"
        variableNames={["api_token"]}
        onClose={() => {}}
      />,
    );

    await user.type(screen.getByLabelText(/tool name/i), "auth");
    await user.type(screen.getByLabelText(/^path$/i), "/me");
    await user.click(screen.getByRole("tab", { name: /headers/i }));
    await user.click(screen.getByRole("button", { name: /add row/i }));
    await user.type(screen.getByLabelText(/^key$/i), "Authorization");
    await selectOrigin(user, /^variable$/i);
    expect(screen.getByLabelText(/^prefix$/i)).toHaveValue("Bearer ");
    await user.click(screen.getByRole("button", { name: /select variable/i }));
    await user.click(screen.getByRole("menuitem", { name: "api_token" }));
    await user.click(screen.getByRole("button", { name: /save tool/i }));

    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        requestDefinition: expect.objectContaining({
          headers: [
            expect.objectContaining({
              name: "Authorization",
              value: expect.objectContaining({
                kind: "serverValue",
                prefix: "Bearer ",
              }),
            }),
          ],
          agentInputs: [],
        }),
      }),
      expect.anything(),
    );
  });

  it("infers an unknown query placeholder as Agent with stored description", async () => {
    const user = userEvent.setup();
    render(
      <ToolFormDialog
        serverId="mcs_1"
        variableNames={["api_token"]}
        tool={{
          ...toolFixture,
          requestTemplate: { query: { q: "{{search}}" } },
          params: [
            {
              name: "search",
              description: "Free-text query",
              type: "string",
              required: true,
            },
          ],
        }}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText(/agent argument search/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/what is this value/i)).toHaveValue(
      "Free-text query",
    );
    await user.click(screen.getByRole("tab", { name: /query/i }));
    expect(screen.getByLabelText(/^key$/i)).toHaveValue("q");
  });

  it("infers a prefixed bearer header as Variable", async () => {
    render(
      <ToolFormDialog
        serverId="mcs_1"
        variableNames={["api_token"]}
        tool={{
          ...toolFixture,
          requestTemplate: {
            headers: { Authorization: "Bearer {{api_token}}" },
          },
        }}
        onClose={() => {}}
      />,
    );

    await userEvent
      .setup()
      .click(screen.getByRole("tab", { name: /headers/i }));

    expect(screen.getByLabelText(/^prefix$/i)).toHaveValue("Bearer ");
    expect(
      screen.getByRole("button", { name: /api_token/i }),
    ).toBeInTheDocument();
  });

  it("shows Advanced for a nested JSON body", async () => {
    const user = userEvent.setup();
    render(
      <ToolFormDialog
        serverId="mcs_1"
        variableNames={[]}
        tool={{
          ...toolFixture,
          requestTemplate: {
            bodyType: "json",
            body: '{"user":{"id":1}}',
          },
        }}
        onClose={() => {}}
      />,
    );

    await user.click(screen.getByRole("tab", { name: /body/i }));

    expect(screen.getByDisplayValue('{"user":{"id":1}}')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^key$/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^fields$/i })).toBeDisabled();
  });

  it("keeps the dialog open when Escape closes an open variable listbox", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <ToolFormDialog
        serverId="mcs_1"
        variableNames={["api_token"]}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole("tab", { name: /body/i }));
    await user.click(screen.getByLabelText(/body type/i));
    await user.click(screen.getByRole("option", { name: /^raw$/i }));

    const textarea = screen.getByPlaceholderText(
      /raw body/i,
    ) as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(textarea, "{{");
    textarea.setSelectionRange(2, 2);
    fireEvent.change(textarea);

    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.keyDown(textarea, { key: "Escape" });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: /add tool/i }),
    ).toBeInTheDocument();
  });

  it("closes the dialog with Escape when no overlay menu is open", () => {
    const onClose = vi.fn();
    render(
      <ToolFormDialog
        serverId="mcs_1"
        variableNames={["api_token"]}
        onClose={onClose}
      />,
    );

    fireEvent.keyDown(screen.getByLabelText(/tool name/i), { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
  });

  it("shows tab counts for query, headers, and body", async () => {
    const user = userEvent.setup();
    render(
      <ToolFormDialog
        serverId="mcs_1"
        variableNames={[]}
        tool={{
          ...toolFixture,
          requestTemplate: {
            query: { q: "hello" },
            headers: { Accept: "application/json" },
            bodyType: "json",
            body: '{"name":"test"}',
          },
        }}
        onClose={() => {}}
      />,
    );

    expect(screen.getByRole("tab", { name: /query 1/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /headers 1/i })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /body/i }));
    expect(screen.getByRole("tab", { name: /body 1/i })).toBeInTheDocument();
  });

  it("shows a body-none empty message", async () => {
    const user = userEvent.setup();
    render(
      <ToolFormDialog serverId="mcs_1" variableNames={[]} onClose={() => {}} />,
    );

    await user.click(screen.getByRole("tab", { name: /body/i }));
    expect(screen.getByText(/this request has no body/i)).toBeInTheDocument();
  });

  it("confirms discard when the form is dirty and the user cancels", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <ToolFormDialog serverId="mcs_1" variableNames={[]} onClose={onClose} />,
    );

    await user.type(screen.getByLabelText(/tool name/i), "draft_tool");
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/discard this tool/i)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /add tool/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^discard$/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the form open when discard is cancelled", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <ToolFormDialog serverId="mcs_1" variableNames={[]} onClose={onClose} />,
    );

    await user.type(screen.getByLabelText(/tool name/i), "draft_tool");
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    const cancelButtons = screen.getAllByRole("button", { name: /^cancel$/i });
    await user.click(cancelButtons[cancelButtons.length - 1] as HTMLElement);

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/tool name/i)).toHaveValue("draft_tool");
    expect(
      screen.getByRole("button", { name: /save tool/i }),
    ).toBeInTheDocument();
  });

  it("loads a typed definition directly and preserves node ids on save", async () => {
    const user = userEvent.setup();
    const typedTool: ToolFormTool = {
      ...toolFixture,
      requestDefinition: {
        version: 1,
        pathSegments: [
          { id: "path_1", value: { kind: "literal", value: "/contacts" } },
          {
            id: "path_2",
            value: { kind: "agentInput", agentInputId: "ain_1" },
          },
        ],
        query: [
          {
            id: "query_1",
            name: "limit",
            value: { kind: "serverValue", serverValueId: "msv_1" },
          },
        ],
        headers: [],
        body: { bodyType: "none" },
        agentInputs: [
          {
            id: "ain_1",
            name: "id",
            required: true,
            sensitive: false,
            type: "string",
          },
        ],
      },
    };
    updateMutate.mockImplementation((_input, options) => {
      options?.onSuccess?.({ id: "mct_1", compileIssues: [] });
    });

    render(
      <ToolFormDialog
        serverId="mcs_1"
        variableNames={["api_token"]}
        variables={[{ id: "msv_1", name: "api_token", kind: "secret" }]}
        tool={typedTool}
        onClose={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: /save tool/i }));

    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        requestDefinition: expect.objectContaining({
          pathSegments: expect.arrayContaining([
            expect.objectContaining({ id: "path_2" }),
          ]),
          query: [
            expect.objectContaining({
              id: "query_1",
              value: { kind: "serverValue", serverValueId: "msv_1" },
            }),
          ],
          agentInputs: [expect.objectContaining({ id: "ain_1", name: "id" })],
        }),
      }),
      expect.anything(),
    );
  });

  it("renders a backend conversion draft for a legacy-only tool", () => {
    editorStateRef.value = {
      data: {
        toolId: "mct_1",
        typed: false,
        definition: null,
        issues: [],
        conversionDraft: {
          version: 1,
          pathSegments: [
            { id: "path_1", value: { kind: "literal", value: "/legacy" } },
          ],
          query: [],
          headers: [],
          body: { bodyType: "none" },
          agentInputs: [],
        },
        conversionIssues: [
          {
            path: "query[0]",
            id: "query_1",
            code: "MCP_TEMPLATE_UNRESOLVED",
            message: "Ambiguous source.",
            severity: "error",
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
    };

    render(
      <ToolFormDialog
        serverId="mcs_1"
        variableNames={[]}
        tool={toolFixture}
        onClose={() => {}}
      />,
    );

    expect(screen.getByLabelText(/^path$/i)).toHaveValue("/legacy");
    expect(screen.getByText(/ambiguous source/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^enabled$/i)).toBeDisabled();
  });

  it("redacts secret values in the effective-request preview", async () => {
    const user = userEvent.setup();
    previewResultQueue = [
      {
        ok: true,
        issues: [],
        plan: {
          annotations: { readOnlyHint: true },
          headers: [
            {
              name: "Authorization",
              source: { kind: "serverValue", serverValueId: "msv_1" },
            },
          ],
          query: [],
          agentInputs: [],
        },
      },
    ];

    render(
      <ToolFormDialog
        serverId="mcs_1"
        variableNames={["api_token"]}
        variables={[{ id: "msv_1", name: "api_token", kind: "secret" }]}
        onClose={() => {}}
      />,
    );

    await user.type(screen.getByLabelText(/tool name/i), "auth");
    await user.type(screen.getByLabelText(/^path$/i), "/me");
    await user.click(screen.getByRole("tab", { name: /headers/i }));
    await user.click(screen.getByRole("button", { name: /add row/i }));
    await user.type(screen.getByLabelText(/^key$/i), "Authorization");
    await selectOrigin(user, /^variable$/i);
    await user.click(screen.getByRole("button", { name: /select variable/i }));
    await user.click(screen.getByRole("menuitem", { name: "api_token" }));

    await user.click(
      screen.getByRole("button", { name: /effective request preview/i }),
    );
    await user.click(screen.getByRole("button", { name: /^preview$/i }));

    expect(screen.getByText(/•••• \(secret value\)/i)).toBeInTheDocument();
    expect(screen.queryByText(/super-secret/i)).not.toBeInTheDocument();
  });
});
