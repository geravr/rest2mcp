import { MCP_OPENAPI_ISSUE_CODES, type McpOpenApiIssueCode } from "@repo/core";

export const enOpenApi = {
  openApiImport: {
    action: "Import OpenAPI",
    title: "Import from OpenAPI",
    description:
      "Preview an OpenAPI 3.0 or 3.1 JSON document, choose the operations to create, and add them as disabled draft tools for review.",

    sourceLegend: "Document source",
    sourceFile: "File",
    sourcePaste: "Paste JSON",
    sourceUrl: "URL",

    fileLabel: "JSON file",
    fileHint: "OpenAPI 3.0 or 3.1 JSON, up to 5 MiB. YAML is not supported.",
    fileKindError: "Choose a .json file.",
    fileTooLargeError: "That file is larger than the 5 MiB limit.",
    fileReadError: "That file could not be read.",

    pasteLabel: "Document JSON",
    pastePlaceholder:
      '{\n  "openapi": "3.1.0",\n  "info": { "title": "Example" }\n}',

    urlLabel: "Document URL",
    urlHint:
      "Public HTTPS only. No credentials, cookies, or server authentication are sent when retrieving it.",

    preview: "Preview document",
    previewing: "Reading document…",
    previewUnavailable:
      "The document could not be read. Fix the source and preview again.",
    repreview: "Preview again",

    version: "OpenAPI {version}",
    operationCount: "{count} operations",
    selectableCount: "{count} importable",
    blockedCount: "{count} blocked",
    warningCount: "{count} warnings",

    searchLabel: "Search operations",
    searchPlaceholder: "Filter by path, name, or tag",
    noSearchResults: "No operations match that search.",
    noOperations: "This document declares no operations that can be imported.",
    selectAll: "Select all importable",
    clearSelection: "Clear selection",
    selectedCount: "{count} selected",
    selectedOfTotal: "{selected} of {total} selected",
    emptySelection: "Select at least one operation to import.",
    documentIssuesTitle: "Parts of this document cannot be read",
    documentIssuesHint:
      "These paths were skipped because they could not be resolved inside the document. Nothing outside it is ever fetched.",
    ungroupedTag: "No tag",

    expandOperation: "Show details",
    collapseOperation: "Hide details",
    deprecated: "Deprecated",
    blocked: "Blocked",
    warningLabel: "Warning",
    requestSummary: "Request",
    noRequestSummary: "No request body",
    requestSummaryPath: "path",
    requestSummaryQuery: "query",
    requestSummaryHeader: "header",
    requestSummaryBody: "body",
    requestSummaryCount: "{label} {count}",
    requestSummaryNone: "No path, query, header, or body parameters.",

    blockersTitle: "Blocked",
    blockersHint:
      "Blocked operations cannot be imported. Fix the document or exclude them.",
    warningsTitle: "Warnings",
    securityTitle: "Authentication required",
    securityHint:
      "Configure these schemes in server settings. Importing never copies credential values.",
    securityNone: "No authentication declared.",

    nameLabel: "Tool name",
    nameConflict: "Already used by an existing tool.",
    nameDuplicate: "Another selected operation uses this name.",
    nameInvalid: "Use lowercase letters, numbers, and underscores.",
    namePlaceholder: "get_contact",

    groupLegend: "Group placement",
    groupUngrouped: "Leave ungrouped",
    groupExisting: "Add to an existing group",
    groupNew: "Create one new group for all selected",
    groupFirstTag: "Create a group per first tag",
    groupFirstTagHint:
      "Operations keep their first tag as their group. Missing groups are created; untagged operations stay ungrouped.",
    groupSelectLabel: "Group",
    groupSelectPlaceholder: "Choose a group",
    groupNewNameLabel: "New group name",
    groupNewNamePlaceholder: "Customers",
    groupReuse: "Reuse {name}",
    groupWillCreate: "Create {name}",
    groupNoCreations: "No groups will be created.",
    groupStrategyLabel: "Group strategy",

    capacityTitle: "Capacity",
    capacityTools: "{current} of {limit} tools used",
    capacityGroups: "{current} of {limit} groups used",
    capacityRemaining: "{remaining} tool slots remain on this server.",
    capacityToolExceeded:
      "Importing {selected} tools would exceed the {limit}-tool limit. This server already has {current}.",
    capacityGroupExceeded:
      "This import needs {selected} groups but only {available} remain under the {limit}-group limit.",

    confirm: "Import {count} tools",
    confirmOne: "Import 1 tool",
    confirming: "Importing…",
    cancel: "Cancel",

    staleTitle: "The document changed since the preview",
    staleDescription:
      "The source no longer matches the document you reviewed, so nothing was imported. Preview it again to review the current version.",

    resultTitle: "Import complete",
    resultTools: "{count} disabled draft tools created.",
    resultToolsOne: "1 disabled draft tool created.",
    resultGroups: "{count} groups created.",
    resultGroupsOne: "1 group created.",
    resultHint:
      "Imported tools start disabled with mutation off. Review each one, enable what you need, then publish a new revision.",
    resultReview: "Review imported tools",
    resultClose: "Close",

    /**
     * One sentence per stable `MCP_OPENAPI_ISSUE_CODES` value, keyed by the code
     * itself so the dialog never renders a raw code and every code stays covered.
     */
    issueDescriptions: {
      [MCP_OPENAPI_ISSUE_CODES.METHOD_UNSUPPORTED]:
        "This HTTP method cannot be called.",
      [MCP_OPENAPI_ISSUE_CODES.EXTERNAL_REFERENCE]:
        "Part of it is defined outside this document.",
      [MCP_OPENAPI_ISSUE_CODES.CYCLIC_REFERENCE]:
        "Its schema refers to itself.",
      [MCP_OPENAPI_ISSUE_CODES.COOKIE_PARAMETER]:
        "It needs cookies, which are never sent.",
      [MCP_OPENAPI_ISSUE_CODES.MULTIPART_BODY]:
        "It sends a multipart or file body.",
      [MCP_OPENAPI_ISSUE_CODES.UNSUPPORTED_SERIALIZATION]:
        "Its parameter format cannot be reproduced.",
      [MCP_OPENAPI_ISSUE_CODES.AMBIGUOUS_SERVER]:
        "Its server address is ambiguous.",
      [MCP_OPENAPI_ISSUE_CODES.UNSUPPORTED_SCHEMA]:
        "Its schema uses a construct that cannot be mapped.",
      [MCP_OPENAPI_ISSUE_CODES.AMBIGUOUS_PARAMETER]:
        "Its parameters are declared ambiguously.",
      [MCP_OPENAPI_ISSUE_CODES.UNREPRESENTABLE_REQUEST]:
        "Its request cannot be represented.",
      [MCP_OPENAPI_ISSUE_CODES.FOREIGN_ORIGIN]:
        "It points to another origin than this server.",
      [MCP_OPENAPI_ISSUE_CODES.LIMIT_EXCEEDED]: "It exceeds a document limit.",
      [MCP_OPENAPI_ISSUE_CODES.DUPLICATE_NAME]:
        "Another selected operation uses this name.",
      [MCP_OPENAPI_ISSUE_CODES.NAME_CONFLICT]:
        "A tool with this name already exists on the server.",
      [MCP_OPENAPI_ISSUE_CODES.DEPRECATED]: "The document marks it deprecated.",
      [MCP_OPENAPI_ISSUE_CODES.METADATA_IGNORED]: "Some metadata was ignored.",
      [MCP_OPENAPI_ISSUE_CODES.COMPOSITION_CONFLICT]:
        "Its schema composition assigns conflicting types or constraints.",
      [MCP_OPENAPI_ISSUE_CODES.REDUCED_VALIDATION]:
        "The JSON value can be sent as-is, but branch validation is reduced.",
    } satisfies Record<McpOpenApiIssueCode, string>,
    issueUnknown: "This Studio version does not recognize this diagnostic.",
  },
} as const;
