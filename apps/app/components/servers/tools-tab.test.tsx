import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServerToolsTab } from "./tools-tab";

type ToolRow = {
  id: string;
  name: string;
  method: string;
  requestDefinition: unknown;
  enabled: boolean;
  allowMutation: boolean;
  compileStatus: string;
  groupId?: string | null;
};

type GroupRow = {
  id: string;
  name: string;
  normalizedName: string;
  toolCount: number;
  createdAt: Date;
  updatedAt: Date;
};

function tool(id: string, name: string, groupId?: string): ToolRow {
  return {
    id,
    name,
    method: "GET",
    requestDefinition: null,
    enabled: true,
    allowMutation: false,
    compileStatus: "ready",
    groupId,
  };
}

function group(id: string, name: string, toolCount: number): GroupRow {
  return {
    id,
    name,
    normalizedName: name.toLowerCase(),
    toolCount,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

const getContact = tool("mct_1", "get_contact");
const listContacts = tool("mct_2", "list_contacts", "mtg_2");
const sendInvoice = tool("mct_3", "send_invoice", "mtg_1");
const archiveInvoice = tool("mct_4", "archive_invoice");
const getInvoice = tool("mct_5", "get_invoice");

// Keyed the way the API keys its own responses, so a client-side slice of the
// unfiltered page cannot pass the server-side filtering assertions.
const TOOL_RESPONSES: Record<string, { items: ToolRow[]; total: number }> = {
  all: { items: [getContact, listContacts, sendInvoice], total: 5 },
  mtg_1: { items: [sendInvoice], total: 2 },
  mtg_2: { items: [getContact, listContacts], total: 2 },
  ungrouped: { items: [getContact], total: 1 },
};

// The server detail the route already loads: every tool, no page or filter.
const SERVER_TOOLS = [
  getContact,
  listContacts,
  sendInvoice,
  archiveInvoice,
  getInvoice,
];

let groupsFixture: GroupRow[] = [];

const toolsInputs: Array<{
  page: number;
  pageSize: number;
  group?: string;
  q?: string;
}> = [];
const manualDialogProps: Array<{
  groups?: GroupRow[];
  initialGroupId?: string;
}> = [];
const curlDialogProps: Array<{
  serverId: string;
  configRevision: number;
  groups?: GroupRow[];
  initialGroupId?: string;
}> = [];
const openApiDialogProps: Array<{
  initialGroupId?: string;
  existingToolNames?: readonly string[];
  onReviewTools?: () => void;
}> = [];
const createGroupMutate = vi.fn();
const renameGroupMutate = vi.fn();
const deleteGroupMutate = vi.fn();
const assignGroupMutate = vi.fn();
const deleteToolMutate = vi.fn();

vi.mock("@/components/admin-list", () => ({
  AdminListPagination: () => null,
}));

vi.mock("@/components/servers/tool-form-dialog", () => ({
  ToolFormDialog: (props: { groups?: GroupRow[]; initialGroupId?: string }) => {
    manualDialogProps.push(props);
    return <div role="dialog" aria-label="Add tool" />;
  },
}));

vi.mock("@/components/servers/curl-import-dialog", () => ({
  CurlImportDialog: (props: {
    serverId: string;
    configRevision: number;
    groups?: GroupRow[];
    initialGroupId?: string;
  }) => {
    curlDialogProps.push(props);
    return <div role="dialog" aria-label="Import curl" />;
  },
}));

vi.mock("@/components/servers/openapi-import-dialog", () => ({
  OpenApiImportDialog: (props: {
    initialGroupId?: string;
    existingToolNames?: readonly string[];
    onReviewTools?: () => void;
  }) => {
    openApiDialogProps.push(props);
    return (
      <div role="dialog" aria-label="Import from OpenAPI">
        <button type="button" onClick={() => props.onReviewTools?.()}>
          Review imported tools
        </button>
      </div>
    );
  },
}));

const optimizeMocks = vi.hoisted(() => ({
  aiReady: true,
  dialogProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/components/servers/ai-optimize-dialog", () => ({
  AiOptimizeDialog: (props: Record<string, unknown>) => {
    if (props.scope !== null) optimizeMocks.dialogProps.push(props);
    return null;
  },
}));

vi.mock("@/hooks/use-ai-readiness-guard", () => ({
  useAiFeatureReadiness: () => ({
    ready: optimizeMocks.aiReady,
    reason: optimizeMocks.aiReady ? null : "no_selection",
    isLoading: false,
  }),
  AiSettingsCta: () => <div role="note">settings-cta</div>,
}));

vi.mock("@/hooks/use-mcp", () => ({
  useMcpTools: (
    _serverId: string,
    input: { page: number; pageSize: number; group?: string; q?: string },
  ) => {
    toolsInputs.push({ ...input });
    const key =
      input.group === undefined || input.group === "all" ? "all" : input.group;
    const response = TOOL_RESPONSES[key] ?? { items: [], total: 0 };
    // Mirrors the server-side name predicate instead of a client-side slice.
    const query = input.q?.toLowerCase();
    const items = query
      ? response.items.filter((item) => item.name.toLowerCase().includes(query))
      : response.items;
    return {
      data: {
        items,
        page: input.page,
        pageSize: input.pageSize,
        total: input.q ? items.length : response.total,
      },
      isLoading: false,
      isError: false,
      error: null,
    };
  },
  useMcpToolGroups: () => ({
    data: groupsFixture,
    isLoading: false,
    isError: false,
  }),
  useMcpServer: () => ({
    data: { tools: SERVER_TOOLS },
    isLoading: false,
    isError: false,
  }),
  useMcpVariables: () => ({ data: [] }),
  useUpdateMcpTool: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateMcpToolGroup: () => ({
    mutate: createGroupMutate,
    isPending: false,
    error: null,
  }),
  useRenameMcpToolGroup: () => ({
    mutate: renameGroupMutate,
    isPending: false,
    error: null,
  }),
  useDeleteMcpToolGroup: () => ({
    mutate: deleteGroupMutate,
    isPending: false,
    error: null,
  }),
  useAssignMcpToolGroup: () => ({
    mutate: assignGroupMutate,
    isPending: false,
    error: null,
  }),
  useDeleteMcpTool: () => ({
    mutate: deleteToolMutate,
    isPending: false,
  }),
}));

function renderTab(
  options: {
    initialGroup?: string;
    initialQ?: string;
    initialPage?: number;
    toolCount?: number;
    toolLimit?: number;
    onGroupChange?: (next: string | undefined) => void;
    onSearchChange?: (next: string | undefined) => void;
  } = {},
) {
  const {
    initialGroup,
    initialQ,
    initialPage = 1,
    toolCount = 5,
    toolLimit = 50,
    onGroupChange,
    onSearchChange,
  } = options;

  function Harness() {
    const [page, setPage] = useState(initialPage);
    const [group, setGroup] = useState<string | undefined>(initialGroup);
    const [q, setQ] = useState<string | undefined>(initialQ);
    return (
      <ServerToolsTab
        serverId="mcs_1"
        configRevision={9}
        toolCount={toolCount}
        toolLimit={toolLimit}
        page={page}
        pageSize={10}
        group={group}
        q={q}
        onPageChange={setPage}
        onPageSizeChange={() => undefined}
        onGroupChange={(next) => {
          onGroupChange?.(next);
          // Mirrors the route: one replace navigation that also clears the page.
          setGroup(next);
          setPage(1);
        }}
        onSearchChange={(next) => {
          onSearchChange?.(next);
          // Mirrors the route: one replace navigation that also clears the page.
          setQ(next);
          setPage(1);
        }}
      />
    );
  }

  return render(<Harness />);
}

function groupFilter() {
  return screen.getByRole("combobox", { name: /filter by group/i });
}

function railEntryButton(name: string | RegExp) {
  return screen.getByRole("button", { name });
}

function groupRailMenu(name: string) {
  return screen.getByRole("button", { name: `Actions for ${name}` });
}

function makeDataTransfer() {
  const store = new Map<string, string>();
  return {
    setData: (type: string, value: string) => store.set(type, value),
    getData: (type: string) => store.get(type) ?? "",
    effectAllowed: "all",
    dropEffect: "none",
  };
}

beforeEach(() => {
  optimizeMocks.aiReady = true;
  optimizeMocks.dialogProps = [];
  groupsFixture = [group("mtg_1", "Invoices", 2), group("mtg_2", "Bills", 2)];
  toolsInputs.length = 0;
  curlDialogProps.length = 0;
  manualDialogProps.length = 0;
  openApiDialogProps.length = 0;
  createGroupMutate.mockReset();
  renameGroupMutate.mockReset();
  deleteGroupMutate.mockReset();
  assignGroupMutate.mockReset();
  deleteToolMutate.mockReset();
});

describe("ServerToolsTab group rail", () => {
  it("lists All with the server total, Ungrouped, and every group with its count", () => {
    renderTab();

    expect(railEntryButton(/^All/)).toHaveTextContent("5");
    expect(railEntryButton(/^All/)).toHaveAttribute("aria-current", "true");
    expect(railEntryButton(/^Ungrouped/)).toHaveTextContent("1");
    expect(railEntryButton(/^Invoices/)).toHaveTextContent("2");
    expect(railEntryButton(/^Bills/)).toHaveTextContent("2");
    expect(railEntryButton(/^Bills/)).not.toHaveAttribute("aria-current");
  });

  it("highlights All for the all URL sentinel", () => {
    renderTab({ initialGroup: "all" });

    expect(toolsInputs.at(-1)).toMatchObject({ group: "all" });
    expect(railEntryButton(/^All/)).toHaveAttribute("aria-current", "true");
    expect(railEntryButton(/^Bills/)).not.toHaveAttribute("aria-current");
  });

  it("selects a group from the rail and reports All as unfiltered", async () => {
    const user = userEvent.setup();
    const onGroupChange = vi.fn();
    renderTab({ onGroupChange });

    await user.click(railEntryButton(/^Bills/));
    expect(onGroupChange).toHaveBeenLastCalledWith("mtg_2");

    await user.click(railEntryButton(/^Ungrouped/));
    expect(onGroupChange).toHaveBeenLastCalledWith("ungrouped");

    await user.click(railEntryButton(/^All/));
    expect(onGroupChange).toHaveBeenLastCalledWith(undefined);
  });

  it("resets the page when the filter changes from the rail", async () => {
    const user = userEvent.setup();
    renderTab({ initialPage: 3 });

    await user.click(railEntryButton(/^Bills/));

    expect(toolsInputs.at(-1)).toMatchObject({ page: 1, group: "mtg_2" });
  });

  it("keeps the ungrouped filter server-side", () => {
    renderTab({ initialGroup: "ungrouped" });

    expect(toolsInputs.at(-1)).toMatchObject({ group: "ungrouped" });
    expect(screen.getByText("get_contact")).toBeInTheDocument();
    expect(screen.queryByText("send_invoice")).not.toBeInTheDocument();
  });

  it("queries the server with the group instead of slicing the page client-side", () => {
    renderTab({ initialGroup: "mtg_1" });

    expect(toolsInputs.at(-1)).toEqual({
      page: 1,
      pageSize: 10,
      group: "mtg_1",
    });
    expect(screen.getByText("send_invoice")).toBeInTheDocument();
    expect(screen.queryByText("get_contact")).not.toBeInTheDocument();
  });

  it("shows the filtered context header for a group and for Ungrouped", () => {
    renderTab({ initialGroup: "mtg_1" });
    expect(screen.getByText("Tools in Invoices")).toBeInTheDocument();

    renderTab({ initialGroup: "ungrouped" });
    expect(screen.getByText("Tools in Ungrouped")).toBeInTheDocument();
  });

  it("keeps the compact select fallback in sync with the rail", async () => {
    const user = userEvent.setup();
    const onGroupChange = vi.fn();
    renderTab({ onGroupChange });

    await user.click(groupFilter());
    await user.click(screen.getByRole("option", { name: /^Bills/ }));
    expect(onGroupChange).toHaveBeenLastCalledWith("mtg_2");
  });

  it("shows the empty group state for a real empty group", () => {
    groupsFixture = [...groupsFixture, group("mtg_0", "Empty", 0)];
    renderTab({ initialGroup: "mtg_0" });

    expect(
      screen.getByText(/this group has no tools yet/i),
    ).toBeInTheDocument();
  });

  it("resets a stale group filter whose group no longer exists", async () => {
    const onGroupChange = vi.fn();
    renderTab({ initialGroup: "mtg_missing", onGroupChange });

    await waitFor(() => expect(onGroupChange).toHaveBeenCalledWith(undefined));
    await waitFor(() =>
      expect(toolsInputs.at(-1)).toEqual({
        page: 1,
        pageSize: 10,
      }),
    );
  });
});

describe("ServerToolsTab group management", () => {
  it("opens the create dialog with the current group count", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole("button", { name: "Create group" }));

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "New group" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Group name")).toHaveValue("");
  });

  it("disables group creation at the 50-group limit", () => {
    groupsFixture = Array.from({ length: 50 }, (_, index) =>
      group(`mtg_${index}`, `Group ${index}`, 0),
    );
    renderTab();

    expect(screen.getByRole("button", { name: "Create group" })).toBeDisabled();
  });

  it("renames a group from its rail menu", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(groupRailMenu("Invoices"));
    await user.click(
      await screen.findByRole("menuitem", { name: "Rename group" }),
    );

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Rename group" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Group name")).toHaveValue("Invoices");

    await user.click(
      within(dialog).getByRole("button", { name: "Rename group" }),
    );

    expect(renameGroupMutate).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: "mtg_1", name: "Invoices" }),
      expect.anything(),
    );
  });

  it("deletes a group from its rail menu without touching the others", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(groupRailMenu("Bills"));
    await user.click(
      await screen.findByRole("menuitem", { name: "Delete group" }),
    );

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Delete group" }),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: "Delete group" }),
    );

    expect(deleteGroupMutate).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: "mtg_2" }),
      expect.anything(),
    );
  });
});

