import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToolGroupMoveDialog } from "./tool-group-move-dialog";

function group() {
  return {
    id: "mtg_1",
    name: "Invoices",
    normalizedName: "invoices",
    toolCount: 2,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

const assignMutate = vi.fn();

vi.mock("@/hooks/use-mcp", () => ({
  useAssignMcpToolGroup: () => ({
    mutate: assignMutate,
    isPending: false,
    error: null,
  }),
}));

describe("ToolGroupMoveDialog", () => {
  beforeEach(() => {
    assignMutate.mockClear();
  });

  it("moves to Ungrouped by default and explains the single-tool scope", async () => {
    const user = userEvent.setup();
    render(
      <ToolGroupMoveDialog
        serverId="mcs_1"
        configRevision={3}
        groups={[group()]}
        toolId="tool_1"
        onClose={() => {}}
      />,
    );

    expect(
      screen.getByText(/move the selected tool to a group/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveTextContent("Ungrouped");

    await user.click(screen.getByRole("button", { name: /move tools/i }));

    expect(assignMutate).toHaveBeenCalledWith(
      {
        serverId: "mcs_1",
        expectedRevision: 3,
        toolIds: ["tool_1"],
        groupId: null,
      },
      expect.anything(),
    );
  });

  it("sends the selected group id", async () => {
    const user = userEvent.setup();
    render(
      <ToolGroupMoveDialog
        serverId="mcs_1"
        configRevision={3}
        groups={[group()]}
        toolId="tool_1"
        onClose={() => {}}
      />,
    );

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: /Invoices/ }));
    await user.click(screen.getByRole("button", { name: /move tools/i }));

    const [payload] = assignMutate.mock.calls[0] as [
      { toolIds: string[]; groupId: string | null },
      unknown,
    ];
    expect(payload.groupId).toBe("mtg_1");
    expect(payload.toolIds).toEqual(["tool_1"]);
  });
});
