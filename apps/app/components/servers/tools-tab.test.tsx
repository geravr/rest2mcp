import { render, screen, within } from "@testing-library/react";
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
};

type GroupRow = {
  id: string;
  name: string;
  normalizedName: string;
  toolCount: number;
  createdAt: Date;
  updatedAt: Date;
};

function tool(id: string, name: string): ToolRow {
  return {
    id,
    name,
    method: "GET",
    requestDefinition: null,
    enabled: true,
    allowMutation: false,
    compileStatus: "ready",
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
const listContacts = tool("mct_2", "list_contacts");
const sendInvoice = tool("mct_3", "send_invoice");
const archiveInvoice = tool("mct_4", "archive_invoice");
const getInvoice = tool("mct_5", "get_invoice");

// Keyed the way the API keys its own responses, so a client-side slice of the
// unfiltered page cannot pass the server-side filtering assertions.
const TOOL_RESPONSES: Record<string, { items: ToolRow[]; total: number }> = {
  all: { items: [getContact, listContacts, sendInvoice], total: 5 },
  mtg_1: { items: [sendInvoice], total: 2 },
  mtg_2: { items: [getContact, listContacts], total: 2 },
  ungrouped: { items: [listContacts], total: 3 },
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

const toolsInputs: Array<{ page: number; pageSize: number; group?: string }> =
  [];
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

vi.mock("@/hooks/use-mcp", () => ({
  useMcpTools: (
    _serverId: string,
    input: { page: number; pageSize: number; group?: string },
  ) => {
    toolsInputs.push({ ...input });
    const key =
      input.group === undefined || input.group === "all" ? "all" : input.group;
    const response = TOOL_RESPONSES[key] ?? { items: [], total: 0 };
    return {
      data: {
        items: response.items,
        page: input.page,
        pageSize: input.pageSize,
        total: response.total,
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
}));

function renderTab(
  options: {
    initialGroup?: string;
    initialPage?: number;
    toolCount?: number;
    onGroupChange?: (next: string | undefined) => void;
  } = {},
) {
  const {
    initialGroup,
    initialPage = 1,
    toolCount = 5,
    onGroupChange,
  } = options;

  function Harness() {
    const [page, setPage] = useState(initialPage);
    const [group, setGroup] = useState<string | undefined>(initialGroup);
    return (
      <ServerToolsTab
        serverId="mcs_1"
        configRevision={9}
        toolCount={toolCount}
        page={page}
        pageSize={10}
        group={group}
        onPageChange={setPage}
        onPageSizeChange={() => undefined}
        onGroupChange={(next) => {
          onGroupChange?.(next);
          // Mirrors the route: one replace navigation that also clears the page.
          setGroup(next);
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

beforeEach(() => {
  groupsFixture = [group("mtg_1", "Invoices", 2), group("mtg_2", "Bills", 2)];
  toolsInputs.length = 0;
  curlDialogProps.length = 0;
  manualDialogProps.length = 0;
  openApiDialogProps.length = 0;
  createGroupMutate.mockReset();
  renameGroupMutate.mockReset();
  deleteGroupMutate.mockReset();
  assignGroupMutate.mockReset();
});

describe("ServerToolsTab group filter", () => {
  it("lists All with the server total, Ungrouped, and every group with its count", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(groupFilter());

    expect(
      screen.getByRole("option", { name: "All · 5 tools" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Ungrouped" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Invoices · 2 tools" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Bills · 2 tools" }),
    ).toBeInTheDocument();
  });

  it("reports All as unfiltered, Ungrouped, and a group id", async () => {
    const user = userEvent.setup();
    const onGroupChange = vi.fn();
    renderTab({ onGroupChange });

    await user.click(groupFilter());
    await user.click(screen.getByRole("option", { name: "Ungrouped" }));
    expect(onGroupChange).toHaveBeenLastCalledWith("ungrouped");

    await user.click(groupFilter());
    await user.click(screen.getByRole("option", { name: /^Bills/ }));
    expect(onGroupChange).toHaveBeenLastCalledWith("mtg_2");

    await user.click(groupFilter());
    await user.click(screen.getByRole("option", { name: "All" }));
    expect(onGroupChange).toHaveBeenLastCalledWith(undefined);
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

  it("omits the All count while a filter is active", async () => {
    const user = userEvent.setup();
    renderTab({ initialGroup: "mtg_1" });

    await user.click(groupFilter());

    expect(screen.getByRole("option", { name: "All" })).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /All ·/ }),
    ).not.toBeInTheDocument();
  });

  it("returns to the first page when the filter changes", async () => {
    const user = userEvent.setup();
    const onGroupChange = vi.fn();
    renderTab({ initialPage: 3, onGroupChange });

    expect(toolsInputs.at(-1)).toMatchObject({ page: 3 });

    await user.click(groupFilter());
    await user.click(screen.getByRole("option", { name: /^Bills/ }));

    expect(onGroupChange).toHaveBeenCalledWith("mtg_2");
    expect(toolsInputs.at(-1)).toMatchObject({ page: 1, group: "mtg_2" });
  });

  it("keeps the empty state when the filter matches no tools", () => {
    renderTab({ initialGroup: "mtg_missing" });

    expect(
      screen.getByText(/no tools yet\. add a get tool/i),
    ).toBeInTheDocument();
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

  it("renames the group that is currently filtered", async () => {
    const user = userEvent.setup();
    renderTab({ initialGroup: "mtg_1" });

    await user.click(screen.getByRole("button", { name: "Rename group" }));

    const menu = await screen.findByRole("menu");
    const targets = within(menu).getAllByRole("menuitem");
    expect(targets.map((target) => target.textContent)).toEqual(["Invoices"]);

    await user.click(targets[0] as HTMLElement);

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

  it("offers every group for deletion when no filter is active", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole("button", { name: "Delete group" }));

    const menu = await screen.findByRole("menu");
    const targets = within(menu).getAllByRole("menuitem");
    expect(targets.map((target) => target.textContent)).toEqual([
      "Invoices",
      "Bills",
    ]);

    await user.click(targets[1] as HTMLElement);

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

describe("ServerToolsTab tool moves", () => {
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

  it("moves every selected row from the bulk action bar", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole("checkbox", { name: "get_contact" }));
    await user.click(screen.getByRole("checkbox", { name: "list_contacts" }));

    const bulkBar = screen.getByText("2 tools").parentElement;
    expect(bulkBar).not.toBeNull();

    await user.click(
      within(bulkBar as HTMLElement).getByRole("button", {
        name: "Move tools",
      }),
    );

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(/move the 2 selected tools to a group/i),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: "Move tools" }),
    );

    expect(assignGroupMutate).toHaveBeenCalledWith(
      expect.objectContaining({ toolIds: ["mct_1", "mct_2"] }),
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
      screen.queryByRole("button", { name: "Move tools" }),
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
      screen.queryByRole("button", { name: "Move tools" }),
    ).not.toBeInTheDocument();
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

  it("disables every creation action at the tool cap", () => {
    renderTab({ toolCount: 50 });

    expect(
      screen.getByText(/50 tools, the current limit/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add tool/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Import curl" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Import OpenAPI" }),
    ).toBeDisabled();
  });

  it("keeps creation disabled at the cap while a filter hides most tools", () => {
    renderTab({ toolCount: 50, initialGroup: "mtg_1" });

    expect(screen.getByRole("button", { name: /add tool/i })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Import OpenAPI" }),
    ).toBeDisabled();
  });
});
