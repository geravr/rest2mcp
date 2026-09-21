import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServerPlaygroundTab } from "./playground-tab";

const invokeMutate = vi.fn();

vi.mock("@/hooks/use-mcp", () => ({
  useMcpTools: () => ({
    data: {
      items: [
        {
          id: "mct_1",
          name: "get_contact",
          method: "GET",
          enabled: true,
          allowMutation: false,
          params: [],
        },
        {
          id: "mct_2",
          name: "delete_contact",
          method: "DELETE",
          enabled: false,
          allowMutation: false,
          params: [],
        },
        {
          id: "mct_3",
          name: "create_contact",
          method: "POST",
          enabled: true,
          allowMutation: false,
          params: [],
        },
      ],
      page: 1,
      pageSize: 50,
      total: 3,
    },
    isLoading: false,
    isError: false,
    error: null,
  }),
  useInvokeMcpTool: () => ({
    mutate: invokeMutate,
    isPending: false,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children: React.ReactNode; to: string }) => (
    <a href={props.to}>{children}</a>
  ),
}));

function renderTab(
  props?: Partial<{
    serverStatus: "draft" | "live" | "paused";
    draftRevision: number;
    publishedRevisionNumber: number | null;
    publishedTools: Array<{
      id: string;
      name: string;
      method: string;
      allowMutation: boolean;
      params: Array<{
        name: string;
        type: string;
        required: boolean;
        sensitive: boolean;
      }>;
      requestDefinition?: Record<string, unknown> | null;
    }>;
  }>,
) {
  return render(
    <ServerPlaygroundTab
      serverId="mcs_1"
      serverStatus="live"
      draftRevision={4}
      publishedRevisionNumber={1}
      publishedTools={[
        {
          id: "mct_1",
          name: "get_contact",
          method: "GET",
          allowMutation: false,
          params: [],
        },
        {
          id: "mct_2",
          name: "delete_contact",
          method: "DELETE",
          allowMutation: false,
          params: [],
        },
        {
          id: "mct_3",
          name: "create_contact",
          method: "POST",
          allowMutation: false,
          params: [],
        },
      ]}
      {...props}
    />,
  );
}

