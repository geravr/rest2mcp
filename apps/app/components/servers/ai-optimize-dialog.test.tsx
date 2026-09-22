import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AiOptimizeDialog,
  type AiOptimizeScope,
  type AiOptimizeServerState,
} from "./ai-optimize-dialog";

/* ------------------------------------------------------------------ *
 * Controllable hook fakes (state-backed so re-renders mirror real
 * TanStack Query behavior).
 * ------------------------------------------------------------------ */

type PlanFixture = {
  runId: string;
  state: "planned";
  serverId: string;
  source: "draft";
  scope: AiOptimizeScope;
  scopeKind: "single" | "selected" | "all_eligible" | "openapi";
  model: {
    providerKind: string;
    modelId: string;
    readinessFingerprint: string;
  };
  policyVersion: 1;
  promptVersion: 1;
  eligible: Array<{
    ref: { kind: "draft_tool"; toolId: string };
    fingerprint: string;
    name: string;
  }>;
  ineligible: Array<{
    ref: { kind: "draft_tool"; toolId: string };
    name: string;
    reason: string;
  }>;
  disclosedData: string[];
  mutableFields: string[];
  immutableFields: string[];
  estimate: {
    tokens: { inputTokens: number; outputTokens: number };
    pricing:
      | {
          state: "estimated";
          inputCostUsd: number;
          outputCostUsd: number;
          totalCostUsd: number;
        }
      | { state: "unknown" };
  };
  expiresAt: string;
};

const preflightFixture: PlanFixture = {
  runId: "aor_plan_1",
  state: "planned",
  serverId: "mcs_1",
  source: "draft",
  scope: { kind: "single", toolIds: ["mct_1"] },
  scopeKind: "single",
  model: {
    providerKind: "openai",
    modelId: "mock-language-1",
    readinessFingerprint: "fp_model",
  },
  policyVersion: 1,
  promptVersion: 1,
  eligible: [
    {
      ref: { kind: "draft_tool", toolId: "mct_1" },
      fingerprint: "sha256:aa",
      name: "get_users",
    },
  ],
  ineligible: [
    {
      ref: { kind: "draft_tool", toolId: "mct_9" },
      name: "broken_tool",
      reason: "definition_unparseable",
    },
  ],
  disclosedData: ["tool_names", "path_shape"],
  mutableFields: ["tool_name"],
  immutableFields: ["path", "method"],
  estimate: {
    tokens: { inputTokens: 1200, outputTokens: 8000 },
    pricing: { state: "unknown" },
  },
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
};

type ItemFixture = {
  id: string;
  ref:
    | { kind: "draft_tool"; toolId: string }
    | { kind: "openapi_candidate"; operationKey: string };
  name: string;
  state: "recommended" | "no_change" | "failed" | "applied" | "cancelled";
  fingerprint: string;
  operationCount: number;
  advisoryCount: number;
  rejectedCount: number;
  failureCode: string | null;
  appliedDraftRevision: number | null;
  updatedAt: string;
  review: {
    operations: Array<{
      operationId: string;
      kind: string;
      class: "safe" | "guarded";
      targetLabel: string;
      before: string | null;
      after: string;
      rationale: string;
      requestDiff?: Array<{ label: string; before: string; after: string }>;
    }>;
    advisories: Array<{ advisoryId: string; code: string; rationale: string }>;
    rejected: Array<{ operationId: string; code: string; detail: string }>;
  };
};

