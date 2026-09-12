import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServerSettingsTab } from "./settings-tab";

const createVariableMutate = vi.fn();
const updateServerMutate = vi.fn();

vi.mock("@/hooks/use-mcp", () => ({
  useMcpVariables: () => ({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
  }),
  useCreateMcpVariable: () => ({
    mutate: createVariableMutate,
    isPending: false,
  }),
  useDeleteMcpVariable: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useUpdateMcpServer: () => ({
    mutate: updateServerMutate,
    isPending: false,
  }),
}));

const server = {
  id: "mcs_1",
  name: "CRM",
  description: null,
  baseUrl: "https://api.example.com",
};

describe("ServerSettingsTab", () => {
  beforeEach(() => {
    createVariableMutate.mockClear();
    updateServerMutate.mockClear();
  });

  it("keeps identity and defaults save disabled until the form is dirty", () => {
    render(
      <ServerSettingsTab
        server={server}
        defaultHeaders={null}
        defaultQuery={null}
      />,
    );

    expect(
      screen.getByRole("button", { name: /save changes/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /save defaults/i }),
    ).toBeDisabled();
  });

  it("rejects an invalid variable name before calling create", async () => {
    const user = userEvent.setup();
    render(
      <ServerSettingsTab
        server={server}
        defaultHeaders={null}
        defaultQuery={null}
      />,
    );

    await user.type(screen.getByLabelText(/variable name/i), "ApiToken");
    await user.type(screen.getByLabelText(/^value$/i), "secret");

    expect(screen.getByText(/lowercase name/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add variable/i }),
    ).toBeDisabled();
    expect(createVariableMutate).not.toHaveBeenCalled();
  });

  it("saves identity when the name changes", async () => {
    const user = userEvent.setup();
    render(
      <ServerSettingsTab
        server={server}
        defaultHeaders={null}
        defaultQuery={null}
      />,
    );

    const nameInput = screen.getByLabelText(/^name$/i);
    await user.clear(nameInput);
    await user.type(nameInput, "Billing");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    expect(updateServerMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: "mcs_1",
        name: "Billing",
        baseUrl: "https://api.example.com",
      }),
    );
  });
});
