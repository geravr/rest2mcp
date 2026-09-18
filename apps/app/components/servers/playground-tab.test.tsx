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

    render(<ServerPlaygroundTab serverId="mcs_1" serverStatus="live" />);

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "get_contact" }));
    await user.click(screen.getByRole("button", { name: /invoke/i }));

    expect(screen.getByText(/HTTP 401/i)).toBeInTheDocument();
    expect(screen.getByText(/{"error":"unauthorized"}/)).toBeInTheDocument();
    expect(screen.getByText(/view call log/i)).toBeInTheDocument();
  });

  it("disables invoke for a disabled tool with an explanation", async () => {
    const user = userEvent.setup();
    render(<ServerPlaygroundTab serverId="mcs_1" serverStatus="live" />);

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "delete_contact" }));

    expect(screen.getByText(/tool is disabled/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /invoke/i })).toBeDisabled();
  });

  it("explains paused servers and blocks invoke", async () => {
    const user = userEvent.setup();
    render(<ServerPlaygroundTab serverId="mcs_1" serverStatus="paused" />);

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "get_contact" }));

    expect(screen.getByText(/server is paused/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /invoke/i })).toBeDisabled();
  });

  it("explains mutation-blocked tools", async () => {
    const user = userEvent.setup();
    render(<ServerPlaygroundTab serverId="mcs_1" serverStatus="live" />);

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "create_contact" }));

    expect(screen.getByText(/mutations are not allowed/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /invoke/i })).toBeDisabled();
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

    render(<ServerPlaygroundTab serverId="mcs_1" serverStatus="live" />);

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "get_contact" }));
    await user.click(screen.getByRole("button", { name: /invoke/i }));
    expect(screen.getByText("first")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /invoke/i }));
    expect(screen.queryByText("first")).not.toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
  });
});
