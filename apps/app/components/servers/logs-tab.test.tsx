import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ServerLogsTab } from "./logs-tab";

const logFixture = {
  id: "log_1",
  source: "playground",
  status: "ok",
  httpStatus: 200,
  durationMs: 42,
  createdAt: "2026-09-12T10:00:00.000Z",
  appCode: null,
  requestSummary: null,
  responseSummary: null,
};

vi.mock("@/hooks/use-mcp", () => ({
  useMcpCallLogs: () => ({
    data: { items: [logFixture], total: 1, page: 1, pageSize: 20 },
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

// The deep-link behavior under test does not involve pagination controls.
vi.mock("@/components/admin-list", () => ({
  AdminListPagination: () => null,
}));

function renderTab(props?: {
  selectedLogId?: string;
  onClearSelectedLog?: () => void;
}) {
  return render(
    <ServerLogsTab
      serverId="mcs_1"
      page={1}
      pageSize={20}
      onPageChange={() => {}}
      onPageSizeChange={() => {}}
      {...props}
    />,
  );
}

describe("ServerLogsTab deep-linking", () => {
  it("clears a stale ?log= param that does not resolve to the page", () => {
    const onClearSelectedLog = vi.fn();
    renderTab({ selectedLogId: "log_missing", onClearSelectedLog });

    expect(onClearSelectedLog).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the detail dialog for a deep-linked log in the page", async () => {
    renderTab({ selectedLogId: "log_1", onClearSelectedLog: vi.fn() });

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Call detail")).toBeInTheDocument();
  });

  it("opens the detail dialog from a row click", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole("button", { name: /^view$/i }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Call detail")).toBeInTheDocument();
  });
});
