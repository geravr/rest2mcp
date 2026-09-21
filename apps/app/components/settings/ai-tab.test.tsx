import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTranslations } from "@/i18n";
import { AiSettingsTab } from "./ai-tab";

type ConnectionView = {
  id: string;
  providerKind: string;
  createdAt: string;
  updatedAt: string;
  configRevision: number;
  credentialRevision: number;
  verifiedAt: string | null;
  lastErrorCode: string | null;
  lastAttemptAt: string | null;
};

type ReadinessView = {
  capabilityProfile: string;
  ready: boolean;
  reason: string | null;
  selection: null | {
    connectionId: string;
    providerKind: string;
    capabilityProfile: string;
    modelId: string;
    protocol: string;
    verifiedAt: string;
  };
};

type CatalogEntryView = {
  descriptor: {
    modelId: string;
    displayName: string;
    inputModalities: string[];
    outputModalities: string[];
    contextWindowTokens: number | null;
    maxOutputTokens: number | null;
    supportsToolCalls: boolean | null;
    supportsStructuredOutput: boolean | null;
    route: Record<string, unknown>;
    confidence: string;
    deprecated: boolean;
  };
  qualification: Record<string, unknown>;
};

type CatalogView = {
  providerKind: string;
  capabilityProfile: string;
  retrievedAt: string;
  stale: boolean;
  entries: CatalogEntryView[];
};

const RAW_PROVIDER_ERROR = "RawProviderError: sk-secret-value-leaked";

const h = vi.hoisted(() => ({
  locale: "en" as "en" | "es",
  connections: [] as ConnectionView[],
  connectionsLoading: false,
  readiness: null as ReadinessView | null,
  readinessLoading: false,
  catalog: null as CatalogView | null,
  catalogLoading: false,
  catalogError: null as unknown,
  catalogRefetch: vi.fn(),
  refreshCatalog: vi.fn(),
  connectMutateAsync: vi.fn(),
  connectPending: false,
  rotateMutateAsync: vi.fn(),
  removeMutateAsync: vi.fn(),
  verifyMutateAsync: vi.fn(),
  verifyPending: false,
  invalidate: vi.fn(),
}));

