import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToolGroupDialog } from "./tool-group-dialog";

function group(toolCount = 3) {
  return {
    id: "mtg_1",
    name: "Invoices",
    normalizedName: "invoices",
    toolCount,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

const createMutate = vi.fn();
const renameMutate = vi.fn();
const deleteMutate = vi.fn();

vi.mock("@/hooks/use-mcp", () => ({
  // A real useState-backed mock so a failed mutation reactively drives the
  // inline error, mirroring TanStack Query's `error` state.
  useCreateMcpToolGroup: () => {
    const [error, setError] = useState<unknown>(null);
    return {
      mutate: (input: unknown, options?: unknown) => {
        const outcome = createMutate(input, options) as unknown;
        setError(outcome ?? null);
      },
      isPending: false,
      error,
    };
  },
  useRenameMcpToolGroup: () => ({
    mutate: renameMutate,
    isPending: false,
    error: null,
  }),
  useDeleteMcpToolGroup: () => ({
    mutate: deleteMutate,
    isPending: false,
    error: null,
  }),
}));

describe("ToolGroupDialog", () => {
  beforeEach(() => {
    createMutate.mockClear();
    renameMutate.mockClear();
    deleteMutate.mockClear();
    createMutate.mockReturnValue(undefined);
  });

  it("disables creation for an empty name", async () => {
    const user = userEvent.setup();
    render(
      <ToolGroupDialog serverId="mcs_1" mode="create" onClose={() => {}} />,
    );

    const submit = screen.getByRole("button", { name: /create group/i });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/group name/i), "Invoices");
    expect(submit).toBeEnabled();
  });

  it("disables creation for a name longer than 80 characters", async () => {
    const user = userEvent.setup();
    render(
      <ToolGroupDialog serverId="mcs_1" mode="create" onClose={() => {}} />,
    );

    await user.type(screen.getByLabelText(/group name/i), "a".repeat(81));
    expect(
      screen.getByRole("button", { name: /create group/i }),
    ).toBeDisabled();
  });

  it("submits create with the server id, revision, and trimmed name", async () => {
    const user = userEvent.setup();
    render(
      <ToolGroupDialog
        serverId="mcs_1"
        configRevision={4}
        mode="create"
        onClose={() => {}}
      />,
    );

    await user.type(screen.getByLabelText(/group name/i), "  Invoices  ");
    await user.click(screen.getByRole("button", { name: /create group/i }));

    expect(createMutate).toHaveBeenCalledWith(
      { serverId: "mcs_1", expectedRevision: 4, name: "Invoices" },
      expect.anything(),
    );
  });

  it("surfaces a localized message for a normalized-name conflict", async () => {
    createMutate.mockReturnValue({
      data: { appCode: "MCP_TOOL_GROUP_NAME_CONFLICT" },
      message: "A group with this name already exists on the server.",
    });
    const user = userEvent.setup();
    render(
      <ToolGroupDialog serverId="mcs_1" mode="create" onClose={() => {}} />,
    );

    await user.type(screen.getByLabelText(/group name/i), "invoices");
    await user.click(screen.getByRole("button", { name: /create group/i }));

    expect(
      screen.getByText(/a group with that name already exists on this server/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/a group with this name already exists/i),
    ).not.toBeInTheDocument();
  });

  it("prefills rename and submits the group id", async () => {
    const user = userEvent.setup();
    render(
      <ToolGroupDialog
        serverId="mcs_1"
        configRevision={2}
        mode="rename"
        group={group()}
        onClose={() => {}}
      />,
    );

    const input = screen.getByLabelText(/group name/i);
    expect(input).toHaveValue("Invoices");

    await user.clear(input);
    await user.type(input, "Billing");
    await user.click(screen.getByRole("button", { name: /rename group/i }));

    expect(renameMutate).toHaveBeenCalledWith(
      {
        serverId: "mcs_1",
        expectedRevision: 2,
        groupId: "mtg_1",
        name: "Billing",
      },
      expect.anything(),
    );
  });

  it("explains delete-to-ungroup behavior and submits the group id", async () => {
    const user = userEvent.setup();
    render(
      <ToolGroupDialog
        serverId="mcs_1"
        configRevision={2}
        mode="delete"
        group={group(3)}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText(/3 tools move to Ungrouped/i)).toBeInTheDocument();
    expect(screen.getByText(/are not deleted/i)).toBeInTheDocument();
    expect(
      screen.getByText(/published agent behavior are unchanged/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /delete group/i }));

    expect(deleteMutate).toHaveBeenCalledWith(
      { serverId: "mcs_1", expectedRevision: 2, groupId: "mtg_1" },
      expect.anything(),
    );
  });

  it("uses the singular delete copy for a one-tool group", () => {
    render(
      <ToolGroupDialog
        serverId="mcs_1"
        mode="delete"
        group={group(1)}
        onClose={() => {}}
      />,
    );

    expect(
      screen.getByText(/its single tool moves to Ungrouped/i),
    ).toBeInTheDocument();
  });

  it("explains the server limit instead of creating at 50 groups", () => {
    render(
      <ToolGroupDialog
        serverId="mcs_1"
        mode="create"
        groupCount={50}
        onClose={() => {}}
      />,
    );

    expect(
      screen.getByText(/already has 50 groups, the current limit/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create group/i }),
    ).toBeDisabled();
    expect(screen.getByLabelText(/group name/i)).toBeDisabled();
  });
});