describe("ServerToolsTab drag and drop", () => {
  it("assigns a dragged row to the dropped group", async () => {
    renderTab();

    const dataTransfer = makeDataTransfer();
    const row = screen.getByText("get_contact").closest("tr");
    expect(row).not.toBeNull();
    fireEvent.dragStart(row as HTMLElement, { dataTransfer });
    fireEvent.drop(railEntryButton(/^Bills/).parentElement as HTMLElement, {
      dataTransfer,
    });

    expect(assignGroupMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        toolIds: ["mct_1"],
        groupId: "mtg_2",
        expectedRevision: 9,
      }),
    );
  });

  it("ungroups a dragged row dropped on Ungrouped", async () => {
    renderTab();

    const dataTransfer = makeDataTransfer();
    const row = screen.getByText("get_contact").closest("tr");
    fireEvent.dragStart(row as HTMLElement, { dataTransfer });
    fireEvent.drop(railEntryButton(/^Ungrouped/).parentElement as HTMLElement, {
      dataTransfer,
    });

    expect(assignGroupMutate).toHaveBeenCalledWith(
      expect.objectContaining({ toolIds: ["mct_1"], groupId: null }),
    );
  });

  it("drags the whole selection when the dragged row is selected", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole("checkbox", { name: "get_contact" }));
    await user.click(screen.getByRole("checkbox", { name: "list_contacts" }));

    const dataTransfer = makeDataTransfer();
    const row = screen.getByText("get_contact").closest("tr");
    fireEvent.dragStart(row as HTMLElement, { dataTransfer });
    fireEvent.drop(railEntryButton(/^Ungrouped/).parentElement as HTMLElement, {
      dataTransfer,
    });

    expect(assignGroupMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        toolIds: ["mct_1", "mct_2"],
        groupId: null,
      }),
    );
  });

  it("ignores drops without a tool payload", () => {
    renderTab();

    fireEvent.drop(railEntryButton(/^Bills/).parentElement as HTMLElement, {
      dataTransfer: makeDataTransfer(),
    });

    expect(assignGroupMutate).not.toHaveBeenCalled();
  });
});

