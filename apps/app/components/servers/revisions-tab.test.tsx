import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServerRevisionsTab } from "./revisions-tab";

const restoreMutate = vi.fn();

const detailFixture = {
  id: "msr_1",
  revisionNumber: 1,
  sourceDraftRevision: 4,
  candidateFingerprint: "abcdef1234567890",
  contractFingerprint: "contract123456",
  actorSource: "studio",
  note: "first publish",
  isActive: true,
  createdAt: "2026-09-12T10:00:00.000Z",
  schemaVersion: 1,
  compilerVersion: "2",
  server: {
    name: "CRM",
    description: null,
    baseUrl: "https://api.example.com",
    allowedHosts: [],
  },
  diffSummary: null,
  tools: [
    {
      sourceToolId: "mct_1",
      name: "get_contact",
      title: null,
      description: null,
      method: "GET",
      enabled: true,
      allowMutation: false,
      source: "typed",
      contractFingerprint: null,
      definitionHash: null,
      compileStatus: "ready",
      compileIssueCount: 0,
    },
  ],
  configs: [
    {
      sourceValueId: "msv_1",
      name: "api_token",
      kind: "secret",
      owner: "auth",
      hasValue: false,
      available: true,
    },
  ],
  missingSecretCount: 0,
};

vi.mock("@/hooks/use-mcp", () => ({
  useRevisionHistory: () => ({
    data: {
      items: [
        {
          id: "msr_1",
          revisionNumber: 1,
          sourceDraftRevision: 4,
          candidateFingerprint: "abcdef1234567890",
          contractFingerprint: "contract123456",
          actorSource: "studio",
          note: "first publish",
          isActive: true,
          createdAt: "2026-09-12T10:00:00.000Z",
        },
      ],
      page: 1,
      pageSize: 10,
      total: 1,
    },
    isLoading: false,
    isError: false,
    error: null,
  }),
  useRevisionDetail: () => ({
    data: detailFixture,
    isLoading: false,
    isError: false,
    error: null,
  }),
  useRestoreRevision: () => ({
    mutate: restoreMutate,
    isPending: false,
  }),
}));

vi.mock("@/components/admin-list", () => ({
  AdminListPagination: () => null,
}));

function renderTab() {
  return render(
    <ServerRevisionsTab
      serverId="mcs_1"
      draftRevision={4}
      configRevision={9}
      page={1}
      pageSize={10}
      onPageChange={() => {}}
      onPageSizeChange={() => {}}
    />,
  );
}

describe("ServerRevisionsTab", () => {
  beforeEach(() => {
    restoreMutate.mockReset();
  });

  it("lists revisions and opens a secret-safe detail", async () => {
    const user = userEvent.setup();
    renderTab();

    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText(/active/i)).toBeInTheDocument();

    await user.click(screen.getByText("#1"));

    expect(await screen.findByText("get_contact")).toBeInTheDocument();
    expect(screen.getByText("api_token")).toBeInTheDocument();
    expect(screen.getByText(/no value stored/i)).toBeInTheDocument();
    expect(screen.queryByText(/missing secret/i)).not.toBeInTheDocument();
  });

  it("flags a revision whose secret slot is unavailable", async () => {
    const user = userEvent.setup();
    detailFixture.configs[0].available = false;
    detailFixture.missingSecretCount = 1;
    try {
      renderTab();
      await user.click(screen.getByText("#1"));

      expect(await screen.findByText(/missing secret/i)).toBeInTheDocument();
      expect(
        screen.getByText(/secret values that no longer exist/i),
      ).toBeInTheDocument();
    } finally {
      detailFixture.configs[0].available = true;
      detailFixture.missingSecretCount = 0;
    }
  });

  it("requires confirmation before restoring and explains runtime is unchanged", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByText("#1"));
    await user.click(
      await screen.findByRole("button", { name: /restore to draft/i }),
    );

    expect(
      screen.getByText(
        /agent behavior does not change until you preview and publish/i,
      ),
    ).toBeInTheDocument();

    const confirmButtons = screen.getAllByRole("button", {
      name: /restore to draft/i,
    });
    await user.click(confirmButtons[confirmButtons.length - 1] as HTMLElement);

    expect(restoreMutate).toHaveBeenCalledWith(
      {
        serverId: "mcs_1",
        revisionId: "msr_1",
        expectedRevision: 9,
        expectedDraftRevision: 4,
      },
      expect.anything(),
    );
  });
});