const recommendedItem: ItemFixture = {
  id: "aoi_1",
  ref: { kind: "draft_tool", toolId: "mct_1" },
  name: "get_users",
  state: "recommended",
  fingerprint: "sha256:aa",
  operationCount: 2,
  advisoryCount: 1,
  rejectedCount: 1,
  failureCode: null,
  appliedDraftRevision: null,
  updatedAt: new Date().toISOString(),
  review: {
    operations: [
      {
        operationId: "op_title",
        kind: "set_tool_title",
        class: "safe",
        targetLabel: "tool",
        before: "Get users",
        after: "Get user records",
        rationale: "Clearer.",
      },
      {
        operationId: "op_key",
        kind: "set_query_entry_key",
        class: "guarded",
        targetLabel: "query.limit",
        before: "limit={agentInput}",
        after: "page_size={agentInput}",
        rationale: "Clearer query key.",
        requestDiff: [
          {
            label: "query.page_size",
            before: "limit={agentInput}",
            after: "page_size={agentInput}",
          },
        ],
      },
    ],
    advisories: [
      {
        advisoryId: "a1",
        code: "suspected_path",
        rationale: "Path may need a version prefix.",
      },
    ],
    rejected: [
      { operationId: "rj1", code: "policy_rejected", detail: "Not allowed." },
    ],
  },
};

const calls = {
  preflight: vi.fn(),
  authorize: vi.fn(),
  cancel: vi.fn(),
  apply: vi.fn(),
};

const mock = {
  ready: true,
  failedItemIds: new Set<string>(),
  runs: {
    items: [] as Array<{
      id: string;
      state: string;
      scope: { kind: string; toolIds?: string[]; operationKeys?: string[] };
    }>,
    page: 1,
    pageSize: 10,
    total: 0,
  },
  plan: preflightFixture as PlanFixture | undefined,
  status: undefined as
    | {
        state: string;
        progress: {
          queued: number;
          running: number;
          recommended: number;
          failed: number;
        };
      }
    | undefined,
  items: undefined as
    | {
        items: Array<{ id: string; name: string; state: string }>;
        page: number;
        pageSize: number;
        total: number;
      }
    | undefined,
  item: undefined as ItemFixture | undefined,
  applyError: null as string | null,
};

vi.mock("@/hooks/use-ai-readiness-guard", () => ({
  useAiFeatureReadiness: () => ({
    ready: mock.ready,
    reason: mock.ready ? null : "no_selection",
    isLoading: false,
  }),
  AiSettingsCta: ({ guidance }: { guidance?: string }) =>
    mock.ready ? null : (
      <div role="note">settings-cta{guidance ? `:${guidance}` : ""}</div>
    ),
}));

vi.mock("@/hooks/use-ai-optimizer", () => ({
  useOptimizerPreflightOpenapi: () => {
    const [data, setData] = useState<unknown>(undefined);
    const [isPending, setIsPending] = useState(false);
    return {
      data,
      isPending,
      mutate: (
        input: unknown,
        cbs?: {
          onSuccess?: (plan: PlanFixture) => void;
          onError?: (error: Error) => void;
        },
      ) => {
        calls.preflight(input);
        setIsPending(true);
        queueMicrotask(() => {
          setIsPending(false);
          if (mock.plan) {
            setData(mock.plan);
            cbs?.onSuccess?.(mock.plan);
          } else {
            cbs?.onError?.(new Error("not ready"));
          }
        });
      },
    };
  },
  useOptimizerPreflightDraft: () => {
    const [data, setData] = useState<
      ReturnType<typeof structuredClone> | undefined
    >(undefined);
    const [isPending, setIsPending] = useState(false);
    return {
      data,
      isPending,
      mutate: (
        input: unknown,
        cbs?: {
          onSuccess?: (plan: PlanFixture) => void;
          onError?: (error: Error) => void;
        },
      ) => {
        calls.preflight(input);
        setIsPending(true);
        queueMicrotask(() => {
          setIsPending(false);
          if (mock.plan) {
            setData(mock.plan as never);
            cbs?.onSuccess?.(mock.plan);
          } else {
            cbs?.onError?.(new Error("not ready"));
          }
        });
      },
    };
  },
  useOptimizerAuthorize: () => {
    const [isPending, setIsPending] = useState(false);
    return {
      isPending,
      mutate: (
        input: unknown,
        cbs?: { onSuccess?: () => void; onError?: (error: Error) => void },
      ) => {
        calls.authorize(input);
        setIsPending(true);
        queueMicrotask(() => {
          setIsPending(false);
          cbs?.onSuccess?.();
        });
      },
    };
  },
  useOptimizerStatus: () => ({ data: mock.status }),
  useOptimizerRuns: () => ({
    data: mock.runs,
    isLoading: false,
    isFetching: false,
  }),
  useOptimizerItems: () => ({ data: mock.items }),
  useOptimizerItem: (_runId: string, itemId: string | null) => ({
    data:
      itemId && mock.failedItemIds.has(itemId)
        ? {
            ...mock.item,
            id: itemId,
            name: "broken_tool",
            state: "failed",
            failureCode: "provider_transient_failure",
            review: { operations: [], advisories: [], rejected: [] },
          }
        : mock.item,
  }),
  useOptimizerCancel: () => ({
    isPending: false,
    mutate: (input: unknown) => {
      calls.cancel(input);
    },
  }),
  useOptimizerApplyDraft: () => {
    const [isPending, setIsPending] = useState(false);
    return {
      isPending,
      mutate: (
        input: unknown,
        cbs?: { onSuccess?: () => void; onError?: (error: Error) => void },
      ) => {
        calls.apply(input);
        setIsPending(true);
        queueMicrotask(() => {
          setIsPending(false);
          if (mock.applyError) {
            cbs?.onError?.(new Error(mock.applyError));
          } else {
            if (mock.item) {
              mock.item = {
                ...mock.item,
                state: "applied",
                appliedDraftRevision: 6,
              };
            }
            cbs?.onSuccess?.();
          }
        });
      },
    };
  },
}));

