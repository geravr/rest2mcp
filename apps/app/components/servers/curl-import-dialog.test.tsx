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
});
