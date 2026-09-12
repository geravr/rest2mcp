import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteServerDialog } from "./delete-server-dialog";
import { DeleteToolDialog } from "./delete-tool-dialog";

const navigateMock = vi.fn();
const deleteServerMutate = vi.fn(
  (_input: unknown, options?: { onSuccess?: () => void }) => {
    options?.onSuccess?.();
  },
);
const deleteToolMutate = vi.fn(
  (_input: unknown, options?: { onSuccess?: () => void }) => {
    options?.onSuccess?.();
  },
);

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("@/hooks/use-mcp", () => ({
  useDeleteMcpServer: () => ({
    mutate: deleteServerMutate,
    isPending: false,
  }),
  useDeleteMcpTool: () => ({
    mutate: deleteToolMutate,
    isPending: false,
  }),
}));

describe("DeleteServerDialog", () => {
  beforeEach(() => {
    navigateMock.mockClear();
    deleteServerMutate.mockClear();
  });

  it("keeps the destructive action disabled until the name matches", async () => {
    const user = userEvent.setup();
    render(
      <DeleteServerDialog
        server={{ id: "mcs_1", name: "CRM" }}
        onClose={() => {}}
      />,
    );

    const confirmButton = screen.getByRole("button", {
      name: /delete permanently/i,
    });
    expect(confirmButton).toBeDisabled();

    await user.type(screen.getByPlaceholderText("CRM"), "CR");
    expect(confirmButton).toBeDisabled();

    await user.type(screen.getByPlaceholderText("CRM"), "M");
    expect(confirmButton).toBeEnabled();

    await user.click(confirmButton);
    expect(deleteServerMutate).toHaveBeenCalledWith(
      { serverId: "mcs_1" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(navigateMock).toHaveBeenCalledWith({ to: "/servers" });
  });
});

describe("DeleteToolDialog", () => {
  beforeEach(() => {
    deleteToolMutate.mockClear();
  });

  it("confirms deletion with a single click", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <DeleteToolDialog
        serverId="mcs_1"
        tool={{ id: "mct_1", name: "get_contact" }}
        onClose={onClose}
      />,
    );

    expect(screen.getByText(/get_contact/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(deleteToolMutate).toHaveBeenCalledWith(
      { serverId: "mcs_1", toolId: "mct_1" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(onClose).toHaveBeenCalled();
  });
});