describe("ServerToolsTab selection bar", () => {
  it("moves every selected row with the direct move-to control", async () => {
    const user = userEvent.setup();
    assignGroupMutate.mockImplementation(
      (_input: unknown, options?: { onSuccess?: () => void }) => {
        options?.onSuccess?.();
      },
    );
    renderTab();

    await user.click(screen.getByRole("checkbox", { name: "get_contact" }));
    await user.click(screen.getByRole("checkbox", { name: "list_contacts" }));

    await user.click(screen.getByRole("button", { name: "Move to…" }));
    await user.click(await screen.findByRole("menuitem", { name: "Invoices" }));

    expect(assignGroupMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        toolIds: ["mct_1", "mct_2"],
        groupId: "mtg_1",
        expectedRevision: 9,
      }),
      expect.anything(),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Move to…" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("selects and clears every visible row from the header checkbox", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(
      screen.getByRole("checkbox", { name: "Select all tools on this page" }),
    );

    expect(screen.getByRole("checkbox", { name: "get_contact" })).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "list_contacts" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "send_invoice" }),
    ).toBeChecked();
    expect(
      screen.getByRole("button", { name: "Move to…" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("checkbox", { name: "Select all tools on this page" }),
    );

    expect(
      screen.getByRole("checkbox", { name: "get_contact" }),
    ).not.toBeChecked();
    expect(
      screen.queryByRole("button", { name: "Move to…" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the narrow fallback count server-wide while search filters", () => {
    renderTab({ initialQ: "invo" });

    expect(groupFilter()).toHaveTextContent("All · 5 tools");
  });

  it("removes the selection from the active group", async () => {
    const user = userEvent.setup();
    renderTab({ initialGroup: "mtg_1" });

    await user.click(screen.getByRole("checkbox", { name: "send_invoice" }));
    await user.click(screen.getByRole("button", { name: "Move to…" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Ungrouped" }),
    );

    expect(assignGroupMutate).toHaveBeenCalledWith(
      expect.objectContaining({ toolIds: ["mct_3"], groupId: null }),
      expect.anything(),
    );
  });

  it("clears the selection when the group filter changes", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole("checkbox", { name: "get_contact" }));
    expect(screen.getByRole("checkbox", { name: "get_contact" })).toBeChecked();

    await user.click(groupFilter());
    await user.click(screen.getByRole("option", { name: /^Bills/ }));

    expect(
      screen.getByRole("checkbox", { name: "get_contact" }),
    ).not.toBeChecked();
    expect(
      screen.queryByRole("button", { name: "Move to…" }),
    ).not.toBeInTheDocument();
  });

  it("does not resurrect a selection after leaving and re-entering the filter", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole("checkbox", { name: "get_contact" }));

    await user.click(groupFilter());
    await user.click(screen.getByRole("option", { name: /^Bills/ }));
    await user.click(groupFilter());
    await user.click(screen.getByRole("option", { name: "All" }));

    expect(
      screen.getByRole("checkbox", { name: "get_contact" }),
    ).not.toBeChecked();
    expect(
      screen.queryByRole("button", { name: "Move to…" }),
    ).not.toBeInTheDocument();
  });
});

