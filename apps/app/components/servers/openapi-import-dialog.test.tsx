import { getTranslations } from "@/i18n";
import {
  buildOpenApiSelection,
  describeOpenApiSecurityRequirement,
  filterOpenApiOperations,
  findOpenApiNameIssue,
  groupOpenApiOperations,
  hasOpenApiRequestSummary,
  isHttpsDocumentUrl,
  planFirstTagGroups,
  projectOpenApiCapacity,
  nextOpenApiSelection,
  selectOpenApiKeysUpToCapacity,
  readOpenApiDocumentFile,
  resolveOpenApiIssueDescription,
  splitOpenApiIssues,
  summarizeOpenApiRequest,
  withOpenApiKeys,
} from "@/lib/openapi-import";
import { MCP_OPENAPI_ISSUE_CODES } from "@repo/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenApiImportDialog } from "./openapi-import-dialog";

type FixtureIssue = {
  code: string;
  severity: "error" | "warning";
  message: string;
};

type FixtureOperation = {
  operationKey: string;
  method: string;
  path: string;
  tags: string[];
  deprecated: boolean;
  suggestedName: string;
  selectable: boolean;
  issues: FixtureIssue[];
  security: Array<{ name: string; type: string; in?: string; scheme?: string }>;
  description?: string;
  requestDefinition?: unknown;
};

type FixturePreview = {
  document: {
    version: string;
    title?: string;
    fingerprint: string;
    operationCount: number;
    selectableCount: number;
  };
  documentIssues: Array<{
    code: string;
    severity: "error" | "warning";
    message: string;
    path?: string;
  }>;
  operations: FixtureOperation[];
  suggestedGroups: Array<{
    tag: string;
    normalizedName: string;
    existingGroupId?: string;
    willCreate: boolean;
  }>;
  capacity: {
    toolLimit: number;
    currentTools: number;
    groupLimit: number;
    currentGroups: number;
  };
  sourceLabel: string;
  configRevision: number;
};

type FixtureConfirmResult = {
  revision: number;
  draftRevision: number;
  batchId: string;
  tools: Array<{ id: string; name: string; method: string; path: string }>;
  groups: Array<{ id: string; name: string; created: boolean }>;
};

const mocks = vi.hoisted(() => ({
  previewCalls: [] as unknown[],
  confirmCalls: [] as unknown[],
  groups: [] as Array<{ id: string; name: string }>,
  preview: null as unknown,
  previewError: null as unknown,
  confirm: (async () => ({})) as (input: unknown) => Promise<unknown>,
  locale: "en" as "en" | "es",
}));

const en = getTranslations("en");
const es = getTranslations("es");
const enOpenApi = en.openApiImport;
const esOpenApi = es.openApiImport;

vi.mock("@/i18n/use-translations", async () => {
  const { getTranslations: get } = await import("@/i18n");
  return {
    useTranslations: () => ({
      t: get(mocks.locale),
      locale: mocks.locale,
      setLocale: vi.fn(),
    }),
  };
});

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/lib/trpc", () => ({
  api: {
    mcp: {
      previewOpenApiImport: {
        mutationOptions: () => ({
          mutationFn: (input: unknown) => {
            mocks.previewCalls.push(input);
            return mocks.previewError === null
              ? Promise.resolve(mocks.preview)
              : Promise.reject(mocks.previewError);
          },
        }),
      },
      confirmOpenApiImport: {
        mutationOptions: () => ({
          mutationFn: (input: unknown) => {
            mocks.confirmCalls.push(input);
            return mocks.confirm(input);
          },
        }),
      },
      toolGroups: {
        queryOptions: () => ({
          queryKey: ["mcp", "toolGroups"],
          queryFn: () => Promise.resolve(mocks.groups),
        }),
        pathFilter: () => ({ queryKey: ["mcp", "toolGroups"] }),
      },
      tools: { pathFilter: () => ({ queryKey: ["mcp", "tools"] }) },
      getServer: { pathFilter: () => ({ queryKey: ["mcp", "getServer"] }) },
      publishPreview: {
        pathFilter: () => ({ queryKey: ["mcp", "publishPreview"] }),
      },
      servers: { pathFilter: () => ({ queryKey: ["mcp", "servers"] }) },
      // `useInvalidateMcp` refreshes every MCP procedure, so the mock exposes a
      // pathFilter for each one the dialog's hooks touch.
      tokens: { pathFilter: () => ({ queryKey: ["mcp", "tokens"] }) },
      variables: { pathFilter: () => ({ queryKey: ["mcp", "variables"] }) },
      serverCommon: {
        pathFilter: () => ({ queryKey: ["mcp", "serverCommon"] }),
      },
      callLogs: { pathFilter: () => ({ queryKey: ["mcp", "callLogs"] }) },
      revisionHistory: {
        pathFilter: () => ({ queryKey: ["mcp", "revisionHistory"] }),
      },
      revisionDetail: {
        pathFilter: () => ({ queryKey: ["mcp", "revisionDetail"] }),
      },
      platformTokens: {
        pathFilter: () => ({ queryKey: ["mcp", "platformTokens"] }),
      },
      platformSecurityEvents: {
        pathFilter: () => ({ queryKey: ["mcp", "platformSecurityEvents"] }),
      },
    },
  },
}));

