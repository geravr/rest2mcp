import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTranslations } from "@/i18n";
import { MCP_PLATFORM_SCOPES, type McpPlatformScope } from "@/lib/mcp-limits";
import { PlatformTokenTab } from "./platform-token-tab";

type PlatformPat = {
  id: string;
  name: string;
  prefix: string;
  policyVersion: number | null;
  scopes: McpPlatformScope[];
  resourceMode: "selected" | "account" | null;
  selectedServerIds: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  replacesTokenId: string | null;
  replacedByTokenId: string | null;
};

type McpServerItem = { id: string; name: string };

const h = vi.hoisted(() => ({
  locale: "en" as "en" | "es",
  tokens: [] as PlatformPat[],
  servers: [] as McpServerItem[],
  tokenLoading: false,
  createMutateAsync: vi.fn(),
  rotateMutateAsync: vi.fn(),
  revokeMutate: vi.fn(),
  requestMutateAsync: vi.fn(),
  verifyMutateAsync: vi.fn(),
}));

vi.mock("@/hooks/use-mcp", () => ({
  usePlatformTokens: () => ({
    data: {
      items: h.tokens,
      page: 1,
      pageSize: 50,
      total: h.tokens.length,
    },
    isLoading: h.tokenLoading,
  }),
  usePlatformSnippet: () => ({
    data: { url: "https://api.example.test/api/platform-mcp" },
  }),
  usePlatformSecurityEvents: () => ({
    data: { items: [], page: 1, pageSize: 10, total: 0 },
  }),
  useMcpServers: () => ({
    data: { items: h.servers, page: 1, pageSize: 50, total: h.servers.length },
  }),
  useCreatePlatformToken: () => ({
    mutateAsync: h.createMutateAsync,
    isPending: false,
  }),
  useRotatePlatformToken: () => ({
    mutateAsync: h.rotateMutateAsync,
    isPending: false,
  }),
  useRevokePlatformToken: () => ({
    mutate: h.revokeMutate,
    isPending: false,
  }),
  useRequestPlatformStepUp: () => ({
    mutateAsync: h.requestMutateAsync,
    isPending: false,
  }),
  useVerifyPlatformStepUp: () => ({
    mutateAsync: h.verifyMutateAsync,
    isPending: false,
  }),
}));

vi.mock("@/i18n/use-translations", async () => {
  const { getTranslations } = await import("@/i18n");
  return {
    useTranslations: () => ({
      t: getTranslations(h.locale),
      locale: h.locale,
      setLocale: vi.fn(),
    }),
  };
});

const en = getTranslations("en");
const platform = en.settings.platform;

const activeToken: PlatformPat = {
  id: "pat_active",
  name: "Claude desktop",
  prefix: "pat_live_ab",
  policyVersion: 1,
  scopes: ["read"],
  resourceMode: "selected",
  selectedServerIds: ["srv_1"],
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  lastUsedAt: null,
  expiresAt: new Date("2026-02-01T00:00:00.000Z"),
  revokedAt: null,
  replacesTokenId: null,
  replacedByTokenId: null,
};

const revokedToken: PlatformPat = {
  ...activeToken,
  id: "pat_revoked",
  name: "Retired token",
  prefix: "pat_dead_cd",
  revokedAt: new Date("2026-01-15T00:00:00.000Z"),
};

function capHint(days: number): string {
  return platform.ttlCapHint.replace("{days}", String(days));
}

function ttlOption(days: number): string {
  return platform.ttlDays.replace("{days}", String(days));
}

function createDialog(): HTMLElement {
  const nameInput = screen.getByLabelText(platform.nameLabel);
  const dialog = nameInput.closest<HTMLElement>('[role="dialog"]');
  if (!dialog) throw new Error("create/rotate dialog not found");
  return dialog;
}

function submitButton(label: string = platform.createToken): HTMLElement {
  return within(createDialog()).getByRole("button", { name: label });
}

function scopeSwitch(scope: McpPlatformScope): HTMLElement {
  const label = within(createDialog()).getByText(platform.scopes[scope], {
    selector: "div.text-sm",
  });
  const row = label.parentElement?.parentElement;
  const toggle = row?.querySelector<HTMLElement>('[role="switch"]');
  if (!toggle) throw new Error(`no switch for scope ${scope}`);
  return toggle;
}

function serverSwitch(index: number): HTMLElement {
  return within(createDialog()).getAllByRole("switch")[index] as HTMLElement;
}

