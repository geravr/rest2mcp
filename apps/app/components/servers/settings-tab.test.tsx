import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServerSettingsTab } from "./settings-tab";

const createVariableMutate = vi.fn();
const updateServerMutate = vi.fn();
const setServerAuthMutate = vi.fn();
const testConnectionMutate = vi.fn();

vi.mock("@/hooks/use-mcp", () => ({
  useMcpVariables: () => ({
    data: [{ id: "msv_1", name: "api_version", isSecret: false, value: "v1" }],
    isLoading: false,
    isError: false,
    error: null,
  }),
  useMcpTools: () => ({
    data: { items: [], page: 1, pageSize: 50, total: 0 },
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
  useUpdateMcpVariable: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useUpdateMcpServer: () => ({
    mutate: updateServerMutate,
    isPending: false,
  }),
  useSetMcpServerAuth: () => ({
    mutate: setServerAuthMutate,
    isPending: false,
  }),
  useTestMcpConnection: () => ({
    mutate: testConnectionMutate,
    data: undefined,
    isPending: false,
    reset: vi.fn(),
  }),
}));

const server = {
  id: "mcs_1",
  name: "CRM",
  description: null,
  baseUrl: "https://api.example.com",
  iconImage: null,
};

const noneAuth = { type: "none" as const };

describe("ServerSettingsTab", () => {
  beforeEach(() => {
    createVariableMutate.mockClear();
    updateServerMutate.mockClear();
    setServerAuthMutate.mockClear();
    testConnectionMutate.mockClear();
  });

  it("keeps identity and defaults save disabled until the form is dirty", () => {
    render(
      <ServerSettingsTab
        server={server}
        defaultHeaders={null}
        defaultQuery={null}
        auth={noneAuth}
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
        auth={noneAuth}
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
        auth={noneAuth}
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

  it("shows stored variable values on all screen sizes", () => {
    render(
      <ServerSettingsTab
        server={server}
        defaultHeaders={null}
        defaultQuery={null}
        auth={noneAuth}
      />,
    );

    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText("v1").className).not.toMatch(/hidden/);
  });

  it("compiles a default header from a Variable origin", async () => {
    const user = userEvent.setup();
    render(
      <ServerSettingsTab
        server={server}
        defaultHeaders={null}
        defaultQuery={null}
        auth={noneAuth}
      />,
    );

    const addButtons = screen.getAllByRole("button", { name: /add row/i });
    await user.click(addButtons[0] as HTMLElement);
    await user.type(screen.getByLabelText(/^key$/i), "Version");
    await user.click(screen.getByLabelText(/value origin/i));
    await user.click(screen.getByRole("option", { name: /^variable$/i }));
    await user.click(screen.getByRole("button", { name: /select variable/i }));
    await user.click(screen.getByRole("menuitem", { name: "api_version" }));
    await user.click(screen.getByRole("button", { name: /save defaults/i }));

    expect(updateServerMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: "mcs_1",
        defaultHeaders: { Version: "{{api_version}}" },
      }),
    );
  });

  it("infers Bearer and does not display the stored token", () => {
    render(
      <ServerSettingsTab
        server={server}
        defaultHeaders={{ Authorization: "Bearer {{api_token}}" }}
        defaultQuery={null}
        auth={{ type: "bearer", variableName: "api_token" }}
      />,
    );

    expect(screen.getByText(/bearer token/i)).toBeInTheDocument();
    const tokenInput = screen.getByLabelText(/^token$/i);
    expect(tokenInput).toHaveAttribute("type", "password");
    expect(tokenInput).toHaveValue("");
    expect(screen.queryByDisplayValue(/sk_/i)).not.toBeInTheDocument();
  });

  it("saves None auth through setServerAuth", async () => {
    const user = userEvent.setup();
    render(
      <ServerSettingsTab
        server={server}
        defaultHeaders={{ Authorization: "Bearer {{api_token}}" }}
        defaultQuery={null}
        auth={{ type: "bearer", variableName: "api_token" }}
      />,
    );

    await user.click(screen.getByLabelText(/^authentication$/i));
    await user.click(screen.getByRole("option", { name: /^none$/i }));
    await user.click(
      screen.getByRole("button", { name: /save authentication/i }),
    );

    expect(setServerAuthMutate).toHaveBeenCalledWith({
      serverId: "mcs_1",
      auth: { type: "none" },
    });
  });

  it("runs Test connection with the current server id", async () => {
    const user = userEvent.setup();
    render(
      <ServerSettingsTab
        server={server}
        defaultHeaders={{ Authorization: "Bearer {{api_token}}" }}
        defaultQuery={null}
        auth={{ type: "bearer", variableName: "api_token" }}
      />,
    );

    await user.click(screen.getByRole("button", { name: /test connection/i }));
    expect(testConnectionMutate).toHaveBeenCalledWith({ serverId: "mcs_1" });
  });

  it("shows Custom without enabling a typed recipe save", () => {
    render(
      <ServerSettingsTab
        server={server}
        defaultHeaders={{
          Authorization: "Bearer {{api_token}}",
          "X-Partner-Key": "{{partner}}",
        }}
        defaultQuery={null}
        auth={{ type: "custom" }}
      />,
    );

    expect(screen.getByText(/custom auth setup/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /save authentication/i }),
    ).toBeDisabled();
  });
});