vi.mock("@/hooks/use-ai", () => ({
  useAiConnections: () => ({
    data: { connections: h.connections },
    isLoading: h.connectionsLoading,
    isError: false,
    error: null,
  }),
  useAiReadiness: () => ({
    data: h.readiness,
    isLoading: h.readinessLoading,
    isError: false,
    error: null,
  }),
  useAiCatalog: () => ({
    data: h.catalog,
    isLoading: h.catalogLoading,
    isError: h.catalogError !== null,
    error: h.catalogError,
    refetch: h.catalogRefetch,
  }),
  useRefreshAiCatalog: () => h.refreshCatalog,
  useConnectAiProvider: () => ({
    mutateAsync: h.connectMutateAsync,
    isPending: h.connectPending,
  }),
  useRotateAiCredential: () => ({
    mutateAsync: h.rotateMutateAsync,
    isPending: false,
  }),
  useRemoveAiConnection: () => ({
    mutateAsync: h.removeMutateAsync,
    isPending: false,
  }),
  useVerifyAiModel: () => ({
    mutateAsync: h.verifyMutateAsync,
    isPending: h.verifyPending,
  }),
  useInvalidateAi: () => h.invalidate,
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
const ai = en.settings.ai;

function appError(appCode: string, message: string): Error {
  const error = new Error(message) as Error & { data: { appCode: string } };
  error.data = { appCode };
  return error;
}

function connectedConnection(
  overrides: Partial<ConnectionView> = {},
): ConnectionView {
  return {
    id: "aic_1",
    providerKind: "openai",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    configRevision: 3,
    credentialRevision: 2,
    verifiedAt: "2026-01-02T08:00:00.000Z",
    lastErrorCode: null,
    lastAttemptAt: "2026-01-02T08:00:00.000Z",
    ...overrides,
  };
}

function compatibleEntry(
  overrides: Partial<CatalogEntryView["descriptor"]> = {},
): CatalogEntryView {
  return {
    descriptor: {
      modelId: "gpt-test",
      displayName: "GPT Test",
      inputModalities: ["text"],
      outputModalities: ["text"],
      contextWindowTokens: 128000,
      maxOutputTokens: 4096,
      supportsToolCalls: true,
      supportsStructuredOutput: true,
      route: { status: "resolved", protocol: "openai-responses", origin: "x" },
      confidence: "provider",
      deprecated: false,
      ...overrides,
    },
    qualification: { state: "provider_compatible", direct: true },
  };
}

function staleEntry(): CatalogEntryView {
  return {
    descriptor: {
      ...compatibleEntry().descriptor,
      modelId: "gpt-small",
      displayName: "GPT Small",
      contextWindowTokens: 4096,
    },
    qualification: {
      state: "unsupported",
      reason: "context_window_too_small",
    },
  };
}

function defaultCatalog(overrides: Partial<CatalogView> = {}): CatalogView {
  return {
    providerKind: "openai",
    capabilityProfile: "structured-text-v1",
    retrievedAt: "2026-01-05T00:00:00.000Z",
    stale: false,
    entries: [compatibleEntry(), staleEntry()],
    ...overrides,
  };
}

function providerCard(kind: string): HTMLElement {
  const card = document.querySelector<HTMLElement>(`[data-provider="${kind}"]`);
  if (!card) throw new Error(`no provider card for ${kind}`);
  return card;
}

describe("AiSettingsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.locale = "en";
    h.connections = [];
    h.connectionsLoading = false;
    h.readiness = {
      capabilityProfile: "structured-text-v1",
      ready: false,
      reason: "no_connection",
      selection: null,
    };
    h.readinessLoading = false;
    h.catalog = null;
    h.catalogLoading = false;
    h.catalogError = null;
    h.connectPending = false;
    h.verifyPending = false;
    h.connectMutateAsync.mockResolvedValue(connectedConnection());
    h.rotateMutateAsync.mockResolvedValue(connectedConnection());
    h.removeMutateAsync.mockResolvedValue({ removed: true });
    h.verifyMutateAsync.mockResolvedValue({
      connectionId: "aic_1",
      providerKind: "openai",
      capabilityProfile: "structured-text-v1",
      modelId: "gpt-test",
      protocol: "openai-responses",
      verifiedAt: "2026-01-06T00:00:00.000Z",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers provider selection first and renders no connect forms before choosing", () => {
    render(<AiSettingsTab />);

    for (const name of Object.values(ai.providerNames)) {
      expect(
        screen.getByRole("button", { name: name as string }),
      ).toBeInTheDocument();
    }
    expect(screen.getByText(ai.chooseProvider)).toBeInTheDocument();
    expect(screen.queryByLabelText(ai.credentialLabel)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: ai.connect }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(ai.readiness.reasons.no_connection),
    ).toBeInTheDocument();
    expect(screen.queryByText(ai.modelsTitle)).not.toBeInTheDocument();
  });

  it("shows one setup step at a time and returns to the provider list", async () => {
    const user = userEvent.setup();
    render(<AiSettingsTab />);

    await user.click(
      screen.getByRole("button", { name: ai.providerNames.openai }),
    );
    expect(screen.queryByLabelText(ai.credentialLabel)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: ai.providerNames.anthropic }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: ai.steps.next }));

    const card = providerCard("openai");
    expect(within(card).getByLabelText(ai.credentialLabel)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: ai.providerNames.anthropic }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: ai.verifyModelTitle }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: ai.back }));
    expect(
      screen.getByRole("button", { name: ai.providerNames.anthropic }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(ai.credentialLabel)).not.toBeInTheDocument();
  });

  it("shows the verified state and model picker for a connected provider without a selection", () => {
    h.connections = [connectedConnection()];
    h.readiness = {
      capabilityProfile: "structured-text-v1",
      ready: false,
      reason: "no_selection",
      selection: null,
    };
    h.catalog = defaultCatalog();
    render(<AiSettingsTab />);

    const card = providerCard("openai");
    expect(within(card).getByText(ai.states.verified)).toBeInTheDocument();

    expect(screen.getByText("GPT Test")).toBeInTheDocument();
    expect(screen.getByText("GPT Small")).toBeInTheDocument();
    expect(screen.getByText("gpt-test")).toBeInTheDocument();
    expect(
      screen.getByText(ai.unsupportedReasons.context_window_too_small),
    ).toBeInTheDocument();
  });

  it("shows verification disclosure and enables verify only after picking a model", async () => {
    const user = userEvent.setup();
    h.connections = [connectedConnection()];
    h.catalog = defaultCatalog();
    render(<AiSettingsTab />);

    expect(screen.getByText(ai.verification.disclosure)).toBeInTheDocument();
    const verifyButton = screen.getByRole("button", {
      name: ai.verification.verifyAndSelect,
    });
    expect(verifyButton).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "GPT Test" }));
    expect(verifyButton).toBeEnabled();
  });

  it("shows verification progress while verifying a model", async () => {
    const user = userEvent.setup();
    h.connections = [connectedConnection()];
    h.catalog = defaultCatalog();
    const { rerender } = render(<AiSettingsTab />);

    await user.click(screen.getByRole("button", { name: "GPT Test" }));
    h.verifyPending = true;
    rerender(<AiSettingsTab />);

    expect(
      screen.getByText(
        ai.verification.inProgress.replace("{model}", "GPT Test"),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: ai.verification.verifying }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: ai.back })).toBeDisabled();
  });

  it("verifies and selects a model after the disclosure", async () => {
    const user = userEvent.setup();
    h.connections = [connectedConnection()];
    h.catalog = defaultCatalog();
    render(<AiSettingsTab />);

    await user.click(screen.getByRole("button", { name: "GPT Test" }));
    await user.click(
      screen.getByRole("button", { name: ai.verification.verifyAndSelect }),
    );

    await waitFor(() => expect(h.verifyMutateAsync).toHaveBeenCalledTimes(1));
    expect(h.verifyMutateAsync).toHaveBeenCalledWith({
      connectionId: "aic_1",
      capabilityProfile: "structured-text-v1",
      modelId: "gpt-test",
      expectedConfigRevision: 3,
    });
  });

  it("reports verified readiness with a compact configured summary only", () => {
    h.connections = [connectedConnection()];
    h.readiness = {
      capabilityProfile: "structured-text-v1",
      ready: true,
      reason: null,
      selection: {
        connectionId: "aic_1",
        providerKind: "openai",
        capabilityProfile: "structured-text-v1",
        modelId: "gpt-test",
        protocol: "openai-responses",
        verifiedAt: "2026-01-06T00:00:00.000Z",
      },
    };
    h.catalog = defaultCatalog();
    render(<AiSettingsTab />);

    expect(
      screen.queryByRole("navigation", { name: ai.stepperLabel }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(ai.configuredTitle)).toBeInTheDocument();
    expect(screen.getByText(ai.providerNames.openai)).toBeInTheDocument();
    expect(screen.getByText("gpt-test")).toBeInTheDocument();
    expect(
      screen.getByText(
        ai.verifiedAtLabel.replace(
          "{date}",
          new Date("2026-01-06T00:00:00.000Z").toLocaleString(),
        ),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("GPT Test")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: ai.verification.verifyAndSelect }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: ai.rotate }),
    ).not.toBeInTheDocument();
  });

  it("starts an empty wizard when changing provider after configuration", async () => {
    const user = userEvent.setup();
    h.connections = [connectedConnection()];
    h.readiness = {
      capabilityProfile: "structured-text-v1",
      ready: true,
      reason: null,
      selection: {
        connectionId: "aic_1",
        providerKind: "openai",
        capabilityProfile: "structured-text-v1",
        modelId: "gpt-test",
        protocol: "openai-responses",
        verifiedAt: "2026-01-06T00:00:00.000Z",
      },
    };
    render(<AiSettingsTab />);

    await user.click(screen.getByRole("button", { name: ai.changeProvider }));

    expect(
      screen.getByRole("navigation", { name: ai.stepperLabel }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: ai.providerNames.openai }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByLabelText(ai.credentialLabel)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: ai.verifyModelTitle }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("gpt-test")).not.toBeInTheDocument();
  });

  it("renders a localized message and suppresses raw provider errors for invalid credentials", async () => {
    const user = userEvent.setup();
    h.connectMutateAsync.mockRejectedValue(
      appError("AI_PROVIDER_CREDENTIAL_INVALID", RAW_PROVIDER_ERROR),
    );
    render(<AiSettingsTab />);
    await user.click(
      screen.getByRole("button", { name: ai.providerNames.openai }),
    );
    await user.click(screen.getByRole("button", { name: ai.steps.next }));

    const card = providerCard("openai");
    await user.type(
      within(card).getByLabelText(ai.credentialLabel),
      "sk-broken-key",
    );
    await user.click(within(card).getByRole("button", { name: ai.connect }));

    expect(
      await screen.findByText(en.errors.codes.AI_PROVIDER_CREDENTIAL_INVALID),
    ).toBeInTheDocument();
    expect(screen.queryByText(RAW_PROVIDER_ERROR)).not.toBeInTheDocument();
    expect(h.connectMutateAsync).toHaveBeenCalledWith({
      providerKind: "openai",
      credential: "sk-broken-key",
    });
  });

  it("clears the credential input after a successful connect", async () => {
    const user = userEvent.setup();
    render(<AiSettingsTab />);
    await user.click(
      screen.getByRole("button", { name: ai.providerNames.openai }),
    );
    await user.click(screen.getByRole("button", { name: ai.steps.next }));

    const card = providerCard("openai");
    const input = within(card).getByLabelText(
      ai.credentialLabel,
    ) as HTMLInputElement;
    await user.type(input, "sk-fresh-key");
    await user.click(within(card).getByRole("button", { name: ai.connect }));

    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("shows the explicit Verifying pending state while connecting", async () => {
    const user = userEvent.setup();
    h.connectPending = true;
    render(<AiSettingsTab />);
    await user.click(
      screen.getByRole("button", { name: ai.providerNames.openai }),
    );
    await user.click(screen.getByRole("button", { name: ai.steps.next }));

    const card = providerCard("openai");
    expect(
      within(card).getByRole("button", { name: ai.verifying }),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("button", { name: ai.verifying }),
    ).toBeDisabled();
  });

  it("shows a retryable localized alert on transient catalog failure", async () => {
    const user = userEvent.setup();
    h.connections = [connectedConnection()];
    h.catalogError = appError("AI_DISCOVERY_UNAVAILABLE", RAW_PROVIDER_ERROR);
    render(<AiSettingsTab />);

    expect(
      await screen.findByText(en.errors.codes.AI_DISCOVERY_UNAVAILABLE),
    ).toBeInTheDocument();
    expect(screen.queryByText(RAW_PROVIDER_ERROR)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: ai.retry }));

    expect(h.catalogRefetch).toHaveBeenCalledTimes(1);
  });

  it("shows the stale catalog banner with retrieval date and refresh action", async () => {
    const user = userEvent.setup();
    h.connections = [connectedConnection()];
    h.catalog = defaultCatalog({ stale: true });
    render(<AiSettingsTab />);

    expect(screen.getByText(ai.staleCatalogBanner)).toBeInTheDocument();
    expect(
      screen.getByText(
        ai.catalogRetrievedAt.replace(
          "{date}",
          new Date("2026-01-05T00:00:00.000Z").toLocaleString(),
        ),
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: ai.refreshCatalog }));

    expect(h.refreshCatalog).toHaveBeenCalledWith({
      providerKind: "openai",
      capabilityProfile: "structured-text-v1",
    });
  });

  it("shows a localized retry hint on rotation revision conflict and refreshes state", async () => {
    const user = userEvent.setup();
    h.connections = [connectedConnection()];
    h.rotateMutateAsync.mockRejectedValue(
      appError("AI_CONNECTION_REVISION_CONFLICT", RAW_PROVIDER_ERROR),
    );
    render(<AiSettingsTab />);

    await user.click(
      screen.getByRole("button", {
        name: ai.stepName
          .replace("{step}", "2")
          .replace("{label}", ai.steps.connectKey),
      }),
    );
    const card = providerCard("openai");
    await user.click(within(card).getByRole("button", { name: ai.rotate }));
    await user.type(
      within(card).getByLabelText(ai.credentialLabel),
      "sk-next-key",
    );
    await user.click(
      within(card).getByRole("button", { name: ai.rotateConfirm }),
    );

    await waitFor(() =>
      expect(h.rotateMutateAsync).toHaveBeenCalledWith({
        connectionId: "aic_1",
        credential: "sk-next-key",
        expectedConfigRevision: 3,
        expectedCredentialRevision: 2,
      }),
    );
    expect(await screen.findByText(ai.conflictRetryHint)).toBeInTheDocument();
    expect(screen.queryByText(RAW_PROVIDER_ERROR)).not.toBeInTheDocument();
    expect(h.invalidate).toHaveBeenCalled();
  });

  it("removes a connection only through the confirmation dialog", async () => {
    const user = userEvent.setup();
    h.connections = [connectedConnection()];
    render(<AiSettingsTab />);

    await user.click(
      screen.getByRole("button", {
        name: ai.stepName
          .replace("{step}", "2")
          .replace("{label}", ai.steps.connectKey),
      }),
    );
    const card = providerCard("openai");
    await user.click(within(card).getByRole("button", { name: ai.remove }));

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(
        ai.removeDescription.replace("{provider}", "OpenAI"),
      ),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: ai.cancel }));
    expect(h.removeMutateAsync).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(within(card).getByRole("button", { name: ai.remove }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: ai.removeConfirm,
      }),
    );

    await waitFor(() =>
      expect(h.removeMutateAsync).toHaveBeenCalledWith({
        connectionId: "aic_1",
        expectedConfigRevision: 3,
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
});
