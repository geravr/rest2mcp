import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteVariableDialog } from "./delete-variable-dialog";

const deleteMutate = vi.fn(
  (_input: unknown, options?: { onSuccess?: () => void }) => {
    options?.onSuccess?.();
  },
);

vi.mock("@/hooks/use-mcp", () => ({
  useDeleteMcpVariable: () => ({
    mutate: deleteMutate,
    isPending: false,
  }),
}));

describe("DeleteVariableDialog", () => {
  beforeEach(() => {
    deleteMutate.mockClear();
  });

  it("cancels without sending a delete request", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <DeleteVariableDialog
        serverId="mcs_1"
        name="api_token"
        tools={[]}
        defaultHeaders={null}
        defaultQuery={null}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(deleteMutate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("describes permanent deletion without mustache syntax", () => {
    render(
      <DeleteVariableDialog
        serverId="mcs_1"
        name="api_token"
        tools={[]}
        defaultHeaders={null}
        defaultQuery={null}
        onClose={() => {}}
      />,
    );

    expect(
      screen.getByText(/permanently deletes api_token/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\{\{api_token\}\}/)).not.toBeInTheDocument();
  });

  it("warns with default query param keys when referenced", () => {
    render(
      <DeleteVariableDialog
        serverId="mcs_1"
        name="api_token"
        tools={[]}
        defaultHeaders={null}
        defaultQuery={{ token: "{{api_token}}" }}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText(/default query param token/i)).toBeInTheDocument();
  });

  it("warns with tool names and default header keys when referenced", () => {
    render(
      <DeleteVariableDialog
        serverId="mcs_1"
        name="api_token"
        tools={[
          {
            name: "get_contact",
            pathTemplate: "/contacts",
            requestTemplate: {
              headers: { Authorization: "Bearer {{api_token}}" },
            },
          },
        ]}
        defaultHeaders={{ Authorization: "Bearer {{api_token}}" }}
        defaultQuery={null}
        onClose={() => {}}
      />,
    );

    expect(
      screen.getByText(/default header Authorization/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/May be used in tools on this page: get_contact/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\{\{api_token\}\}/)).not.toBeInTheDocument();
  });

  it("does not warn when a shorter name is only a substring of a placeholder", () => {
    render(
      <DeleteVariableDialog
        serverId="mcs_1"
        name="api"
        tools={[
          {
            name: "get_contact",
            pathTemplate: "/contacts",
            requestTemplate: {
              headers: { Authorization: "Bearer {{api_token}}" },
            },
          },
        ]}
        defaultHeaders={null}
        defaultQuery={null}
        onClose={() => {}}
      />,
    );

    expect(screen.queryByText(/may be used in tools/i)).not.toBeInTheDocument();
  });

  it("deletes the variable when confirmed despite reference warnings", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <DeleteVariableDialog
        serverId="mcs_1"
        name="api_token"
        tools={[
          {
            name: "get_contact",
            pathTemplate: "/contacts",
            requestTemplate: {
              headers: { Authorization: "Bearer {{api_token}}" },
            },
          },
        ]}
        defaultHeaders={null}
        defaultQuery={null}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole("button", { name: /delete/i }));

    expect(deleteMutate).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("deletes the variable when confirmed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <DeleteVariableDialog
        serverId="mcs_1"
        name="api_token"
        tools={[]}
        defaultHeaders={null}
        defaultQuery={null}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole("button", { name: /delete/i }));

    expect(deleteMutate).toHaveBeenCalledWith(
      { serverId: "mcs_1", name: "api_token" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(onClose).toHaveBeenCalled();
  });
});