describe("ServerPlaygroundTab", () => {
  beforeEach(() => {
    invokeMutate.mockReset();
  });

  it("shows HTTP 401 and body in the result panel", async () => {
    const user = userEvent.setup();
    invokeMutate.mockImplementation(
      (
        _input: unknown,
        options?: {
          onSuccess?: (payload: {
            ok: boolean;
            httpStatus: number;
            callLogId: string;
            envelope: { body?: string; data?: unknown };
          }) => void;
        },
      ) => {
        options?.onSuccess?.({
          ok: false,
          httpStatus: 401,
          callLogId: "log_1",
          envelope: { body: '{"error":"unauthorized"}' },
        });
      },
    );

    renderTab();

    await user.click(screen.getByRole("combobox", { name: /select a tool/i }));
    await user.click(screen.getByRole("option", { name: "get_contact" }));
    await user.click(screen.getByRole("button", { name: /invoke/i }));

    expect(screen.getByText(/HTTP 401/i)).toBeInTheDocument();
    expect(screen.getByText(/{"error":"unauthorized"}/)).toBeInTheDocument();
    expect(screen.getByText(/view call log/i)).toBeInTheDocument();
    expect(invokeMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "published",
        expectedDraftRevision: 4,
      }),
      expect.anything(),
    );
  });

  it("disables invoke for a disabled tool with an explanation", async () => {
    const user = userEvent.setup();
    renderTab({ publishedRevisionNumber: null });

    await user.click(screen.getByRole("combobox", { name: /select a tool/i }));
    await user.click(screen.getByRole("option", { name: "delete_contact" }));

    expect(screen.getByText(/tool is disabled/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /invoke/i })).toBeDisabled();
  });

  it("uses published metadata instead of draft state in published mode", async () => {
    const user = userEvent.setup();
    renderTab({
      publishedTools: [
        {
          id: "mct_2",
          name: "delete_contact_v2",
          method: "GET",
          allowMutation: false,
          params: [],
        },
      ],
    });

    await user.click(screen.getByRole("combobox", { name: /select a tool/i }));
    await user.click(screen.getByRole("option", { name: "delete_contact_v2" }));

    expect(screen.getByRole("button", { name: /invoke/i })).not.toBeDisabled();
  });

  it("explains paused servers and blocks published invoke", async () => {
    const user = userEvent.setup();
    renderTab({ serverStatus: "paused" });

    await user.click(screen.getByRole("combobox", { name: /select a tool/i }));
    await user.click(screen.getByRole("option", { name: "get_contact" }));

    expect(screen.getByText(/server is paused/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /invoke/i })).toBeDisabled();
  });

  it("explains mutation-blocked tools", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole("combobox", { name: /select a tool/i }));
    await user.click(screen.getByRole("option", { name: "create_contact" }));

    expect(screen.getByText(/mutations are not allowed/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /invoke/i })).toBeDisabled();
  });

  it("parses array playground arguments as JSON and rejects invalid JSON", async () => {
    const user = userEvent.setup();
    invokeMutate.mockImplementation(
      (
        _input: unknown,
        options?: {
          onSuccess?: (payload: {
            ok: boolean;
            httpStatus: number;
            callLogId: string | null;
            envelope: { body?: string; data?: unknown };
          }) => void;
        },
      ) => {
        options?.onSuccess?.({
          ok: true,
          httpStatus: 200,
          callLogId: null,
          envelope: { body: "ok" },
        });
      },
    );

    renderTab({
      publishedTools: [
        {
          id: "mct_1",
          name: "get_contact",
          method: "GET",
          allowMutation: false,
          params: [],
          requestDefinition: {
            version: 2,
            pathSegments: [
              { id: "path_1", value: { kind: "literal", value: "/contacts" } },
            ],
            query: [],
            headers: [],
            body: { bodyType: "none" },
            agentInputs: [
              {
                id: "ain_tags",
                name: "tags",
                required: true,
                sensitive: false,
                type: "array",
                items: { type: "string" },
              },
            ],
          },
        },
      ],
    });

    await user.click(screen.getByRole("combobox", { name: /select a tool/i }));
    await user.click(screen.getByRole("option", { name: "get_contact" }));

    const tags = screen.getByLabelText(/tags/i);
    await user.click(tags);
    await user.paste("not-json");
    await user.click(screen.getByRole("button", { name: /invoke/i }));
    expect(
      screen.getByText(/arguments must be valid JSON/i),
    ).toBeInTheDocument();
    expect(invokeMutate).not.toHaveBeenCalled();

    await user.clear(tags);
    await user.click(tags);
    await user.paste('["red","blue"]');
    await user.click(screen.getByRole("button", { name: /invoke/i }));
    expect(invokeMutate).toHaveBeenCalledWith(
      expect.objectContaining({ args: { tags: ["red", "blue"] } }),
      expect.anything(),
    );
  });

  it("clears the previous result panel on a new submit", async () => {
    const user = userEvent.setup();
    type EnvelopePayload = {
      ok: boolean;
      httpStatus: number;
      callLogId: string | null;
      envelope: { body?: string; data?: unknown };
    };
    invokeMutate
      .mockImplementationOnce(
        (
          _input: unknown,
          options?: { onSuccess?: (payload: EnvelopePayload) => void },
        ) => {
          options?.onSuccess?.({
            ok: true,
            httpStatus: 200,
            callLogId: null,
            envelope: { body: "first" },
          });
        },
      )
      .mockImplementationOnce(
        (
          _input: unknown,
          options?: { onSuccess?: (payload: EnvelopePayload) => void },
        ) => {
          options?.onSuccess?.({
            ok: true,
            httpStatus: 200,
            callLogId: null,
            envelope: { body: "second" },
          });
        },
      );

    renderTab();

    await user.click(screen.getByRole("combobox", { name: /select a tool/i }));
    await user.click(screen.getByRole("option", { name: "get_contact" }));
    await user.click(screen.getByRole("button", { name: /invoke/i }));
    expect(screen.getByText("first")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /invoke/i }));
    expect(screen.queryByText("first")).not.toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
  });

  it("defaults to draft preview when the server has no published revision", async () => {
    const user = userEvent.setup();
    renderTab({ publishedRevisionNumber: null });

    expect(screen.getByText(/testing draft revision 4/i)).toBeInTheDocument();
    expect(screen.getByText(/owner-only testing/i)).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: /select a tool/i }));
    await user.click(screen.getByRole("option", { name: "get_contact" }));
    await user.click(screen.getByRole("button", { name: /invoke/i }));

    expect(invokeMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "draft",
        expectedDraftRevision: 4,
      }),
      expect.anything(),
    );
  });

  it("switches to draft preview and passes the draft mode", async () => {
    const user = userEvent.setup();
    renderTab();

    expect(
      screen.getByText(/active published revision 1/i),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("combobox", { name: /execution source/i }),
    );
    await user.click(screen.getByRole("option", { name: /draft preview/i }));

    expect(screen.getByText(/testing draft revision 4/i)).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: /select a tool/i }));
    await user.click(screen.getByRole("option", { name: "get_contact" }));
    await user.click(screen.getByRole("button", { name: /invoke/i }));

    expect(invokeMutate).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "draft" }),
      expect.anything(),
    );
  });
});
