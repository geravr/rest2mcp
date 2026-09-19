import { APP_ERROR_CODES } from "@repo/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublishReviewDialog } from "./publish-review-dialog";

type Warning = { severity: "warning"; code: string; message: string };
type PublishError = { data?: { appCode?: string } } | null;

const mocks = vi.hoisted(() => ({
  preview: {
    serverId: "mcs_1",
    draftRevision: 4,
    publishedRevisionId: "msr_1" as string | null,
    publishedRevisionNumber: 1 as number | null,
    candidateFingerprint: "abcdef1234567890",
    contractFingerprint: "contract123456",
    ready: true,
    dirty: true,
    errors: [] as unknown[],
    warnings: [] as Warning[],
    warningCodes: [] as string[],
    diff: {
      serverChanged: [] as string[],
      commonChanged: false,
      authChanged: false,
      toolsAdded: [] as string[],
      toolsRemoved: [] as string[],
      toolsChanged: [] as string[],
      toolsEnabled: [] as string[],
      toolsDisabled: [] as string[],
      configChanged: false,
      contractChanged: false,
      changed: true,
      destructive: false,
    },
  },
  refetch: vi.fn(),
  publishMutate: vi.fn(),
  publishPending: false,
  publishError: null as PublishError,
}));

vi.mock("@/hooks/use-mcp", () => ({
  STALE_PUBLISH_CODES: new Set([
    "MCP_PUBLISH_STALE_DRAFT",
    "MCP_PUBLISH_STALE_REVISION",
    "MCP_PUBLISH_CANDIDATE_CHANGED",
  ]),
  usePublishPreview: () => ({
    data: mocks.preview,
    isLoading: false,
    isError: false,
    error: null,
    refetch: mocks.refetch,
  }),
  usePublishServer: () => ({
    mutate: mocks.publishMutate,
    isPending: mocks.publishPending,
    error: mocks.publishError,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children: React.ReactNode; to: string }) => (
    <a href={props.to}>{children}</a>
  ),
}));

function resetPreview() {
  mocks.preview.ready = true;
  mocks.preview.dirty = true;
  mocks.preview.errors = [];
  mocks.preview.warnings = [];
  mocks.preview.warningCodes = [];
  mocks.preview.publishedRevisionId = "msr_1";
  mocks.preview.publishedRevisionNumber = 1;
  mocks.refetch.mockReset();
  mocks.publishMutate.mockReset();
  mocks.publishPending = false;
  mocks.publishError = null;
}

function renderDialog() {
  return render(<PublishReviewDialog serverId="mcs_1" onClose={vi.fn()} />);
}

describe("PublishReviewDialog", () => {
  beforeEach(resetPreview);

  it("gates publish on acknowledging every warning", async () => {
    const user = userEvent.setup();
    mocks.preview.warnings = [
      {
        severity: "warning",
        code: "contract_changed",
        message: "contract",
      },
      { severity: "warning", code: "tool_added", message: "added" },
    ];
    mocks.preview.warningCodes = ["contract_changed", "tool_added"];

    renderDialog();

    const publishButton = screen.getByRole("button", {
      name: /publish changes/i,
    });
    expect(publishButton).toBeDisabled();

    await user.click(screen.getByLabelText(/agent contract changes/i));
    expect(publishButton).toBeDisabled();

    await user.click(screen.getByLabelText(/tools are added/i));
    expect(publishButton).toBeEnabled();
  });

  it("publishes and reports the new revision number", async () => {
    const user = userEvent.setup();
    mocks.publishMutate.mockImplementation(
      (
        _input: unknown,
        options?: { onSuccess?: (result: { revisionNumber: number }) => void },
      ) => {
        options?.onSuccess?.({ revisionNumber: 5 });
      },
    );

    renderDialog();

    await user.click(screen.getByRole("button", { name: /publish changes/i }));

    expect(mocks.publishMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: "mcs_1",
        expectedDraftRevision: 4,
        expectedPublishedRevisionId: "msr_1",
        candidateFingerprint: "abcdef1234567890",
        acknowledgedWarningCodes: [],
      }),
      expect.anything(),
    );
    expect(screen.getByText(/revision 5 is now live/i)).toBeInTheDocument();
  });

  it("lists blocking errors with the affected tool", () => {
    mocks.preview.ready = false;
    mocks.preview.errors = [
      {
        severity: "error",
        code: APP_ERROR_CODES.MCP_COMPILE_INVALID,
        message: "invalid",
        toolName: "get_contact",
      },
    ];

    renderDialog();

    expect(
      screen.getByText(/invalid and cannot be enabled/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "get_contact" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /publish changes/i }),
    ).toBeDisabled();
  });

  it("reuses one publish request id for retries of the same candidate", async () => {
    const user = userEvent.setup();
    mocks.publishError = {
      data: { appCode: APP_ERROR_CODES.MCP_PUBLISH_STALE_DRAFT },
    };

    renderDialog();

    const publishButton = screen.getByRole("button", {
      name: /publish changes/i,
    });
    await user.click(publishButton);
    await user.click(publishButton);

    const first = mocks.publishMutate.mock.calls[0]?.[0] as {
      publishRequestId: string;
    };
    const second = mocks.publishMutate.mock.calls[1]?.[0] as {
      publishRequestId: string;
    };
    expect(first.publishRequestId).toBeTruthy();
    expect(second.publishRequestId).toBe(first.publishRequestId);
  });

  it("recovers from a stale publication conflict", async () => {
    const user = userEvent.setup();
    mocks.publishError = {
      data: { appCode: APP_ERROR_CODES.MCP_PUBLISH_STALE_DRAFT },
    };

    renderDialog();

    expect(screen.getByText(/changed after this preview/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /refresh preview/i }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/is now live/i)).not.toBeInTheDocument();
  });

  it("shows no publishable changes and disables publish when clean", () => {
    mocks.preview.dirty = false;

    renderDialog();

    expect(screen.getByText(/no publishable changes/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /publish changes/i }),
    ).toBeDisabled();
  });
});
