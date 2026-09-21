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
  ready?: boolean;
  issues: Array<{
    path: string;
    code: string;
    message: string;
    severity: "error" | "warning";
  }>;
  plan: unknown;
  contract?: unknown;
};

const createMutate = vi.fn<(input: unknown, options?: SaveOptions) => void>();
const updateMutate = vi.fn<(input: unknown, options?: SaveOptions) => void>();
const previewMutate = vi.fn<(input: unknown) => void>();
let previewResultQueue: PreviewResult[] = [];

vi.mock("@/hooks/use-mcp", () => ({
  useCreateMcpTool: () => ({ mutate: createMutate, isPending: false }),
  useUpdateMcpTool: () => ({ mutate: updateMutate, isPending: false }),
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
  requestDefinition: {
    version: 2,
    pathSegments: [
      { id: "path_1", value: { kind: "literal", value: "/contacts" } },
    ],
    query: [],
    headers: [],
    body: { bodyType: "none" },
    agentInputs: [],
  },
  allowMutation: false,
  enabled: true,
};

function group(id: string, name: string) {
  return {
    id,
    name,
    normalizedName: name.toLowerCase(),
    toolCount: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

const groupsFixture = [group("mtg_1", "Invoices"), group("mtg_2", "Contacts")];

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

  it("loads a typed agent-input query binding with its registry metadata", async () => {
    const user = userEvent.setup();
    render(
      <ToolFormDialog
        serverId="mcs_1"
        variableNames={["api_token"]}
        tool={{
          ...toolFixture,
          requestDefinition: {
            version: 2,
            pathSegments: [
              { id: "path_1", value: { kind: "literal", value: "/contacts" } },
            ],
            query: [
              {
                id: "q1",
                name: "q",
                value: { kind: "agentInput", agentInputId: "ain_1" },
              },
            ],
            headers: [],
            body: { bodyType: "none" },
            agentInputs: [
              {
                id: "ain_1",
                name: "search",
                required: true,
                type: "string",
                description: "Free-text query",
              },
            ],
          },
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

  it("loads a typed server-value header binding with its prefix", async () => {
    render(
      <ToolFormDialog
        serverId="mcs_1"
        variableNames={["api_token"]}
        variables={[{ id: "msv_1", name: "api_token", kind: "secret" }]}
        tool={{
          ...toolFixture,
          requestDefinition: {
            version: 2,
            pathSegments: [
              { id: "path_1", value: { kind: "literal", value: "/contacts" } },
            ],
            query: [],
            headers: [
              {
                id: "h1",
                name: "Authorization",
                value: {
                  kind: "serverValue",
                  serverValueId: "msv_1",
                  prefix: "Bearer ",
                },
              },
            ],
            body: { bodyType: "none" },
            agentInputs: [],
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
          requestDefinition: {
            version: 2,
            pathSegments: [
              { id: "path_1", value: { kind: "literal", value: "/contacts" } },
            ],
            query: [],
            headers: [],
            body: {
              bodyType: "json",
              root: {
                kind: "object",
                fields: [
                  {
                    id: "f1",
                    key: "user",
                    value: {
                      kind: "object",
                      fields: [
                        {
                          id: "f2",
                          key: "id",
                          value: {
                            kind: "literal",
                            jsonType: "number",
                            value: 1,
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
            agentInputs: [],
          },
        }}
        onClose={() => {}}
      />,
    );

    await user.click(screen.getByRole("tab", { name: /body/i }));

    expect(screen.getByDisplayValue(/"user"/)).toBeInTheDocument();
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
          requestDefinition: {
            version: 2,
            pathSegments: [
              { id: "path_1", value: { kind: "literal", value: "/contacts" } },
            ],
            query: [
              {
                id: "q1",
                name: "q",
                value: { kind: "literal", value: "hello" },
              },
            ],
            headers: [
              {
                id: "h1",
                name: "Accept",
                value: { kind: "literal", value: "application/json" },
              },
            ],
            body: {
              bodyType: "json",
              root: {
                kind: "object",
                fields: [
                  {
                    id: "f1",
                    key: "name",
                    value: {
                      kind: "literal",
                      jsonType: "string",
                      value: "test",
                    },
                  },
                ],
              },
            },
            agentInputs: [],
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
        version: 2,
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

  it("shows repeated versus delimited query array serialization in the preview", async () => {
    const user = userEvent.setup();
    const queryPlan = (explode: boolean) => ({
      annotations: { readOnlyHint: true },
      headers: [],
      query: [
        {
          name: "tags",
          source: { kind: "agentInput", agentInputId: "ain_tags" },
          serialization: { style: "form", explode },
        },
      ],
      agentInputs: [{ id: "ain_tags", name: "tags" }],
    });
    previewResultQueue = [
      { ok: true, issues: [], plan: queryPlan(true) },
      { ok: true, issues: [], plan: queryPlan(false) },
    ];

    render(
      <ToolFormDialog serverId="mcs_1" variableNames={[]} onClose={() => {}} />,
    );

    await user.type(screen.getByLabelText(/tool name/i), "list_tags");
    await user.type(screen.getByLabelText(/^path$/i), "/tags");
    await user.click(
      screen.getByRole("button", { name: /effective request preview/i }),
    );
    await user.click(screen.getByRole("button", { name: /^preview$/i }));
    expect(screen.getByText(/repeated keys/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^preview$/i }));
    expect(screen.getByText(/comma-delimited/i)).toBeInTheDocument();
    expect(screen.queryByText(/repeated keys/i)).not.toBeInTheDocument();
  });

  it("sends the tool title on save and in preview", async () => {
    const user = userEvent.setup();
    createMutate.mockImplementation((_input, options) => {
      options?.onSuccess?.({ id: "mct_new" });
    });
    previewResultQueue = [{ ok: true, issues: [], plan: null }];

    render(
      <ToolFormDialog serverId="mcs_1" variableNames={[]} onClose={() => {}} />,
    );

    await user.type(screen.getByLabelText(/^title$/i), "Get contact");
    await user.type(screen.getByLabelText(/tool name/i), "get_contact");
    await user.type(screen.getByLabelText(/^path$/i), "/contacts");

    await user.click(
      screen.getByRole("button", { name: /effective request preview/i }),
    );
    await user.click(screen.getByRole("button", { name: /^preview$/i }));

    expect(previewMutate).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Get contact" }),
    );

    await user.click(screen.getByRole("button", { name: /save tool/i }));

    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Get contact" }),
      expect.anything(),
    );
  });

  it("prefills the existing title on duplicate", async () => {
    const user = userEvent.setup();
    createMutate.mockImplementation((_input, options) => {
      options?.onSuccess?.({ id: "mct_2" });
    });

    render(
      <ToolFormDialog
        serverId="mcs_1"
        variableNames={[]}
        tool={{ ...toolFixture, title: "Get contact" }}
        duplicate
        onClose={() => {}}
      />,
    );

    expect(screen.getByLabelText(/^title$/i)).toHaveValue("Get contact");

    await user.click(screen.getByRole("button", { name: /save tool/i }));

    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Get contact" }),
      expect.anything(),
    );
  });

  it("marks a duplicate dirty when only the title changes", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <ToolFormDialog
        serverId="mcs_1"
        variableNames={[]}
        tool={{ ...toolFixture, title: "Get contact" }}
        duplicate
        onClose={onClose}
      />,
    );

    await user.type(screen.getByLabelText(/^title$/i), " updated");
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/discard this tool/i)).toBeInTheDocument();
  });

  it("derives fixed read-only annotations for read methods", async () => {
    const user = userEvent.setup();
    createMutate.mockImplementation((_input, options) => {
      options?.onSuccess?.({ id: "mct_new" });
    });

    render(
      <ToolFormDialog serverId="mcs_1" variableNames={[]} onClose={() => {}} />,
    );

    await user.type(screen.getByLabelText(/tool name/i), "get_contacts");
    await user.type(screen.getByLabelText(/^path$/i), "/contacts");

    expect(screen.queryByLabelText(/^destructive$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^idempotent$/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /save tool/i }));

    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        requestDefinition: expect.objectContaining({
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
          },
        }),
      }),
      expect.anything(),
    );
  });

  it("sends destructive and idempotent hints for a DELETE tool", async () => {
    const user = userEvent.setup();
    createMutate.mockImplementation((_input, options) => {
      options?.onSuccess?.({ id: "mct_new" });
    });

    render(
      <ToolFormDialog serverId="mcs_1" variableNames={[]} onClose={() => {}} />,
    );

    await user.type(screen.getByLabelText(/tool name/i), "delete_contact");
    await user.type(screen.getByLabelText(/^path$/i), "/contacts/1");
    await user.click(screen.getByLabelText(/^method$/i));
    await user.click(screen.getByRole("option", { name: /^delete$/i }));

    expect(screen.getByLabelText(/^destructive$/i)).toBeChecked();
    expect(screen.getByLabelText(/^idempotent$/i)).toBeChecked();

    await user.click(screen.getByRole("button", { name: /save tool/i }));

    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        requestDefinition: expect.objectContaining({
          annotations: expect.objectContaining({
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: true,
            openWorldHint: true,
          }),
        }),
      }),
      expect.anything(),
    );
  });

  it("lets the owner toggle destructive and idempotent hints", async () => {
    const user = userEvent.setup();
    createMutate.mockImplementation((_input, options) => {
      options?.onSuccess?.({ id: "mct_new" });
    });

    render(
      <ToolFormDialog serverId="mcs_1" variableNames={[]} onClose={() => {}} />,
    );

    await user.type(screen.getByLabelText(/tool name/i), "create_contact");
    await user.type(screen.getByLabelText(/^path$/i), "/contacts");
    await user.click(screen.getByLabelText(/^method$/i));
    await user.click(screen.getByRole("option", { name: /^post$/i }));

    expect(screen.getByLabelText(/^destructive$/i)).not.toBeChecked();
    expect(screen.getByLabelText(/^idempotent$/i)).not.toBeChecked();
    await user.click(screen.getByLabelText(/^destructive$/i));
    await user.click(screen.getByLabelText(/^idempotent$/i));

    await user.click(screen.getByRole("button", { name: /save tool/i }));

    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        requestDefinition: expect.objectContaining({
          annotations: expect.objectContaining({
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: true,
            openWorldHint: true,
          }),
        }),
      }),
      expect.anything(),
    );
  });

  it("renders the agent-visible contract preview", async () => {
    const user = userEvent.setup();
    previewResultQueue = [
      {
        ok: true,
        issues: [],
        plan: null,
        contract: {
          name: "get_contact",
          title: "Get contact",
          description: "Fetch a contact by id.",
          method: "GET",
          contractVersion: 2,
          inputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
              contact_id: {
                type: "string",
                description: "Contact to fetch",
                format: "uuid",
              },
            },
            required: ["contact_id"],
          },
          outputSchema: { type: "object", properties: {} },
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
          },
          metadata: {
            "io.rest2mcp/contract": { version: 2, fingerprint: "sha256:abc" },
          },
          fingerprint: "sha256:abc",
        },
      },
    ];

    render(
      <ToolFormDialog serverId="mcs_1" variableNames={[]} onClose={() => {}} />,
    );

    await user.type(screen.getByLabelText(/tool name/i), "get_contact");
    await user.type(screen.getByLabelText(/^path$/i), "/contacts");
    await user.click(
      screen.getByRole("button", { name: /effective request preview/i }),
    );
    await user.click(screen.getByRole("button", { name: /^preview$/i }));

    expect(screen.getByText(/agent contract/i)).toBeInTheDocument();
    expect(screen.getByText("sha256:abc")).toBeInTheDocument();
    expect(screen.getByText("contact_id")).toBeInTheDocument();
    expect(screen.getByText(/contact to fetch/i)).toBeInTheDocument();
    expect(
      screen.getByText(/structured output is advertised/i),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/read-only/i).length).toBeGreaterThan(0);
  });

  it("saves a string agent input format", async () => {
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
    await user.type(screen.getByLabelText(/^key$/i), "email");
    await selectOrigin(user, /^agent$/i);
    await user.type(
      screen.getByPlaceholderText(/what is this value/i),
      "Email to search",
    );
    await user.click(screen.getByLabelText(/input format/i));
    await user.click(screen.getByRole("option", { name: /^email$/i }));

    await user.click(screen.getByRole("button", { name: /save tool/i }));

    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        requestDefinition: expect.objectContaining({
          agentInputs: [
            expect.objectContaining({
              name: "email",
              description: "Email to search",
              format: "email",
            }),
          ],
        }),
      }),
      expect.anything(),
    );
  });

  it("sends the selected group when creating a manual tool", async () => {
    const user = userEvent.setup();
    createMutate.mockImplementation((_input, options) => {
      options?.onSuccess?.({ id: "mct_new" });
    });

    render(
      <ToolFormDialog
        serverId="mcs_1"
        variableNames={[]}
        groups={groupsFixture}
        onClose={() => {}}
      />,
    );

    expect(screen.getByLabelText(/^group$/i)).toHaveTextContent("Ungrouped");

    await user.type(screen.getByLabelText(/tool name/i), "list_invoices");
    await user.type(screen.getByLabelText(/^path$/i), "/invoices");
    await user.click(screen.getByLabelText(/^group$/i));
    await user.click(screen.getByRole("option", { name: "Invoices" }));
    await user.click(screen.getByRole("button", { name: /save tool/i }));

    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: "mtg_1" }),
      expect.anything(),
    );
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("sends a null group when Ungrouped is chosen on create", async () => {
    const user = userEvent.setup();
    createMutate.mockImplementation((_input, options) => {
      options?.onSuccess?.({ id: "mct_new" });
    });

    render(
      <ToolFormDialog
        serverId="mcs_1"
        variableNames={[]}
        groups={groupsFixture}
        onClose={() => {}}
      />,
    );

    await user.type(screen.getByLabelText(/tool name/i), "list_invoices");
    await user.type(screen.getByLabelText(/^path$/i), "/invoices");
    await user.click(screen.getByLabelText(/^group$/i));
    await user.click(screen.getByRole("option", { name: "Ungrouped" }));
    await user.click(screen.getByRole("button", { name: /save tool/i }));

    const [payload] = createMutate.mock.calls[0] as [
      Record<string, unknown>,
      unknown,
    ];
    expect("groupId" in payload).toBe(true);
    expect(payload.groupId).toBeNull();
  });

  it("preselects the active group filter on create", async () => {
    const user = userEvent.setup();
    createMutate.mockImplementation((_input, options) => {
      options?.onSuccess?.({ id: "mct_new" });
    });

    render(
      <ToolFormDialog
        serverId="mcs_1"
        variableNames={[]}
        groups={groupsFixture}
        initialGroupId="mtg_2"
        onClose={() => {}}
      />,
    );

    expect(screen.getByLabelText(/^group$/i)).toHaveTextContent("Contacts");

    await user.type(screen.getByLabelText(/tool name/i), "list_contacts");
    await user.type(screen.getByLabelText(/^path$/i), "/contacts");
    await user.click(screen.getByRole("button", { name: /save tool/i }));

    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: "mtg_2" }),
      expect.anything(),
    );
  });

  it("keeps the source group when duplicating a grouped tool", async () => {
    const user = userEvent.setup();
    createMutate.mockImplementation((_input, options) => {
      options?.onSuccess?.({ id: "mct_2" });
    });

    render(
      <ToolFormDialog
        serverId="mcs_1"
        variableNames={[]}
        groups={groupsFixture}
        tool={{ ...toolFixture, groupId: "mtg_1" }}
        duplicate
        onClose={() => {}}
      />,
    );

    expect(screen.getByLabelText(/^group$/i)).toHaveTextContent("Invoices");

    await user.click(screen.getByRole("button", { name: /save tool/i }));

    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: "mtg_1" }),
      expect.anything(),
    );
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("omits groupId when an edit leaves the group selector untouched", async () => {
    const user = userEvent.setup();
    updateMutate.mockImplementation((_input, options) => {
      options?.onSuccess?.({ id: "mct_1", compileIssues: [] });
    });

    render(
      <ToolFormDialog
        serverId="mcs_1"
        variableNames={[]}
        groups={groupsFixture}
        tool={{ ...toolFixture, groupId: "mtg_1" }}
        onClose={() => {}}
      />,
    );

    expect(screen.getByLabelText(/^group$/i)).toHaveTextContent("Invoices");

    await user.click(screen.getByRole("button", { name: /save tool/i }));

    const [payload] = updateMutate.mock.calls[0] as [
      Record<string, unknown>,
      unknown,
    ];
    // Tri-state update contract: absent must mean "leave the assignment
    // unchanged", so the key has to be missing rather than undefined.
    expect("groupId" in payload).toBe(false);
    expect(payload.name).toBe("get_contact");
  });

  it("sends the new group when an edit changes the selection", async () => {
    const user = userEvent.setup();
    updateMutate.mockImplementation((_input, options) => {
      options?.onSuccess?.({ id: "mct_1", compileIssues: [] });
    });

    render(
      <ToolFormDialog
        serverId="mcs_1"
        variableNames={[]}
        groups={groupsFixture}
        tool={{ ...toolFixture, groupId: "mtg_1" }}
        onClose={() => {}}
      />,
    );

    await user.click(screen.getByLabelText(/^group$/i));
    await user.click(screen.getByRole("option", { name: "Contacts" }));
    await user.click(screen.getByRole("button", { name: /save tool/i }));

    const [payload] = updateMutate.mock.calls[0] as [
      Record<string, unknown>,
      unknown,
    ];
    expect(payload.groupId).toBe("mtg_2");
  });

  it("sends a null group when an edit moves the tool to Ungrouped", async () => {
    const user = userEvent.setup();
    updateMutate.mockImplementation((_input, options) => {
      options?.onSuccess?.({ id: "mct_1", compileIssues: [] });
    });

    render(
      <ToolFormDialog
        serverId="mcs_1"
        variableNames={[]}
        groups={groupsFixture}
        tool={{ ...toolFixture, groupId: "mtg_1" }}
        onClose={() => {}}
      />,
    );

    await user.click(screen.getByLabelText(/^group$/i));
    await user.click(screen.getByRole("option", { name: "Ungrouped" }));
    await user.click(screen.getByRole("button", { name: /save tool/i }));

    const [payload] = updateMutate.mock.calls[0] as [
      Record<string, unknown>,
      unknown,
    ];
    expect("groupId" in payload).toBe(true);
    expect(payload.groupId).toBeNull();
  });

  it("hides the group selector without groups or a preselect value", () => {
    render(
      <ToolFormDialog serverId="mcs_1" variableNames={[]} onClose={() => {}} />,
    );

    expect(screen.queryByLabelText(/^group$/i)).not.toBeInTheDocument();
  });
});