describe("ServerToolsTab tool search", () => {
  it("submits the trimmed query to the server and resets the page", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    renderTab({ initialPage: 3, onSearchChange });

    await user.type(screen.getByRole("searchbox"), "  invo  ");

    await waitFor(() => {
      expect(onSearchChange).toHaveBeenCalledWith("invo");
    });
    await waitFor(() => {
      expect(toolsInputs.at(-1)).toMatchObject({ page: 1, q: "invo" });
    });
  });

  it("narrows rows and total through the server predicate", () => {
    renderTab({ initialQ: "invo" });

    expect(toolsInputs.at(-1)).toMatchObject({ q: "invo" });
    expect(screen.getByText("send_invoice")).toBeInTheDocument();
    expect(screen.queryByText("get_contact")).not.toBeInTheDocument();
  });

  it("combines the search with the active group filter", () => {
    renderTab({ initialGroup: "mtg_1", initialQ: "send" });

    expect(toolsInputs.at(-1)).toMatchObject({ group: "mtg_1", q: "send" });
    expect(screen.getByText("send_invoice")).toBeInTheDocument();
  });

  it("reports an empty search without abandoning the filter", () => {
    renderTab({ initialGroup: "mtg_1", initialQ: "nothing" });

    expect(screen.getByText(/no tools match/i)).toBeInTheDocument();
  });

  it("submits an empty query as unfiltered", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    renderTab({ initialQ: "invo", onSearchChange });

    await user.clear(screen.getByRole("searchbox"));

    await waitFor(() => {
      expect(onSearchChange).toHaveBeenCalledWith(undefined);
    });
  });
});

