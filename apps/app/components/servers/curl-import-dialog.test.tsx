import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CurlImportDialog } from "./curl-import-dialog";

const previewFixture = {
  method: "GET",
  relativePath: "/v1/contacts/123",
  query: [{ key: "limit", value: "10" }],
  headers: [],
  body: null,
  excludedCredentials: [{ kind: "bearer", headerName: "Authorization" }],
  excludedTransportHeaders: [],
  occurrences: [
    { occurrenceId: "path:0", location: "path", value: "v1" },
    { occurrenceId: "path:1", location: "path", value: "contacts" },
    { occurrenceId: "path:2", location: "path", value: "123" },
    {
      occurrenceId: "query:limit:0",
      location: "query",
      key: "limit",
      value: "10",
    },
  ],
} as const;

const parseMutate = vi.fn();

function group(id: string, name: string) {
  return {
    id,
    name,
    normalizedName: name.toLowerCase(),
    toolCount: 2,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

const groupsFixture = [group("mtg_1", "Invoices"), group("mtg_2", "Contacts")];
const createMutate = vi.fn(
  (
    _input: unknown,
    options?: {
      onSuccess?: (result: {
        excludedCredentials: unknown[];
        issues: unknown[];
      }) => void;
    },
  ) => {
    options?.onSuccess?.({
      excludedCredentials: [{ kind: "bearer", headerName: "Authorization" }],
      issues: [],
    });
  },
);

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children: React.ReactNode; to: string }) => (
    <a href={props.to}>{children}</a>
  ),
}));

vi.mock("@/hooks/use-mcp", () => ({
  // A real useState-backed mock so `.data` reactively drives re-renders,
  // mirroring the real TanStack Query mutation hook's behavior.
  useParseCurlPreview: () => {
    const [data, setData] = useState<typeof previewFixture | undefined>(
      undefined,
    );
    return {
      data,
      mutate: (...args: unknown[]) => {
        parseMutate(...args);
        setData(previewFixture);
      },
      isPending: false,
      reset: () => setData(undefined),
    };
  },
  useCreateMcpToolFromCurl: () => ({
    mutate: createMutate,
    isPending: false,
  }),
}));