function operation(
  overrides: Partial<FixtureOperation> &
    Pick<
      FixtureOperation,
      "operationKey" | "method" | "path" | "suggestedName"
    >,
): FixtureOperation {
  return {
    tags: [],
    deprecated: false,
    selectable: true,
    issues: [],
    security: [],
    ...overrides,
  };
}

function preview(
  operations: FixtureOperation[],
  overrides: Partial<Omit<FixturePreview, "operations">> = {},
): FixturePreview {
  return {
    document: {
      version: "3.1",
      title: "Contacts API",
      fingerprint: "fp_document_1",
      operationCount: operations.length,
      selectableCount: operations.filter((entry) => entry.selectable).length,
    },
    operations,
    documentIssues: [],
    suggestedGroups: [],
    capacity: {
      toolLimit: 50,
      currentTools: 0,
      groupLimit: 50,
      currentGroups: 0,
    },
    sourceLabel: "pasted",
    configRevision: 4,
    ...overrides,
  };
}

const contactsOperation = operation({
  operationKey: "listContacts",
  method: "GET",
  path: "/contacts",
  tags: ["contacts"],
  suggestedName: "list_contacts",
});

const invoicesOperation = operation({
  operationKey: "listInvoices",
  method: "GET",
  path: "/invoices",
  tags: ["invoices"],
  suggestedName: "list_invoices",
});

const apiError = (appCode: string) =>
  Object.assign(new Error("request failed"), { data: { appCode } });

function renderDialog(
  props: Partial<ComponentProps<typeof OpenApiImportDialog>> = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onClose = vi.fn();
  const onReviewTools = vi.fn();
  const view = render(
    (
      <QueryClientProvider client={client as unknown as never}>
        <OpenApiImportDialog
          serverId="mcs_1"
          configRevision={4}
          onClose={onClose}
          onReviewTools={onReviewTools}
          {...props}
        />
      </QueryClientProvider>
    ) as ReactNode,
  );
  return { ...view, onClose, onReviewTools };
}

async function previewPasteIn(
  user: ReturnType<typeof userEvent.setup>,
  copy: typeof enOpenApi,
) {
  await user.click(screen.getByRole("tab", { name: copy.sourcePaste }));
  const documentInput = screen.getByLabelText(copy.pasteLabel);
  await user.click(documentInput);
  await user.paste('{"openapi":"3.1.0"}');
  await user.click(screen.getByRole("button", { name: copy.preview }));
  await screen.findByText("OpenAPI 3.1");
}

async function previewPaste(user: ReturnType<typeof userEvent.setup>) {
  await previewPasteIn(user, enOpenApi);
}

async function selectOperation(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) {
  await user.click(screen.getByRole("checkbox", { name }));
}

beforeEach(() => {
  mocks.previewCalls.length = 0;
  mocks.confirmCalls.length = 0;
  mocks.groups = [];
  mocks.preview = null;
  mocks.previewError = null;
  mocks.locale = "en";
  mocks.confirm = async () => ({
    revision: 5,
    draftRevision: 5,
    batchId: "oab_1",
    tools: [],
    groups: [],
  });
});

describe("OpenApiImportDialog source modes", () => {
  it("submits pasted JSON content", async () => {
    const user = userEvent.setup();
    mocks.preview = preview([contactsOperation]);
    renderDialog();

    expect(screen.queryByText("OpenAPI 3.1")).not.toBeInTheDocument();
    await previewPaste(user);

    expect(mocks.previewCalls).toEqual([
      {
        serverId: "mcs_1",
        source: {
          kind: "content",
          content: '{"openapi":"3.1.0"}',
          label: "paste",
        },
      },
    ]);
    expect(screen.getByText("Contacts API")).toBeInTheDocument();
  });

  it("reads a selected JSON file locally and submits its content", async () => {
    const user = userEvent.setup();
    mocks.preview = preview([contactsOperation]);
    renderDialog();

    const file = new File(['{"openapi":"3.1.0"}'], "api.json", {
      type: "application/json",
    });
    fireEvent.change(screen.getByLabelText("JSON file"), {
      target: { files: [file] },
    });
    await user.click(screen.getByRole("button", { name: "Preview document" }));

    expect(mocks.previewCalls).toEqual([
      {
        serverId: "mcs_1",
        source: {
          kind: "content",
          content: '{"openapi":"3.1.0"}',
          label: "file",
        },
      },
    ]);
  });

  it("submits a public HTTPS URL without credentials or extra fields", async () => {
    const user = userEvent.setup();
    mocks.preview = preview([contactsOperation]);
    renderDialog();

    await user.click(screen.getByRole("tab", { name: "URL" }));
    await user.type(
      screen.getByLabelText("Document URL"),
      "https://api.example.com/openapi.json",
    );
    await user.click(screen.getByRole("button", { name: "Preview document" }));

    const [call] = mocks.previewCalls as [
      { serverId: string; source: Record<string, unknown> },
    ];
    expect(call.serverId).toBe("mcs_1");
    expect(call.source).toEqual({
      kind: "url",
      url: "https://api.example.com/openapi.json",
    });
    expect(Object.keys(call.source)).toEqual(["kind", "url"]);
  });

  it("keeps the three source modes mutually exclusive", async () => {
    const user = userEvent.setup();
    renderDialog();

    expect(screen.getByLabelText("JSON file")).toBeInTheDocument();
    expect(screen.queryByLabelText("Document JSON")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Paste JSON" }));
    expect(screen.getByLabelText("Document JSON")).toBeInTheDocument();
    expect(screen.queryByLabelText("JSON file")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Document URL")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "URL" }));
    expect(screen.getByLabelText("Document URL")).toBeInTheDocument();
    expect(screen.queryByLabelText("Document JSON")).not.toBeInTheDocument();
  });

  it("reports a rejected document and stays in the source phase", async () => {
    const user = userEvent.setup();
    mocks.previewError = apiError("MCP_OPENAPI_VERSION_UNSUPPORTED");
    renderDialog();

    await user.click(screen.getByRole("tab", { name: "Paste JSON" }));
    const documentInput = screen.getByLabelText("Document JSON");
    await user.click(documentInput);
    await user.paste('{"swagger":"2.0"}');
    await user.click(screen.getByRole("button", { name: "Preview document" }));

    expect(
      await screen.findByText(
        "The document could not be read. Fix the source and preview again.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Only OpenAPI 3.0 and 3.1 JSON documents can be imported.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Document JSON")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Search operations"),
    ).not.toBeInTheDocument();
  });

  it("rejects a non-JSON file and an oversized file without previewing", async () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText("JSON file"), {
      target: {
        files: [new File(["{}"], "api.txt", { type: "text/plain" })],
      },
    });
    expect(await screen.findByText("Choose a .json file.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Preview document" }),
    ).toBeDisabled();

    fireEvent.change(screen.getByLabelText("JSON file"), {
      target: {
        files: [
          new File([new ArrayBuffer(5 * 1024 * 1024 + 1)], "api.json", {
            type: "application/json",
          }),
        ],
      },
    });
    expect(
      await screen.findByText("That file is larger than the 5 MiB limit."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Preview document" }),
    ).toBeDisabled();
    expect(mocks.previewCalls).toHaveLength(0);
  });
});