const serverState: AiOptimizeServerState = {
  configRevision: 3,
  draftRevision: 5,
};

function renderDialog(
  scope: AiOptimizeScope | null = { kind: "single", toolIds: ["mct_1"] },
) {
  const onOpenChange = vi.fn();
  render(
    <AiOptimizeDialog
      serverId="mcs_1"
      serverState={serverState}
      scope={scope}
      onOpenChange={onOpenChange}
    />,
  );
  return { onOpenChange };
}

beforeEach(() => {
  mock.runs = { items: [], page: 1, pageSize: 10, total: 0 };
  mock.failedItemIds = new Set();
  calls.preflight.mockClear();
  calls.authorize.mockClear();
  calls.cancel.mockClear();
  calls.apply.mockClear();
  mock.ready = true;
  mock.plan = preflightFixture;
  mock.status = undefined;
  mock.items = undefined;
  mock.item = undefined;
  mock.applyError = null;
});

describe("AiOptimizeDialog", () => {
  it("shows the AI settings CTA and performs no preflight when AI is not ready", async () => {
    mock.ready = false;
    mock.plan = undefined;
    renderDialog();
    await waitFor(() =>
      expect(screen.getByRole("note")).toHaveTextContent("settings-cta"),
    );
    expect(calls.preflight).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: /authorize/i }),
    ).not.toBeInTheDocument();
  });

  it("runs preflight for a single-tool scope and shows the exact disclosure", async () => {
    renderDialog({ kind: "single", toolIds: ["mct_1"] });
    await waitFor(() => expect(calls.preflight).toHaveBeenCalled());
    expect(calls.preflight.mock.calls[0]![0]).toEqual({
      serverId: "mcs_1",
      scope: { kind: "single", toolIds: ["mct_1"] },
      expectedConfigRevision: 3,
    });
    await screen.findByText(/mock-language-1/);
    // Honest unknown pricing: never shown as zero or free.
    expect(
      screen.getByText("Unavailable (no pricing data)"),
    ).toBeInTheDocument();
    expect(screen.getByText(/1200 \/ 8000/)).toBeInTheDocument();
    // Ineligible tools are disclosed before authorization.
    expect(
      screen.getByText(/1 selected item cannot be analyzed safely/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Never credentials/)).toBeInTheDocument();
    expect(calls.authorize).not.toHaveBeenCalled();
  });

  it("keeps selected scope exactly as requested", async () => {
    mock.plan = { ...preflightFixture, scopeKind: "selected" };
    renderDialog({ kind: "selected", toolIds: ["mct_1", "mct_2"] });
    await waitFor(() => expect(calls.preflight).toHaveBeenCalled());
    expect(calls.preflight.mock.calls[0]![0]).toMatchObject({
      scope: { kind: "selected", toolIds: ["mct_1", "mct_2"] },
    });
    await screen.findByText("Selected tools");
  });

  it("keeps all-eligible scope distinct from the visible page", async () => {
    mock.plan = { ...preflightFixture, scopeKind: "all_eligible" };
    renderDialog({ kind: "all_eligible" });
    await waitFor(() => expect(calls.preflight).toHaveBeenCalled());
    expect(calls.preflight.mock.calls[0]![0]).toMatchObject({
      scope: { kind: "all_eligible" },
    });
    await screen.findByText("All eligible tools in this server");
  });

  it("declines authorization without sending anything", async () => {
    const { onOpenChange } = renderDialog();
    await screen.findByText(/mock-language-1/);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(calls.authorize).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("authorizes the exact plan with the observed revisions", async () => {
    renderDialog();
    await screen.findByText(/mock-language-1/);
    await userEvent.click(
      screen.getByRole("button", { name: /start optimization/i }),
    );
    await waitFor(() => expect(calls.authorize).toHaveBeenCalled());
    expect(calls.authorize.mock.calls[0]![0]).toEqual({
      runId: "aor_plan_1",
      expectedConfigRevision: 3,
      expectedDraftRevision: 5,
    });
  });

  it("recovers progress from persisted state after a reload", async () => {
    // The run is already completed when the dialog opens the progress phase.
    mock.status = {
      state: "completed",
      progress: { queued: 0, running: 0, recommended: 1, failed: 1 },
    };
    mock.items = {
      items: [{ id: "aoi_1", name: "get_users", state: "recommended" }],
      page: 1,
      pageSize: 20,
      total: 1,
    };
    mock.item = recommendedItem;
    renderDialog();
    await screen.findByText(/mock-language-1/);
    await userEvent.click(
      screen.getByRole("button", { name: /start optimization/i }),
    );
    // Persisted terminal state lands directly in the review view.
    await screen.findByText("get_users");
    expect(screen.getByText("Suggested changes")).toBeInTheDocument();
  });

  it("offers cancellation while the run is active", async () => {
    mock.status = {
      state: "running",
      progress: { queued: 2, running: 3, recommended: 1, failed: 0 },
    };
    renderDialog();
    await screen.findByText(/mock-language-1/);
    await userEvent.click(
      screen.getByRole("button", { name: /start optimization/i }),
    );
    const cancelButton = await screen.findByRole("button", {
      name: "Cancel run",
    });
    await userEvent.click(cancelButton);
    expect(calls.cancel).toHaveBeenCalledWith({ runId: "aor_plan_1" });
  });

  it("shows partial failures alongside successful recommendations", async () => {
    mock.status = {
      state: "completed_with_errors",
      progress: { queued: 0, running: 0, recommended: 1, failed: 1 },
    };
    mock.items = {
      items: [
        { id: "aoi_1", name: "get_users", state: "recommended" },
        { id: "aoi_2", name: "broken_tool", state: "failed" },
      ],
      page: 1,
      pageSize: 20,
      total: 2,
    };
    mock.item = recommendedItem;
    mock.failedItemIds = new Set(["aoi_2"]);
    renderDialog();
    await screen.findByText(/mock-language-1/);
    await userEvent.click(
      screen.getByRole("button", { name: /start optimization/i }),
    );
    await screen.findByText(
      "Some tools failed analysis. Successful recommendations are shown below.",
    );
    // The failed card shows its own name and a localized failure reason.
    expect(screen.getByText("broken_tool")).toBeInTheDocument();
    expect(
      screen.getByText("The provider failed temporarily. Try again."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("get_users").length).toBeGreaterThan(0);
  });

  it("labels guarded operations and renders advisory-only findings without apply controls", async () => {
    mock.status = {
      state: "completed",
      progress: { queued: 0, running: 0, recommended: 1, failed: 0 },
    };
    mock.items = {
      items: [{ id: "aoi_1", name: "get_users", state: "recommended" }],
      page: 1,
      pageSize: 20,
      total: 1,
    };
    mock.item = recommendedItem;
    renderDialog();
    await screen.findByText(/mock-language-1/);
    await userEvent.click(
      screen.getByRole("button", { name: /start optimization/i }),
    );
    await screen.findByText("Suggested changes");
    expect(screen.getAllByText("Guarded").length).toBeGreaterThan(0);
    // The guarded effective-request diff is visible.
    expect(
      screen.getByText(/query\.page_size: limit=\{agentInput\} → page_size=/),
    ).toBeInTheDocument();
    // Advisory findings are guidance only: no checkbox renders for them.
    // Advisory codes are localized, never raw server codes.
    expect(
      screen.getByText(/Suspected path issue: Path may need a version prefix/),
    ).toBeInTheDocument();
    // Operations expose checkboxes; advisory findings expose none.
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThanOrEqual(2);
    // Rejected diagnostics are visible, not hidden.
    expect(screen.getByText("Rejected suggestions")).toBeInTheDocument();
    expect(
      screen.getByText(/Rejected by policy: Not allowed\./),
    ).toBeInTheDocument();
  });

  it("applies only the selected operations atomically", async () => {
    mock.status = {
      state: "completed",
      progress: { queued: 0, running: 0, recommended: 1, failed: 0 },
    };
    mock.items = {
      items: [{ id: "aoi_1", name: "get_users", state: "recommended" }],
      page: 1,
      pageSize: 20,
      total: 1,
    };
    mock.item = recommendedItem;
    renderDialog();
    await screen.findByText(/mock-language-1/);
    await userEvent.click(
      screen.getByRole("button", { name: /start optimization/i }),
    );
    await screen.findByText("Suggested changes");

    // Select only the guarded operation.
    await userEvent.click(screen.getByLabelText(/query\.limit/));
    await userEvent.click(
      screen.getByRole("button", { name: /Apply 1 selected to draft/i }),
    );
    await waitFor(() => expect(calls.apply).toHaveBeenCalled());
    expect(calls.apply.mock.calls[0]![0]).toMatchObject({
      runId: "aor_plan_1",
      selections: [{ itemId: "aoi_1", operationIds: ["op_key"] }],
      expectedConfigRevision: 3,
      expectedDraftRevision: 5,
    });
  });

  it("keeps recommendations visible when a stale apply conflicts", async () => {
    mock.status = {
      state: "completed",
      progress: { queued: 0, running: 0, recommended: 1, failed: 0 },
    };
    mock.items = {
      items: [{ id: "aoi_1", name: "get_users", state: "recommended" }],
      page: 1,
      pageSize: 20,
      total: 1,
    };
    mock.item = recommendedItem;
    mock.applyError = "The draft changed since the review.";
    renderDialog();
    await screen.findByText(/mock-language-1/);
    await userEvent.click(
      screen.getByRole("button", { name: /start optimization/i }),
    );
    await screen.findByText("Suggested changes");
    await userEvent.click(screen.getByLabelText(/query\.limit/));
    await userEvent.click(
      screen.getByRole("button", { name: /Apply 1 selected to draft/i }),
    );
    await screen.findByText("The draft changed since the review.");
    // Recommendations remain visible for a new run.
    expect(screen.getByText("Suggested changes")).toBeInTheDocument();
  });

  it("reports successful application as draft-only", async () => {
    mock.status = {
      state: "completed",
      progress: { queued: 0, running: 0, recommended: 1, failed: 0 },
    };
    mock.items = {
      items: [{ id: "aoi_1", name: "get_users", state: "recommended" }],
      page: 1,
      pageSize: 20,
      total: 1,
    };
    mock.item = recommendedItem;
    renderDialog();
    await screen.findByText(/mock-language-1/);
    await userEvent.click(
      screen.getByRole("button", { name: /start optimization/i }),
    );
    await screen.findByText("Suggested changes");
    await userEvent.click(screen.getByLabelText(/query\.limit/));
    await userEvent.click(
      screen.getByRole("button", { name: /Apply 1 selected to draft/i }),
    );
    await waitFor(() => expect(calls.apply).toHaveBeenCalled());
    // Truthful draft-only messaging.
    expect(
      screen.getByText(
        /Saved to the draft\. Publish to make it agent-visible\./,
      ),
    ).toBeInTheDocument();
  });

  it("renders nothing when no scope is set", () => {
    renderDialog(null);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("AiOptimizeDialog resume and OpenAPI mode", () => {
  it("resumes a persisted active run for the same scope without a new preflight", async () => {
    mock.runs = {
      items: [
        {
          id: "aor_active",
          state: "running",
          scope: { kind: "single", toolIds: ["mct_1"] },
        },
        {
          id: "aor_other_scope",
          state: "running",
          scope: { kind: "single", toolIds: ["mct_99"] },
        },
      ],
      page: 1,
      pageSize: 10,
      total: 2,
    };
    mock.status = {
      state: "running",
      progress: { queued: 1, running: 2, recommended: 0, failed: 0 },
    };
    renderDialog({ kind: "single", toolIds: ["mct_1"] });
    // The persisted run wins: no new plan is created.
    await screen.findByRole("button", { name: "Cancel run" });
    expect(calls.preflight).not.toHaveBeenCalled();
  });

  it("preflights OpenAPI candidates with the reparsed source identity", async () => {
    const onOptimizationChange = vi.fn();
    render(
      <AiOptimizeDialog
        serverId="mcs_1"
        serverState={serverState}
        scope={{ kind: "openapi", operationKeys: ["listUsers"] }}
        openapi={{
          source: {
            kind: "content",
            content: '{"openapi":"3.1.0"}',
            label: "paste",
          },
          fingerprint: "fp_document_1",
        }}
        onOptimizationChange={onOptimizationChange}
        onOpenChange={vi.fn()}
      />,
    );
    await waitFor(() => expect(calls.preflight).toHaveBeenCalled());
    expect(calls.preflight.mock.calls[0]![0]).toMatchObject({
      source: {
        kind: "content",
        content: '{"openapi":"3.1.0"}',
        label: "paste",
      },
      fingerprint: "fp_document_1",
      operationKeys: ["listUsers"],
    });
    await screen.findByText(/mock-language-1/);
    // Import mode: recommendations are reported, never applied to a draft.
    mock.status = {
      state: "completed",
      progress: { queued: 0, running: 0, recommended: 1, failed: 0 },
    };
    mock.items = {
      items: [{ id: "aoi_1", name: "listusers", state: "recommended" }],
      page: 1,
      pageSize: 20,
      total: 1,
    };
    mock.item = {
      ...recommendedItem,
      ref: { kind: "openapi_candidate", operationKey: "listUsers" },
      name: "listusers",
    };
    await userEvent.click(
      screen.getByRole("button", { name: /start optimization/i }),
    );
    await screen.findByText("Suggested changes");
    await userEvent.click(screen.getByLabelText(/query\.limit/));
    await waitFor(() =>
      expect(onOptimizationChange).toHaveBeenCalledWith({
        runId: "aor_plan_1",
        operations: [{ operationKey: "listUsers", operationIds: ["op_key"] }],
      }),
    );
    expect(
      screen.queryByRole("button", { name: /Apply 1 selected to draft/i }),
    ).not.toBeInTheDocument();
    expect(calls.apply).not.toHaveBeenCalled();
  });
});
