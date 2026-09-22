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
const deleteToolsMutate = vi.fn(
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
  useDeleteMcpTools: () => ({
    mutate: deleteToolsMutate,
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
      { serverId: "mcs_1", expectedRevision: 1 },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(navigateMock).toHaveBeenCalledWith({ to: "/servers" });
  });
});

describe("DeleteToolDialog", () => {
  beforeEach(() => {
    deleteToolsMutate.mockClear();
  });

  it("confirms deletion with a single click", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <DeleteToolDialog
        serverId="mcs_1"
        tools={[{ id: "mct_1", name: "get_contact" }]}
        onClose={onClose}
      />,
    );

    expect(screen.getByText(/get_contact/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(deleteToolsMutate).toHaveBeenCalledWith(
      { serverId: "mcs_1", toolIds: ["mct_1"], expectedRevision: 1 },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("names the count and sends every selected tool in one command", async () => {
    const user = userEvent.setup();
    render(
      <DeleteToolDialog
        serverId="mcs_1"
        tools={[
          { id: "mct_1", name: "get_contact" },
          { id: "mct_2", name: "list_contacts" },
        ]}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText(/this deletes 2 tools/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(deleteToolsMutate).toHaveBeenCalledWith(
      { serverId: "mcs_1", toolIds: ["mct_1", "mct_2"], expectedRevision: 1 },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});