describe("OpenApiImportDialog curation", () => {
  it("blocks an unsupported operation and keeps a deprecated one selectable", async () => {
    const user = userEvent.setup();
    mocks.preview = preview([
      operation({
        operationKey: "postUpload",
        method: "POST",
        path: "/uploads",
        tags: ["files"],
        suggestedName: "post_uploads",
        selectable: false,
        issues: [
          {
            code: MCP_OPENAPI_ISSUE_CODES.MULTIPART_BODY,
            severity: "error",
            message: "multipart bodies are not supported",
          },
        ],
      }),
      operation({
        operationKey: "getLegacy",
        method: "GET",
        path: "/legacy",
        tags: ["legacy"],
        suggestedName: "get_legacy",
        deprecated: true,
        issues: [
          {
            code: MCP_OPENAPI_ISSUE_CODES.DEPRECATED,
            severity: "warning",
            message: "operation is deprecated",
          },
        ],
      }),
    ]);
    renderDialog();
    await previewPaste(user);

    expect(
      screen.getByText("It sends a multipart or file body."),
    ).toBeInTheDocument();
    const blockedRow = screen.getByText("/uploads").closest("li");
    expect(
      within(blockedRow as HTMLElement).getByRole("checkbox"),
    ).toBeDisabled();
    // The sentence comes from the locale module, never the raw API code or the
    // API's own English `message`.
    expect(screen.queryAllByText(/OPENAPI_/)).toHaveLength(0);
    expect(
      screen.queryByText(/multipart bodies are not supported/),
    ).not.toBeInTheDocument();

    const deprecatedCheckbox = screen.getByRole("checkbox", {
      name: "GET /legacy",
    });
    expect(deprecatedCheckbox).toBeEnabled();
    await user.click(deprecatedCheckbox);
    expect(screen.getByRole("button", { name: "Import 1 tool" })).toBeEnabled();
  });

  it("reports a document-level blocker when a path could not be read", async () => {
    const user = userEvent.setup();
    mocks.preview = preview([contactsOperation], {
      documentIssues: [
        {
          code: "OPENAPI_EXTERNAL_REFERENCE",
          severity: "error",
          message: "unused English server message",
          path: "/paths/~1legacy",
        },
      ],
    });
    renderDialog();

    await previewPaste(user);

    expect(
      screen.getByText("Parts of this document cannot be read"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Part of it is defined outside this document\./),
    ).toBeInTheDocument();
    // The location is shown; the API's own English message never is.
    expect(screen.getByText("(/paths/~1legacy)")).toBeInTheDocument();
    expect(
      screen.queryByText("unused English server message"),
    ).not.toBeInTheDocument();
  });

  it("renders a blocker sentence in Spanish for the active locale", async () => {
    const user = userEvent.setup();
    mocks.locale = "es";
    mocks.preview = preview([
      operation({
        operationKey: "postUpload",
        method: "POST",
        path: "/uploads",
        suggestedName: "post_uploads",
        selectable: false,
        issues: [
          {
            code: MCP_OPENAPI_ISSUE_CODES.MULTIPART_BODY,
            severity: "error",
            message: "multipart bodies are not supported",
          },
        ],
      }),
    ]);
    renderDialog();
    await previewPasteIn(user, esOpenApi);

    expect(
      screen.getByText(
        esOpenApi.issueDescriptions[MCP_OPENAPI_ISSUE_CODES.MULTIPART_BODY],
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        enOpenApi.issueDescriptions[MCP_OPENAPI_ISSUE_CODES.MULTIPART_BODY],
      ),
    ).not.toBeInTheDocument();
    expect(screen.queryAllByText(/OPENAPI_/)).toHaveLength(0);
  });

  it("shows no request summary for a literal-only path and counts a templated one", async () => {
    const user = userEvent.setup();
    mocks.preview = preview([
      operation({
        operationKey: "getItem",
        method: "GET",
        path: "/items/{id}",
        suggestedName: "get_item",
        requestDefinition: {
          pathSegments: [
            { id: "p0", value: { kind: "literal", value: "items" } },
            { id: "p1", value: { kind: "agentInput", agentInputId: "ain_1" } },
          ],
          query: [
            { id: "q0", name: "limit", value: { kind: "literal", value: 10 } },
          ],
          headers: [],
          body: { bodyType: "none" },
        },
      }),
      operation({
        operationKey: "listItems",
        method: "GET",
        path: "/items",
        suggestedName: "list_items",
        requestDefinition: {
          pathSegments: [
            { id: "p0", value: { kind: "literal", value: "items" } },
          ],
          query: [],
          headers: [],
          body: { bodyType: "none" },
        },
      }),
    ]);
    renderDialog();
    await previewPaste(user);

    const templatedRow = screen
      .getByText("/items/{id}")
      .closest("li") as HTMLElement;
    await user.click(
      within(templatedRow).getByRole("button", { name: "Show details" }),
    );
    expect(
      within(templatedRow).getByText("path 1 · query 1 · header 0"),
    ).toBeInTheDocument();

    const literalRow = screen.getByText("/items").closest("li") as HTMLElement;
    await user.click(
      within(literalRow).getByRole("button", { name: "Show details" }),
    );
    expect(
      within(literalRow).getByText(enOpenApi.requestSummaryNone),
    ).toBeInTheDocument();
    expect(within(literalRow).queryByText(/^path /)).not.toBeInTheDocument();
  });

  it("never claims an empty request for a blocked operation without a definition", async () => {
    const user = userEvent.setup();
    mocks.preview = preview([
      operation({
        operationKey: "postUpload",
        method: "POST",
        path: "/uploads",
        tags: ["files"],
        suggestedName: "post_uploads",
        selectable: false,
        issues: [
          {
            code: MCP_OPENAPI_ISSUE_CODES.MULTIPART_BODY,
            severity: "error",
            message: "multipart bodies are not supported",
          },
        ],
      }),
    ]);
    renderDialog();
    await previewPaste(user);

    const row = screen.getByText("/uploads").closest("li") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Show details" }));

    // The operation declares a body; the blocker sentence is the whole truth
    // shown, and no empty-request claim is made about the omitted definition.
    expect(
      within(row).getByText("It sends a multipart or file body."),
    ).toBeInTheDocument();
    expect(
      within(row).queryByText(enOpenApi.requestSummaryNone),
    ).not.toBeInTheDocument();
    expect(
      within(row).queryByText(enOpenApi.requestSummary),
    ).not.toBeInTheDocument();
  });

  it("still reports an empty request for a selectable literal-only operation", async () => {
    const user = userEvent.setup();
    mocks.preview = preview([
      operation({
        operationKey: "listItems",
        method: "GET",
        path: "/items",
        suggestedName: "list_items",
        requestDefinition: {
          pathSegments: [
            { id: "p0", value: { kind: "literal", value: "items" } },
          ],
          query: [],
          headers: [],
          body: { bodyType: "none" },
        },
      }),
    ]);
    renderDialog();
    await previewPaste(user);

    const row = screen.getByText("/items").closest("li") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Show details" }));

    expect(within(row).getByText(enOpenApi.requestSummary)).toBeInTheDocument();
    expect(
      within(row).getByText(enOpenApi.requestSummaryNone),
    ).toBeInTheDocument();
  });

  it("groups operations by first tag and filters them by search", async () => {
    const user = userEvent.setup();
    mocks.preview = preview([
      operation({
        operationKey: "getUntagged",
        method: "GET",
        path: "/health",
        suggestedName: "get_health",
      }),
      invoicesOperation,
      contactsOperation,
    ]);
    renderDialog();
    await previewPaste(user);

    expect(screen.getByText("contacts")).toBeInTheDocument();
    expect(screen.getByText("invoices")).toBeInTheDocument();
    expect(screen.getByText("No tag")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Search operations"), "invoice");
    expect(screen.queryByText("/contacts")).not.toBeInTheDocument();
    expect(screen.getByText("/invoices")).toBeInTheDocument();
    expect(screen.queryByText("No tag")).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText("Search operations"));
    await user.type(screen.getByLabelText("Search operations"), "zzz");
    expect(
      screen.getByText("No operations match that search."),
    ).toBeInTheDocument();
  });

  it("blocks confirmation for an invalid, duplicated, or conflicting name", async () => {
    const user = userEvent.setup();
    mocks.preview = preview([contactsOperation, invoicesOperation]);
    renderDialog({ existingToolNames: ["invoices"] });
    await previewPaste(user);

    await selectOperation(user, "GET /contacts");
    await selectOperation(user, "GET /invoices");
    const importButton = screen.getByRole("button", { name: "Import 2 tools" });
    expect(importButton).toBeEnabled();
    const contactsRow = screen
      .getByText("/contacts")
      .closest("li") as HTMLElement;
    const invoicesRow = screen
      .getByText("/invoices")
      .closest("li") as HTMLElement;

    await user.clear(screen.getAllByLabelText("Tool name")[0]!);
    await user.type(screen.getAllByLabelText("Tool name")[0]!, "9bad");
    expect(
      within(contactsRow).getByText(
        "Use lowercase letters, numbers, and underscores.",
      ),
    ).toBeInTheDocument();
    expect(importButton).toBeDisabled();

    // Same name as the other selected operation.
    await user.clear(screen.getAllByLabelText("Tool name")[0]!);
    await user.type(screen.getAllByLabelText("Tool name")[0]!, "list_invoices");
    expect(
      within(contactsRow).getByText(
        "Another selected operation uses this name.",
      ),
    ).toBeInTheDocument();
    expect(importButton).toBeDisabled();

    // Name already used by a tool on this server.
    await user.clear(screen.getAllByLabelText("Tool name")[1]!);
    await user.type(screen.getAllByLabelText("Tool name")[1]!, "invoices");
    expect(
      within(invoicesRow).getByText("Already used by an existing tool."),
    ).toBeInTheDocument();
    expect(importButton).toBeDisabled();

    await user.clear(screen.getAllByLabelText("Tool name")[1]!);
    await user.type(screen.getAllByLabelText("Tool name")[1]!, "list_invoices");
    await user.clear(screen.getAllByLabelText("Tool name")[0]!);
    await user.type(screen.getAllByLabelText("Tool name")[0]!, "list_contacts");
    expect(importButton).toBeEnabled();
  });

  it("reports the tool capacity conflict before confirmation", async () => {
    const user = userEvent.setup();
    mocks.preview = preview([contactsOperation, invoicesOperation], {
      capacity: {
        toolLimit: 50,
        currentTools: 49,
        groupLimit: 50,
        currentGroups: 0,
      },
    });
    renderDialog();
    await previewPaste(user);

    expect(screen.getByText("49 of 50 tools used")).toBeInTheDocument();
    expect(
      screen.getByText("Select at least one operation to import."),
    ).toBeInTheDocument();

    await selectOperation(user, "GET /contacts");
    expect(screen.getByRole("button", { name: "Import 1 tool" })).toBeEnabled();
    expect(
      screen.getByText("1 tool slots remain on this server."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "GET /invoices" }),
    ).toBeDisabled();

    await selectOperation(user, "GET /invoices");
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import 1 tool" })).toBeEnabled();
    expect(
      screen.queryByText(
        "Importing 2 tools would exceed the 50-tool limit. This server already has 49.",
      ),
    ).not.toBeInTheDocument();
  });

  it("selects at most remaining capacity and shows remaining slots", async () => {
    const user = userEvent.setup();
    mocks.preview = preview(
      [
        contactsOperation,
        invoicesOperation,
        operation({
          operationKey: "listNotes",
          method: "GET",
          path: "/notes",
          suggestedName: "list_notes",
        }),
        operation({
          operationKey: "listTasks",
          method: "GET",
          path: "/tasks",
          suggestedName: "list_tasks",
        }),
      ],
      {
        capacity: {
          toolLimit: 80,
          currentTools: 78,
          groupLimit: 50,
          currentGroups: 0,
        },
      },
    );
    renderDialog();
    await previewPaste(user);

    expect(
      screen.getByText("2 tool slots remain on this server."),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Select all importable" }),
    );
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Import 2 tools" }),
    ).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "GET /notes" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "GET /tasks" })).toBeDisabled();

    await selectOperation(user, "GET /notes");
    expect(screen.getByText("2 selected")).toBeInTheDocument();

    await selectOperation(user, "GET /contacts");
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    await selectOperation(user, "GET /tasks");
    expect(screen.getByText("2 selected")).toBeInTheDocument();
  });
});