describe("CurlImportDialog", () => {
  beforeEach(() => {
    parseMutate.mockClear();
    createMutate.mockClear();
  });

  it("parses, reports the excluded credential, and confirms a draft import", async () => {
    const user = userEvent.setup();
    render(<CurlImportDialog serverId="mcs_1" onClose={() => {}} />);

    await user.type(
      screen.getByLabelText(/curl command/i),
      "curl https://api.example.com/v1/contacts/123 -H 'Authorization: Bearer sk_live_123'",
    );
    await user.click(screen.getByRole("button", { name: /^parse$/i }));

    expect(parseMutate).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: "mcs_1" }),
    );

    // Preview renders the parsed request and the excluded-credential notice,
    // never the credential's value.
    expect(screen.getByText("/v1/contacts/123")).toBeInTheDocument();
    expect(screen.getByText(/excluded/i)).toBeInTheDocument();
    expect(screen.queryByText(/sk_live_123/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /create tool/i }));

    expect(createMutate).toHaveBeenCalledTimes(1);
    const [payload] = createMutate.mock.calls[0] as [
      { serverId: string; markings: unknown[] },
      unknown,
    ];
    expect(payload.serverId).toBe("mcs_1");
    // No markings were made, so the import stays fully literal.
    expect(payload.markings).toEqual([]);

    // Draft-created report phase.
    expect(screen.getByText(/draft tool created/i)).toBeInTheDocument();
  });

  it("never offers a serverValue/credential-promotion marking option", async () => {
    const user = userEvent.setup();
    render(<CurlImportDialog serverId="mcs_1" onClose={() => {}} />);

    await user.type(screen.getByLabelText(/curl command/i), "curl …");
    await user.click(screen.getByRole("button", { name: /^parse$/i }));

    const limitRow = screen.getByText("10").closest("li");
    const select = limitRow?.querySelector("button[role='combobox']");
    await user.click(select as HTMLElement);

    // Only Literal and Agent input are ever offered; curl import never
    // promotes a detected value to a server value or auth configuration.
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(
      options.some((option) =>
        /server value|auth/i.test(option.textContent ?? ""),
      ),
    ).toBe(false);
  });

  it("blocks confirm when a marking name is invalid", async () => {
    const user = userEvent.setup();
    render(<CurlImportDialog serverId="mcs_1" onClose={() => {}} />);

    await user.type(screen.getByLabelText(/curl command/i), "curl …");
    await user.click(screen.getByRole("button", { name: /^parse$/i }));

    // Mark the "limit" query value as an agent input with an invalid name.
    const limitRow = screen.getByText("10").closest("li");
    expect(limitRow).not.toBeNull();
    const select = limitRow?.querySelector("button[role='combobox']");
    expect(select).not.toBeNull();
    await user.click(select as HTMLElement);
    await user.click(screen.getByRole("option", { name: /agent input/i }));

    const nameInput = limitRow?.querySelector("input");
    expect(nameInput).not.toBeNull();
    await user.clear(nameInput as HTMLElement);
    await user.type(nameInput as HTMLElement, "9bad");

    expect(screen.getByRole("button", { name: /create tool/i })).toBeDisabled();
    expect(screen.getByText(/invalid name/i)).toBeInTheDocument();
  });

  it("marks an occurrence as an agent input with a valid name", async () => {
    const user = userEvent.setup();
    render(<CurlImportDialog serverId="mcs_1" onClose={() => {}} />);

    await user.type(screen.getByLabelText(/curl command/i), "curl …");
    await user.click(screen.getByRole("button", { name: /^parse$/i }));

    const limitRow = screen.getByText("10").closest("li");
    const select = limitRow?.querySelector("button[role='combobox']");
    await user.click(select as HTMLElement);
    await user.click(screen.getByRole("option", { name: /agent input/i }));

    const nameInput = limitRow?.querySelector("input");
    await user.clear(nameInput as HTMLElement);
    await user.type(nameInput as HTMLElement, "limit_value");

    expect(screen.getByRole("button", { name: /create tool/i })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: /create tool/i }));

    const [payload] = createMutate.mock.calls[0] as [
      { markings: Array<Record<string, unknown>> },
      unknown,
    ];
    expect(payload.markings).toEqual([
      {
        location: "query",
        key: "limit",
        jsonPath: undefined,
        occurrenceId: "query:limit:0",
        as: "agentInput",
        agentInput: {
          id: "limit_value",
          name: "limit_value",
          required: true,
          sensitive: false,
          type: "string",
        },
      },
    ]);
  });

  it("confirms the import into the selected group", async () => {
    const user = userEvent.setup();
    render(
      <CurlImportDialog
        serverId="mcs_1"
        groups={groupsFixture}
        onClose={() => {}}
      />,
    );

    await user.type(screen.getByLabelText(/curl command/i), "curl …");
    await user.click(screen.getByRole("button", { name: /^parse$/i }));

    expect(screen.getByLabelText(/^group$/i)).toHaveTextContent("Ungrouped");

    await user.click(screen.getByLabelText(/^group$/i));
    await user.click(screen.getByRole("option", { name: "Invoices" }));
    await user.click(screen.getByRole("button", { name: /create tool/i }));

    expect(createMutate).toHaveBeenCalledTimes(1);
    const [payload] = createMutate.mock.calls[0] as [
      Record<string, unknown>,
      unknown,
    ];
    expect(payload.groupId).toBe("mtg_1");
  });

  it("preselects the active group filter and sends null for Ungrouped", async () => {
    const user = userEvent.setup();
    render(
      <CurlImportDialog
        serverId="mcs_1"
        groups={groupsFixture}
        initialGroupId="mtg_2"
        onClose={() => {}}
      />,
    );

    await user.type(screen.getByLabelText(/curl command/i), "curl …");
    await user.click(screen.getByRole("button", { name: /^parse$/i }));

    expect(screen.getByLabelText(/^group$/i)).toHaveTextContent("Contacts");

    await user.click(screen.getByLabelText(/^group$/i));
    await user.click(screen.getByRole("option", { name: "Ungrouped" }));
    await user.click(screen.getByRole("button", { name: /create tool/i }));

    expect(createMutate).toHaveBeenCalledTimes(1);
    const [payload] = createMutate.mock.calls[0] as [
      Record<string, unknown>,
      unknown,
    ];
    expect("groupId" in payload).toBe(true);
    expect(payload.groupId).toBeNull();
  });

  it("submits the preselected group that the loaded list still contains", async () => {
    const user = userEvent.setup();
    render(
      <CurlImportDialog
        serverId="mcs_1"
        groups={groupsFixture}
        initialGroupId="mtg_2"
        onClose={() => {}}
      />,
    );

    await user.type(screen.getByLabelText(/curl command/i), "curl …");
    await user.click(screen.getByRole("button", { name: /^parse$/i }));
    await user.click(screen.getByRole("button", { name: /create tool/i }));

    const [payload] = createMutate.mock.calls[0] as [
      Record<string, unknown>,
      unknown,
    ];
    expect(payload.groupId).toBe("mtg_2");
  });

  it("falls back to ungrouped when the preselected group is no longer listed", async () => {
    const user = userEvent.setup();
    render(
      <CurlImportDialog
        serverId="mcs_1"
        groups={groupsFixture}
        initialGroupId="mtg_deleted"
        onClose={() => {}}
      />,
    );

    await user.type(screen.getByLabelText(/curl command/i), "curl …");
    await user.click(screen.getByRole("button", { name: /^parse$/i }));

    expect(screen.getByLabelText(/^group$/i)).toHaveTextContent("Ungrouped");

    await user.click(screen.getByRole("button", { name: /create tool/i }));

    const [payload] = createMutate.mock.calls[0] as [
      Record<string, unknown>,
      unknown,
    ];
    expect(payload.groupId).toBeNull();
  });

  it("falls back when the group list arrives after the first render", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <CurlImportDialog
        serverId="mcs_1"
        groups={[]}
        initialGroupId="mtg_2"
        onClose={() => {}}
      />,
    );

    await user.type(screen.getByLabelText(/curl command/i), "curl …");
    await user.click(screen.getByRole("button", { name: /^parse$/i }));

    // The not-yet-loaded id is not offered, so the selection stays ungrouped.
    expect(screen.getByLabelText(/^group$/i)).toHaveTextContent("Ungrouped");

    // A list that never contains the id keeps the fallback in the payload.
    rerender(
      <CurlImportDialog
        serverId="mcs_1"
        groups={[group("mtg_9", "Archive")]}
        initialGroupId="mtg_2"
        onClose={() => {}}
      />,
    );
    expect(screen.getByLabelText(/^group$/i)).toHaveTextContent("Ungrouped");

    await user.click(screen.getByRole("button", { name: /create tool/i }));

    const [missingPayload] = createMutate.mock.calls[0] as [
      Record<string, unknown>,
      unknown,
    ];
    expect(missingPayload.groupId).toBeNull();
  });

  it("preselects a late-arriving group that lists the initial id", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <CurlImportDialog
        serverId="mcs_1"
        groups={[]}
        initialGroupId="mtg_2"
        onClose={() => {}}
      />,
    );

    await user.type(screen.getByLabelText(/curl command/i), "curl …");
    await user.click(screen.getByRole("button", { name: /^parse$/i }));
    expect(screen.getByLabelText(/^group$/i)).toHaveTextContent("Ungrouped");

    rerender(
      <CurlImportDialog
        serverId="mcs_1"
        groups={groupsFixture}
        initialGroupId="mtg_2"
        onClose={() => {}}
      />,
    );
    expect(screen.getByLabelText(/^group$/i)).toHaveTextContent("Contacts");

    await user.click(screen.getByRole("button", { name: /create tool/i }));

    const [payload] = createMutate.mock.calls[0] as [
      Record<string, unknown>,
      unknown,
    ];
    expect(payload.groupId).toBe("mtg_2");
  });

  it("preselects an initialGroupId that arrives with the loaded group list", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <CurlImportDialog serverId="mcs_1" onClose={() => {}} />,
    );

    await user.type(screen.getByLabelText(/curl command/i), "curl …");
    await user.click(screen.getByRole("button", { name: /^parse$/i }));

    // Neither the group list nor the active filter has resolved on this render.
    expect(screen.queryByLabelText(/^group$/i)).not.toBeInTheDocument();

    rerender(
      <CurlImportDialog
        serverId="mcs_1"
        groups={groupsFixture}
        initialGroupId="mtg_2"
        onClose={() => {}}
      />,
    );

    expect(screen.getByLabelText(/^group$/i)).toHaveTextContent("Contacts");

    await user.click(screen.getByRole("button", { name: /create tool/i }));

    const [payload] = createMutate.mock.calls[0] as [
      Record<string, unknown>,
      unknown,
    ];
    expect(payload.groupId).toBe("mtg_2");
  });

  it("keeps an owner-chosen group when initialGroupId arrives afterwards", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <CurlImportDialog
        serverId="mcs_1"
        groups={groupsFixture}
        onClose={() => {}}
      />,
    );

    await user.type(screen.getByLabelText(/curl command/i), "curl …");
    await user.click(screen.getByRole("button", { name: /^parse$/i }));

    await user.click(screen.getByLabelText(/^group$/i));
    await user.click(screen.getByRole("option", { name: "Invoices" }));
    expect(screen.getByLabelText(/^group$/i)).toHaveTextContent("Invoices");

    // The active filter resolves later; it must not overwrite the choice.
    rerender(
      <CurlImportDialog
        serverId="mcs_1"
        groups={groupsFixture}
        initialGroupId="mtg_2"
        onClose={() => {}}
      />,
    );
    expect(screen.getByLabelText(/^group$/i)).toHaveTextContent("Invoices");

    await user.click(screen.getByRole("button", { name: /create tool/i }));

    const [payload] = createMutate.mock.calls[0] as [
      Record<string, unknown>,
      unknown,
    ];
    expect(payload.groupId).toBe("mtg_1");
  });

  it("keeps the confirm payload shape apart from groupId and creates one tool", async () => {
    const user = userEvent.setup();
    render(<CurlImportDialog serverId="mcs_1" onClose={() => {}} />);

    await user.type(
      screen.getByLabelText(/curl command/i),
      "curl https://api.example.com/v1/contacts/123",
    );
    await user.click(screen.getByRole("button", { name: /^parse$/i }));

    // Without groups (and no preselect value) the selector stays out of the dialog.
    expect(screen.queryByLabelText(/^group$/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /create tool/i }));

    expect(createMutate).toHaveBeenCalledTimes(1);
    const [payload] = createMutate.mock.calls[0] as [
      Record<string, unknown>,
      unknown,
    ];
    expect(Object.keys(payload).sort()).toEqual([
      "curl",
      "expectedRevision",
      "groupId",
      "markings",
      "serverId",
    ]);
    expect(payload.groupId).toBeNull();
    expect(payload.expectedRevision).toBe(1);
    expect(payload.markings).toEqual([]);
  });
});
