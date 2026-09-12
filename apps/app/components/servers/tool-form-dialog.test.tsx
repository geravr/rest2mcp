import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToolFormDialog, type ToolFormTool } from "./tool-form-dialog";

type SaveOptions = {
  onSuccess?: (result: {
    id: string;
    warnings?: Array<{ type: string; name: string }>;
  }) => void;
};

const createMutate = vi.fn<(input: unknown, options?: SaveOptions) => void>();
const updateMutate = vi.fn<(input: unknown, options?: SaveOptions) => void>();

vi.mock("@/hooks/use-mcp", () => ({
  useCreateMcpTool: () => ({ mutate: createMutate, isPending: false }),
  useUpdateMcpTool: () => ({ mutate: updateMutate, isPending: false }),
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

describe("ToolFormDialog", () => {
  beforeEach(() => {
    createMutate.mockReset();
    updateMutate.mockReset();
  });

  it("switches to editing the saved tool when the create returns warnings", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    createMutate.mockImplementation((_input, options) => {
      options?.onSuccess?.({
        id: "mct_new",
        warnings: [{ type: "placeholder_without_param", name: "acme" }],
      });
    });
    updateMutate.mockImplementation((_input, options) => {
      options?.onSuccess?.({ id: "mct_new" });
    });

    render(
      <ToolFormDialog serverId="mcs_1" variableNames={[]} onClose={onClose} />,
    );

    expect(
      screen.getByRole("heading", { name: /add tool/i }),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText(/tool name/i), "get_contacts");
    await user.type(screen.getByLabelText(/path/i), "/contacts");
    await user.click(screen.getByRole("button", { name: /save tool/i }));

    // Warnings keep the dialog open, now editing the just-created tool.
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

    await user.click(
      screen.getAllByRole("button", { name: /add row/i })[0] as HTMLElement,
    );
    const valueInput = screen.getByPlaceholderText(
      /value or \{\{variable\}\}/i,
    ) as HTMLInputElement;
    // Native setter so React observes value and caret (user-event parses
    // `{{` as a key descriptor).
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(valueInput, "{{");
    valueInput.setSelectionRange(2, 2);
    fireEvent.change(valueInput);

    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.keyDown(valueInput, { key: "Escape" });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: /add tool/i }),
    ).toBeInTheDocument();
  });

  it("closes the dialog with Escape when no listbox is open", () => {
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
});