describe("OpenApiImportDialog group strategy", () => {
  it("imports ungrouped by default", async () => {
    const user = userEvent.setup();
    mocks.preview = preview([contactsOperation]);
    renderDialog();
    await previewPaste(user);
    await selectOperation(user, "GET /contacts");

    await user.click(screen.getByRole("button", { name: "Import 1 tool" }));

    expect(mocks.confirmCalls).toEqual([
      {
        serverId: "mcs_1",
        expectedRevision: 4,
        source: {
          kind: "content",
          content: '{"openapi":"3.1.0"}',
          label: "paste",
        },
        fingerprint: "fp_document_1",
        selection: [{ operationKey: "listContacts" }],
        groupStrategy: { kind: "ungrouped" },
      },
    ]);
  });

  it("sends the chosen existing group", async () => {
    const user = userEvent.setup();
    mocks.preview = preview([contactsOperation]);
    mocks.groups = [{ id: "mtg_1", name: "Customers" }];
    renderDialog({ initialGroupId: "mtg_1" });
    await previewPaste(user);
    await selectOperation(user, "GET /contacts");

    expect(
      screen.getByRole("radio", { name: "Add to an existing group" }),
    ).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Import 1 tool" }));

    const [call] = mocks.confirmCalls as [
      { groupStrategy: unknown; selection: unknown },
    ];
    expect(call.groupStrategy).toEqual({ kind: "existing", groupId: "mtg_1" });
  });

  it("sends a new common group name", async () => {
    const user = userEvent.setup();
    mocks.preview = preview([contactsOperation, invoicesOperation]);
    renderDialog();
    await previewPaste(user);
    await selectOperation(user, "GET /contacts");
    await selectOperation(user, "GET /invoices");

    await user.click(
      screen.getByRole("radio", {
        name: "Create one new group for all selected",
      }),
    );
    await user.type(screen.getByLabelText("New group name"), "Customers");

    await user.click(screen.getByRole("button", { name: "Import 2 tools" }));

    const [call] = mocks.confirmCalls as [{ groupStrategy: unknown }];
    expect(call.groupStrategy).toEqual({ kind: "new", name: "Customers" });
  });

  it("previews first-tag reuse and creation, then sends firstTag", async () => {
    const user = userEvent.setup();
    mocks.preview = preview([contactsOperation, invoicesOperation], {
      suggestedGroups: [
        {
          tag: "contacts",
          normalizedName: "contacts",
          existingGroupId: "mtg_1",
          willCreate: false,
        },
        {
          tag: "invoices",
          normalizedName: "invoices",
          willCreate: true,
        },
      ],
    });
    mocks.groups = [{ id: "mtg_1", name: "Contacts" }];
    renderDialog();
    await previewPaste(user);
    await selectOperation(user, "GET /contacts");
    await selectOperation(user, "GET /invoices");

    await user.click(
      screen.getByRole("radio", { name: "Create a group per first tag" }),
    );

    expect(await screen.findByText("Reuse Contacts")).toBeInTheDocument();
    expect(screen.getByText("Create invoices")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Import 2 tools" }));

    const [call] = mocks.confirmCalls as [{ groupStrategy: unknown }];
    expect(call.groupStrategy).toEqual({ kind: "firstTag" });
  });

  it("excludes an operation name override when it matches the suggestion", async () => {
    const user = userEvent.setup();
    mocks.preview = preview([contactsOperation]);
    renderDialog();
    await previewPaste(user);
    await selectOperation(user, "GET /contacts");
    await user.clear(screen.getByLabelText("Tool name"));
    await user.type(screen.getByLabelText("Tool name"), "get_contact");

    await user.click(screen.getByRole("button", { name: "Import 1 tool" }));

    const [call] = mocks.confirmCalls as [{ selection: unknown }];
    expect(call.selection).toEqual([
      { operationKey: "listContacts", name: "get_contact" },
    ]);
  });
});

describe("OpenApiImportDialog confirmation", () => {
  it("recovers from a stale preview without importing anything", async () => {
    const user = userEvent.setup();
    mocks.preview = preview([contactsOperation]);
    mocks.confirm = async () => {
      throw apiError("MCP_OPENAPI_STALE_PREVIEW");
    };
    renderDialog();
    await previewPaste(user);
    await selectOperation(user, "GET /contacts");

    await user.click(screen.getByRole("button", { name: "Import 1 tool" }));

    const region = await screen.findByRole("region", {
      name: "The document changed since the preview",
    });
    expect(
      within(region).getByText(
        "The source no longer matches the document you reviewed, so nothing was imported. Preview it again to review the current version.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Import complete")).not.toBeInTheDocument();
    expect(mocks.previewCalls).toHaveLength(1);

    await user.click(
      within(region).getByRole("button", { name: "Preview again" }),
    );

    expect(mocks.previewCalls).toHaveLength(2);
    expect(
      screen.queryByRole("region", {
        name: "The document changed since the preview",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "GET /contacts" }),
    ).toBeChecked();
  });

  it("offers the same recovery when the server changed concurrently", async () => {
    const user = userEvent.setup();
    mocks.preview = preview([contactsOperation]);
    mocks.confirm = async () => {
      throw apiError("MCP_WRITE_CONFLICT");
    };
    renderDialog();
    await previewPaste(user);
    await selectOperation(user, "GET /contacts");

    await user.click(screen.getByRole("button", { name: "Import 1 tool" }));

    const region = await screen.findByRole("region", {
      name: "The document changed since the preview",
    });
    expect(
      within(region).getByRole("button", { name: "Preview again" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Import complete")).not.toBeInTheDocument();
  });

  it("reports the created disabled tools and routes to review", async () => {
    const user = userEvent.setup();
    mocks.preview = preview([contactsOperation, invoicesOperation]);
    mocks.confirm = async () =>
      ({
        revision: 5,
        draftRevision: 5,
        batchId: "oab_1",
        tools: [
          {
            id: "mct_1",
            name: "list_contacts",
            method: "GET",
            path: "/contacts",
          },
        ],
        groups: [{ id: "mtg_2", name: "invoices", created: true }],
      }) as FixtureConfirmResult;
    const { onClose, onReviewTools } = renderDialog();
    await previewPaste(user);
    await selectOperation(user, "GET /contacts");

    await user.click(screen.getByRole("button", { name: "Import 1 tool" }));

    expect(await screen.findByText("Import complete")).toBeInTheDocument();
    expect(
      screen.getByText("1 disabled draft tool created."),
    ).toBeInTheDocument();
    expect(screen.getByText("1 group created.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Imported tools start disabled with mutation off. Review each one, enable what you need, then publish a new revision.",
      ),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Review imported tools" }),
    );
    expect(onReviewTools).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables confirmation while the import is pending", async () => {
    const user = userEvent.setup();
    mocks.preview = preview([contactsOperation]);
    mocks.confirm = () => new Promise(() => {});
    renderDialog();
    await previewPaste(user);
    await selectOperation(user, "GET /contacts");

    await user.click(screen.getByRole("button", { name: "Import 1 tool" }));

    expect(
      await screen.findByRole("button", { name: "Importing…" }),
    ).toBeDisabled();
  });
});

describe("openapi-import helpers", () => {
  it("validates tool names against the API rules", () => {
    expect(
      findOpenApiNameIssue({
        name: "get_contact",
        otherSelectedNames: [],
        existingToolNames: [],
      }),
    ).toBeNull();
    expect(
      findOpenApiNameIssue({
        name: "Get_Contact",
        otherSelectedNames: [],
        existingToolNames: [],
      }),
    ).toBe("invalid");
    expect(
      findOpenApiNameIssue({
        name: "a".repeat(81),
        otherSelectedNames: [],
        existingToolNames: [],
      }),
    ).toBe("invalid");
    expect(
      findOpenApiNameIssue({
        name: "get_contact",
        otherSelectedNames: ["get_contact"],
        existingToolNames: [],
      }),
    ).toBe("duplicate");
    expect(
      findOpenApiNameIssue({
        name: "get_contact",
        otherSelectedNames: [],
        existingToolNames: ["get_contact"],
      }),
    ).toBe("conflict");
  });

  it("sends a name only when it differs from the suggestion", () => {
    expect(
      buildOpenApiSelection([
        {
          operationKey: "a",
          suggestedName: "list_contacts",
          name: "list_contacts",
        },
        { operationKey: "b", suggestedName: "list_invoices", name: "invoices" },
      ]),
    ).toEqual([{ operationKey: "a" }, { operationKey: "b", name: "invoices" }]);
  });

  it("projects tool and group capacity", () => {
    const projection = projectOpenApiCapacity({
      capacity: {
        toolLimit: 50,
        currentTools: 49,
        groupLimit: 50,
        currentGroups: 49,
      },
      selectedCount: 2,
      plannedGroups: 2,
    });
    expect(projection).toMatchObject({
      remainingTools: 1,
      toolsExceeded: true,
      remainingGroups: 1,
      groupsExceeded: true,
    });
    expect(
      projectOpenApiCapacity({
        capacity: {
          toolLimit: 50,
          currentTools: 0,
          groupLimit: 50,
          currentGroups: 50,
        },
        selectedCount: 0,
        plannedGroups: 1,
      }),
    ).toMatchObject({
      remainingTools: 50,
      remainingGroups: 0,
      groupsExceeded: true,
    });
  });

  it("caps select-all and new selections at remaining capacity without dropping existing keys", () => {
    expect(selectOpenApiKeysUpToCapacity(["a", "b", "c", "d"], 2)).toEqual([
      "a",
      "b",
    ]);
    expect(nextOpenApiSelection(["a", "b"], "c", true, 2)).toEqual(["a", "b"]);
    expect(nextOpenApiSelection(["a", "b"], "b", false, 2)).toEqual(["a"]);
    expect(nextOpenApiSelection(["a"], "c", true, 2)).toEqual(["a", "c"]);
  });

  it("resolves every issue code through the active locale module", () => {
    const codes = Object.values(MCP_OPENAPI_ISSUE_CODES);
    expect(codes).toHaveLength(18);
    for (const code of codes) {
      const english = resolveOpenApiIssueDescription(
        enOpenApi.issueDescriptions,
        code,
        enOpenApi.issueUnknown,
      );
      const spanish = resolveOpenApiIssueDescription(
        esOpenApi.issueDescriptions,
        code,
        esOpenApi.issueUnknown,
      );
      expect(english.trim().length, code).toBeGreaterThan(0);
      expect(spanish.trim().length, code).toBeGreaterThan(0);
      expect(spanish, code).not.toBe(english);
    }
    expect(
      resolveOpenApiIssueDescription(
        enOpenApi.issueDescriptions,
        MCP_OPENAPI_ISSUE_CODES.COOKIE_PARAMETER,
        enOpenApi.issueUnknown,
      ),
    ).toBe("It needs cookies, which are never sent.");
    // A code this build does not know never renders raw.
    expect(
      resolveOpenApiIssueDescription(
        enOpenApi.issueDescriptions,
        "OPENAPI_FUTURE_CODE",
        enOpenApi.issueUnknown,
      ),
    ).toBe(enOpenApi.issueUnknown);
  });

  it("splits blockers from warnings", () => {
    const { blockers, warnings } = splitOpenApiIssues([
      { code: "a", severity: "warning" },
      { code: "b", severity: "error" },
    ]);
    expect(blockers.map((issue) => issue.code)).toEqual(["b"]);
    expect(warnings.map((issue) => issue.code)).toEqual(["a"]);
  });

  it("derives stable keys for repeated diagnostics", () => {
    expect(
      withOpenApiKeys(
        [
          { code: "OPENAPI_UNSUPPORTED_SCHEMA", path: "a" },
          { code: "OPENAPI_UNSUPPORTED_SCHEMA", path: "a" },
          { code: "OPENAPI_UNSUPPORTED_SCHEMA", path: "b" },
        ],
        (issue) => `${issue.code}:${issue.path}`,
      ),
    ).toEqual([
      {
        key: "OPENAPI_UNSUPPORTED_SCHEMA:a",
        value: { code: "OPENAPI_UNSUPPORTED_SCHEMA", path: "a" },
      },
      {
        key: "OPENAPI_UNSUPPORTED_SCHEMA:a#1",
        value: { code: "OPENAPI_UNSUPPORTED_SCHEMA", path: "a" },
      },
      {
        key: "OPENAPI_UNSUPPORTED_SCHEMA:b",
        value: { code: "OPENAPI_UNSUPPORTED_SCHEMA", path: "b" },
      },
    ]);
  });

  it("plans first-tag groups by reuse, creation, and ungrouped", () => {
    const plan = planFirstTagGroups({
      selectedOperations: [
        { tags: ["contacts"] },
        { tags: ["invoices"] },
        { tags: [" invoices "] },
        { tags: [] },
      ],
      suggestedGroups: [
        { tag: "contacts", normalizedName: "contacts", willCreate: true },
        { tag: "invoices", normalizedName: "invoices", willCreate: true },
      ],
      existingGroups: [{ id: "mtg_1", name: "Contacts" }],
    });
    expect(plan.reuse).toEqual([
      { tag: "contacts", name: "Contacts", groupId: "mtg_1" },
    ]);
    expect(plan.create).toEqual([{ tag: "invoices", name: "invoices" }]);
    expect(plan.ungrouped).toBe(1);
    expect(plan.creationCount).toBe(1);
    expect(
      planFirstTagGroups({
        selectedOperations: [{ tags: [] }],
        suggestedGroups: [],
      }),
    ).toMatchObject({ reuse: [], create: [], creationCount: 0 });
  });

  it("filters and groups the fetched preview deterministically", () => {
    const operations = [
      { path: "/b", method: "POST", tags: ["zeta"], suggestedName: "post_b" },
      { path: "/a", method: "GET", tags: [], suggestedName: "get_a" },
      { path: "/b", method: "GET", tags: ["zeta"], suggestedName: "get_b" },
    ];
    expect(
      filterOpenApiOperations(operations, "POST").map(
        (entry) => entry.suggestedName,
      ),
    ).toEqual(["post_b"]);
    expect(filterOpenApiOperations(operations, "  ")).toHaveLength(3);
    const groups = groupOpenApiOperations(operations);
    expect(groups.map((group) => group.tag)).toEqual(["zeta", null]);
    expect(groups[0]!.operations.map((entry) => entry.suggestedName)).toEqual([
      "get_b",
      "post_b",
    ]);
  });

  it("summarizes a canonical request definition by real parameters", () => {
    expect(
      summarizeOpenApiRequest({
        pathSegments: [
          { id: "a", value: { kind: "literal", value: "items" } },
          { id: "b", value: { kind: "agentInput", agentInputId: "ain_1" } },
        ],
        query: [{ id: "q" }, { id: "q2" }],
        headers: [{ id: "h" }],
        body: { bodyType: "json" },
      }),
    ).toEqual({
      pathParameters: 1,
      queryParameters: 2,
      headerParameters: 1,
      body: "json",
    });

    // Literal segments are not path parameters, so this definition has nothing
    // to summarize at all.
    const literalOnly = summarizeOpenApiRequest({
      pathSegments: [{ id: "a", value: { kind: "literal", value: "items" } }],
      query: [],
      headers: [],
      body: { bodyType: "none" },
    });
    expect(literalOnly).toEqual({
      pathParameters: 0,
      queryParameters: 0,
      headerParameters: 0,
      body: "none",
    });
    expect(hasOpenApiRequestSummary(literalOnly)).toBe(false);
    expect(hasOpenApiRequestSummary(null)).toBe(false);
    expect(
      hasOpenApiRequestSummary({
        pathParameters: 0,
        queryParameters: 0,
        headerParameters: 0,
        body: "form",
      }),
    ).toBe(true);
    expect(summarizeOpenApiRequest(null)).toBeNull();
    expect(
      summarizeOpenApiRequest({ body: { bodyType: "unknown" } }),
    ).toBeNull();
  });

  it("describes security schemes without values", () => {
    expect(
      describeOpenApiSecurityRequirement({
        name: "ApiKeyAuth",
        type: "apiKey",
        in: "header",
      }),
    ).toBe("ApiKeyAuth (apiKey, header)");
    expect(
      describeOpenApiSecurityRequirement({
        name: "BearerAuth",
        type: "http",
        scheme: "bearer",
      }),
    ).toBe("BearerAuth (http, bearer)");
    expect(
      describeOpenApiSecurityRequirement({ name: "oauth", type: "oauth2" }),
    ).toBe("oauth (oauth2)");
  });

  it("reads JSON files locally with type and size guidance", async () => {
    expect(isHttpsDocumentUrl("https://example.com/doc.json")).toBe(true);
    expect(isHttpsDocumentUrl("http://example.com/doc.json")).toBe(false);
    expect(isHttpsDocumentUrl("https://")).toBe(false);

    await expect(
      readOpenApiDocumentFile({
        name: "api.yaml",
        type: "application/yaml",
        size: 10,
        text: async () => "openapi: 3.1.0",
      }),
    ).resolves.toEqual({ ok: false, reason: "kind" });
    await expect(
      readOpenApiDocumentFile({
        name: "api.json",
        type: "application/json",
        size: 5 * 1024 * 1024 + 1,
        text: async () => "{}",
      }),
    ).resolves.toEqual({ ok: false, reason: "tooLarge" });
    await expect(
      readOpenApiDocumentFile({
        name: "api.json",
        type: "application/json",
        size: 2,
        text: async () => {
          throw new Error("unreadable");
        },
      }),
    ).resolves.toEqual({ ok: false, reason: "read" });
    await expect(
      readOpenApiDocumentFile({
        name: "api.json",
        type: "",
        size: 2,
        text: async () => "{}",
      }),
    ).resolves.toEqual({ ok: true, name: "api.json", content: "{}" });
  });
});