describe("ServerToolsTab single-row moves", () => {
  it("moves a single row from its action menu", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole("button", { name: "get_contact" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Move tools" }),
    );

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(/move the selected tool to a group/i),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: "Move tools" }),
    );

    expect(assignGroupMutate).toHaveBeenCalledWith(
      expect.objectContaining({ toolIds: ["mct_1"], groupId: null }),
      expect.anything(),
    );
  });
});

describe("ServerToolsTab OpenAPI import", () => {
  it("preselects the filtered group and drops the filter on review", async () => {
    const user = userEvent.setup();
    const onGroupChange = vi.fn();
    renderTab({ initialGroup: "mtg_1", onGroupChange });

    await user.click(screen.getByRole("button", { name: "Import OpenAPI" }));

    expect(openApiDialogProps.at(-1)).toMatchObject({
      initialGroupId: "mtg_1",
      // The server-wide list, not the single row this filtered page shows.
      existingToolNames: [
        "get_contact",
        "list_contacts",
        "send_invoice",
        "archive_invoice",
        "get_invoice",
      ],
    });

    await user.click(
      screen.getByRole("button", { name: "Review imported tools" }),
    );

    expect(onGroupChange).toHaveBeenCalledWith(undefined);
  });

  it("flags names used by tools outside the current page or filter", async () => {
    const user = userEvent.setup();
    renderTab({ initialGroup: "mtg_1" });

    expect(screen.queryByText("archive_invoice")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Import OpenAPI" }));

    expect(openApiDialogProps.at(-1)?.existingToolNames).toContain(
      "archive_invoice",
    );
  });

  it("passes no initial group when the filter is All or Ungrouped", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole("button", { name: "Import OpenAPI" }));
    expect(openApiDialogProps.at(-1)?.initialGroupId).toBeUndefined();

    await user.click(
      screen.getByRole("button", { name: "Review imported tools" }),
    );
    await user.click(groupFilter());
    await user.click(screen.getByRole("option", { name: "Ungrouped" }));
    await user.click(screen.getByRole("button", { name: "Import OpenAPI" }));

    expect(openApiDialogProps.at(-1)?.initialGroupId).toBeUndefined();
  });
});

