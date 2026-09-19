import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditVariableDialog } from "./edit-variable-dialog";

const updateMutate = vi.fn(
  (_input: unknown, options?: { onSuccess?: () => void }) => {
    options?.onSuccess?.();
  },
);

vi.mock("@/hooks/use-mcp", () => ({
  useUpdateMcpVariable: () => ({
    mutate: updateMutate,
    isPending: false,
  }),
}));

describe("EditVariableDialog", () => {
  beforeEach(() => {
    updateMutate.mockClear();
  });

  it("rotates a secret without showing the previous value", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <EditVariableDialog
        serverId="mcs_1"
        variable={{ name: "api_token", isSecret: true }}
        onClose={onClose}
      />,
    );

    const value = screen.getByLabelText(/^value$/i);
    expect(value).toHaveValue("");
    expect(screen.queryByDisplayValue("sk_live")).not.toBeInTheDocument();

    await user.type(value, "sk_rotated");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    expect(updateMutate).toHaveBeenCalledWith(
      {
        serverId: "mcs_1",
        expectedRevision: 1,
        name: "api_token",
        isSecret: true,
        value: "sk_rotated",
      },
      expect.anything(),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("requires a new value to turn a secret into a non-secret", async () => {
    const user = userEvent.setup();
    render(
      <EditVariableDialog
        serverId="mcs_1"
        variable={{ name: "api_token", isSecret: true }}
        onClose={() => {}}
      />,
    );

    await user.click(screen.getByLabelText(/^secret$/i));
    expect(
      screen.getByRole("button", { name: /save changes/i }),
    ).toBeDisabled();

    await user.type(screen.getByLabelText(/^value$/i), "now-plain");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    expect(updateMutate).toHaveBeenCalledWith(
      {
        serverId: "mcs_1",
        expectedRevision: 1,
        name: "api_token",
        isSecret: false,
        value: "now-plain",
      },
      expect.anything(),
    );
  });

  it("keeps the value field empty for a secret", () => {
    render(
      <EditVariableDialog
        serverId="mcs_1"
        variable={{
          name: "api_token",
          isSecret: true,
          value: "should-not-show",
        }}
        onClose={() => {}}
      />,
    );

    expect(screen.getByLabelText(/^value$/i)).toHaveValue("");
    expect(
      screen.queryByDisplayValue("should-not-show"),
    ).not.toBeInTheDocument();
  });

  it("shows a secret placeholder distinct from the description", () => {
    render(
      <EditVariableDialog
        serverId="mcs_1"
        variable={{ name: "api_token", isSecret: true }}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText(/stored value is hidden/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/sk_live/i)).toBeInTheDocument();
  });

  it("prompts for a value when turning secret off", async () => {
    const user = userEvent.setup();
    render(
      <EditVariableDialog
        serverId="mcs_1"
        variable={{ name: "api_token", isSecret: true }}
        onClose={() => {}}
      />,
    );

    await user.click(screen.getByLabelText(/^secret$/i));
    expect(
      screen.getByText(/enter the current value to store it in plain text/i),
    ).toBeInTheDocument();
  });
});