async function openCreateDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: platform.createToken }));
}

describe("PlatformTokenTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.locale = "en";
    h.tokens = [];
    h.tokenLoading = false;
    h.servers = [
      { id: "srv_1", name: "CRM" },
      { id: "srv_2", name: "Billing" },
    ];
    h.createMutateAsync.mockResolvedValue({
      ...activeToken,
      id: "pat_new",
      name: "Claude",
      token: "pat_default_raw",
    });
    h.rotateMutateAsync.mockResolvedValue({
      ...activeToken,
      token: "pat_rotated_raw",
    });
    h.requestMutateAsync.mockResolvedValue({});
    h.verifyMutateAsync.mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens with read-only, selected-server defaults and no account-wide authority", async () => {
    const user = userEvent.setup();
    render(<PlatformTokenTab />);
    await openCreateDialog(user);

    expect(
      screen.getByText(platform.resourceModeDescriptions.selected),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(platform.resourceModeDescriptions.account),
    ).not.toBeInTheDocument();

    expect(scopeSwitch("read")).toHaveAttribute("aria-checked", "true");
    for (const scope of MCP_PLATFORM_SCOPES.filter((s) => s !== "read")) {
      expect(scopeSwitch(scope)).toHaveAttribute("aria-checked", "false");
    }

    expect(screen.getByText(platform.lowRiskLabel)).toBeInTheDocument();
    expect(screen.queryByText(platform.highRiskLabel)).not.toBeInTheDocument();
  });

  it("flags publish's dependency on author instead of silently granting it", async () => {
    const user = userEvent.setup();
    render(<PlatformTokenTab />);
    await openCreateDialog(user);

    const hint = platform.dependencyHint
      .replace("{scope}", platform.scopes.publish)
      .replace("{dependency}", platform.scopes.author);
    expect(screen.getByText(hint)).toBeInTheDocument();

    await user.click(scopeSwitch("publish"));

    expect(scopeSwitch("publish")).toHaveAttribute("aria-checked", "true");
    expect(scopeSwitch("author")).toHaveAttribute("aria-checked", "false");
  });

  it("requires a selected server in selected mode", async () => {
    const user = userEvent.setup();
    render(<PlatformTokenTab />);
    await openCreateDialog(user);
    await user.type(screen.getByLabelText(platform.nameLabel), "Claude");

    expect(submitButton()).toBeDisabled();

    await user.click(serverSwitch(0));

    expect(submitButton()).toBeEnabled();
  });

  it("does not require a server when the grant is account-wide", async () => {
    const user = userEvent.setup();
    render(<PlatformTokenTab />);
    await openCreateDialog(user);
    await user.type(screen.getByLabelText(platform.nameLabel), "Claude");

    await user.click(
      within(createDialog()).getByRole("button", {
        name: platform.resourceModes.account,
      }),
    );

    expect(submitButton()).toBeEnabled();
  });

  it("routes high-risk grants through email step-up before creating", async () => {
    const user = userEvent.setup();
    h.createMutateAsync.mockResolvedValue({
      ...activeToken,
      id: "pat_high",
      name: "Claude",
      token: "pat_high_risk_raw",
    });
    render(<PlatformTokenTab />);
    await openCreateDialog(user);
    await user.type(screen.getByLabelText(platform.nameLabel), "Claude");
    await user.click(
      within(createDialog()).getByRole("button", {
        name: platform.resourceModes.account,
      }),
    );

    expect(screen.getByText(platform.highRiskLabel)).toBeInTheDocument();

    await user.click(submitButton());

    expect(h.requestMutateAsync).toHaveBeenCalledTimes(1);
    expect(h.createMutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText(platform.stepUp.title)).toBeInTheDocument();

    await user.type(screen.getByLabelText(platform.stepUp.codeLabel), "123456");
    await user.click(
      screen.getByRole("button", { name: platform.stepUp.verifyAndCreate }),
    );

    await waitFor(() => expect(h.verifyMutateAsync).toHaveBeenCalledTimes(1));
    expect(h.verifyMutateAsync).toHaveBeenCalledWith({
      otp: "123456",
      scopes: ["read"],
      resourceMode: "account",
      serverIds: undefined,
    });
    await waitFor(() => expect(h.createMutateAsync).toHaveBeenCalledTimes(1));
    expect(h.verifyMutateAsync.mock.invocationCallOrder[0]).toBeLessThan(
      h.createMutateAsync.mock.invocationCallOrder[0] as number,
    );
  });

  it("caps TTL choices by risk tier", async () => {
    const user = userEvent.setup();
    render(<PlatformTokenTab />);
    await openCreateDialog(user);

    expect(screen.getByText(capHint(90))).toBeInTheDocument();
    await user.click(screen.getByLabelText(platform.ttlLabel));
    expect(
      screen.getByRole("option", { name: ttlOption(90) }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: ttlOption(30) }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: ttlOption(7) }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await user.click(
      within(createDialog()).getByRole("button", {
        name: platform.resourceModes.account,
      }),
    );

    expect(screen.getByText(capHint(30))).toBeInTheDocument();
    await user.click(screen.getByLabelText(platform.ttlLabel));
    expect(
      screen.queryByRole("option", { name: ttlOption(90) }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: ttlOption(30) }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: ttlOption(7) }),
    ).toBeInTheDocument();
  });

  it("renders multiple PATs with status and rotates with a prefilled grant", async () => {
    const user = userEvent.setup();
    h.tokens = [activeToken, revokedToken];
    render(<PlatformTokenTab />);

    expect(screen.getByText("Claude desktop")).toBeInTheDocument();
    expect(screen.getByText("Retired token")).toBeInTheDocument();
    expect(screen.getByText(activeToken.prefix)).toBeInTheDocument();
    expect(screen.getByText(revokedToken.prefix)).toBeInTheDocument();
    expect(screen.getByText(platform.activeLabel)).toBeInTheDocument();
    expect(screen.getByText(platform.revokedLabel)).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: platform.rotateToken }),
    ).toHaveLength(1);

    await user.click(
      screen.getByRole("button", { name: platform.rotateToken }),
    );

    expect(
      screen.getByRole("heading", { name: platform.rotateToken }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(platform.nameLabel)).toHaveValue(
      `${activeToken.name} (rotated)`,
    );
    expect(serverSwitch(0)).toHaveAttribute("aria-checked", "true");

    await user.click(submitButton(platform.rotateToken));

    await waitFor(() => expect(h.rotateMutateAsync).toHaveBeenCalledTimes(1));
    expect(h.rotateMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenId: activeToken.id,
        name: `${activeToken.name} (rotated)`,
        scopes: ["read"],
        resourceMode: "selected",
        serverIds: ["srv_1"],
      }),
    );
  });

  it("confirms before revoking and only revokes on confirmation", async () => {
    const user = userEvent.setup();
    h.tokens = [activeToken];
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);
    render(<PlatformTokenTab />);

    await user.click(
      screen.getByRole("button", { name: platform.revokeToken }),
    );

    expect(confirmSpy).toHaveBeenCalledWith(platform.confirmRevoke);
    expect(h.revokeMutate).toHaveBeenCalledWith({ tokenId: activeToken.id });

    h.revokeMutate.mockClear();
    confirmSpy.mockReturnValue(false);
    await user.click(
      screen.getByRole("button", { name: platform.revokeToken }),
    );

    expect(h.revokeMutate).not.toHaveBeenCalled();
  });

  it("shows the raw token once and never restores it after remount", async () => {
    const user = userEvent.setup();
    h.createMutateAsync.mockResolvedValue({
      ...activeToken,
      id: "pat_new",
      name: "Claude",
      token: "pat_raw_value_123",
    });
    const { unmount } = render(<PlatformTokenTab />);
    await openCreateDialog(user);
    await user.type(screen.getByLabelText(platform.nameLabel), "Claude");
    await user.click(serverSwitch(0));
    await user.click(submitButton());

    expect(await screen.findByText("pat_raw_value_123")).toBeInTheDocument();
    expect(screen.getByText(platform.tokenShownOnce)).toBeInTheDocument();

    unmount();

    h.tokens = [
      {
        ...activeToken,
        id: "pat_new",
        name: "Claude",
        prefix: "pat_raw_va",
      },
    ];
    render(<PlatformTokenTab />);

    expect(screen.queryByText("pat_raw_value_123")).not.toBeInTheDocument();
    expect(screen.getByText("pat_raw_va")).toBeInTheDocument();
  });

  it("renders platform copy for the active locale", () => {
    const es = getTranslations("es");
    h.locale = "es";
    render(<PlatformTokenTab />);

    expect(screen.getByText(es.settings.platform.title)).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: es.settings.platform.createToken,
      }),
    ).toBeInTheDocument();
  });
});