describe("ServerToolsTab existing behavior", () => {
  it("keeps the curl import entry point", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole("button", { name: "Import curl" }));

    expect(curlDialogProps.at(-1)).toMatchObject({
      serverId: "mcs_1",
      configRevision: 9,
    });
  });

  it("hands the loaded groups to the manual and curl dialogs", async () => {
    const user = userEvent.setup();
    const groups = [group("mtg_1", "Customers", 2)];
    groupsFixture = groups;
    renderTab();

    await user.click(screen.getByRole("button", { name: "Add tool" }));
    expect(manualDialogProps.at(-1)?.groups).toEqual(groups);

    await user.click(screen.getByRole("button", { name: "Import curl" }));
    expect(curlDialogProps.at(-1)?.groups).toEqual(groups);
  });

  it("disables every creation action at the tool cap", async () => {
    const user = userEvent.setup();
    renderTab({ toolCount: 50 });

    expect(screen.getByText(/50 tools; the limit is 50/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add tool/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Import curl" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Import OpenAPI" }),
    ).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "get_contact" }));
    expect(
      await screen.findByRole("menuitem", { name: "Duplicate" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("keeps creation disabled at the cap while a filter hides most tools", () => {
    renderTab({ toolCount: 50, initialGroup: "mtg_1" });

    expect(screen.getByRole("button", { name: /add tool/i })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Import OpenAPI" }),
    ).toBeDisabled();
  });

  it("reports the configured cap in the alert", () => {
    renderTab({ toolCount: 12, toolLimit: 12 });

    expect(screen.getByText(/12 tools; the limit is 12/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add tool/i })).toBeDisabled();
  });

  it("reports the surplus when the cap is below the tool count", () => {
    renderTab({ toolCount: 20, toolLimit: 6 });

    expect(screen.getByText(/20 tools; the limit is 6/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add tool/i })).toBeDisabled();
  });

  it("keeps creation enabled when the configured cap is higher", async () => {
    const user = userEvent.setup();
    renderTab({ toolCount: 50, toolLimit: 80 });

    expect(screen.queryByText(/the limit is/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add tool/i })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "get_contact" }));
    expect(
      await screen.findByRole("menuitem", { name: "Duplicate" }),
    ).not.toHaveAttribute("aria-disabled", "true");
  });
});

describe("ServerToolsTab AI optimization entry points", () => {
  it("disables optimization controls and shows the settings CTA when AI is not ready", async () => {
    optimizeMocks.aiReady = false;
    const user = userEvent.setup();
    renderTab();
    await user.click(screen.getByRole("checkbox", { name: "get_contact" }));
    expect(
      screen.getByRole("button", { name: /optimize selected with ai/i }),
    ).toBeDisabled();
    expect(screen.getByRole("note")).toHaveTextContent("settings-cta");
    optimizeMocks.aiReady = true;
  });

  it("opens the optimize dialog with the exact single-tool scope from the row menu", async () => {
    optimizeMocks.aiReady = true;
    optimizeMocks.dialogProps.length = 0;
    const user = userEvent.setup();
    renderTab();
    const firstRowMenu = await screen.findAllByRole("button", {
      name: "get_contact",
    });
    await user.click(firstRowMenu[0]!);
    await user.click(
      await screen.findByRole("menuitem", { name: /optimize with ai/i }),
    );
    expect(optimizeMocks.dialogProps.length).toBe(1);
    expect(optimizeMocks.dialogProps[0]!.scope).toEqual({
      kind: "single",
      toolIds: ["mct_1"],
    });
  });

  it("opens the optimize dialog with the explicitly selected rows", async () => {
    optimizeMocks.aiReady = true;
    optimizeMocks.dialogProps.length = 0;
    const user = userEvent.setup();
    renderTab();
    await user.click(screen.getByRole("checkbox", { name: "get_contact" }));
    await user.click(screen.getByRole("checkbox", { name: "list_contacts" }));
    await user.click(
      screen.getByRole("button", { name: /optimize selected with ai/i }),
    );
    expect(optimizeMocks.dialogProps[0]!.scope).toEqual({
      kind: "selected",
      toolIds: ["mct_1", "mct_2"],
    });
  });
});
