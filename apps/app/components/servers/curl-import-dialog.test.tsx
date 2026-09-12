import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CurlImportDialog } from "./curl-import-dialog";

const previewFixture = {
  method: "GET",
  pathTemplate: "/v1/contacts/123",
  query: { limit: "10" },
  headers: {},
  body: null,
  bodyType: undefined,
  auth: {
    scheme: "bearer",
    headerName: "Authorization",
    value: "sk_live_123",
    variableName: "authorization_token",
  },
  values: [
    { value: "v1", location: "path", key: null },
    { value: "contacts", location: "path", key: null },
    { value: "123", location: "path", key: null },
    { value: "10", location: "query", key: "limit" },
  ],
} as const;

const parseState: { data: unknown } = { data: undefined };
const parseMutate = vi.fn(
  (
    _input: unknown,
    options?: { onSuccess?: (result: typeof previewFixture) => void },
  ) => {
    parseState.data = previewFixture;
    options?.onSuccess?.(previewFixture);
  },
);
const createMutate = vi.fn(
  (
    _input: unknown,
    options?: {
      onSuccess?: (result: {
        capturedVariables: string[];
        capturedParams: string[];
      }) => void;
    },
  ) => {
    options?.onSuccess?.({
      capturedVariables: ["authorization_token"],
      capturedParams: [],
    });
  },
);

vi.mock("@/hooks/use-mcp", () => ({
  useParseCurlPreview: () => ({
    get data() {
      return parseState.data;
    },
    mutate: parseMutate,
    isPending: false,
    reset: vi.fn(() => {
      parseState.data = undefined;
    }),
  }),
  useCreateMcpToolFromCurl: () => ({
    mutate: createMutate,
    isPending: false,
  }),
}));

describe("CurlImportDialog", () => {
  beforeEach(() => {
    parseState.data = undefined;
    parseMutate.mockClear();
    createMutate.mockClear();
  });

  it("parses, pre-marks the auth value as a secret variable, and confirms", async () => {
    const user = userEvent.setup();
    render(<CurlImportDialog serverId="mcs_1" onClose={() => {}} />);

    await user.type(
      screen.getByLabelText(/curl command/i),
      "curl https://api.example.com/v1/contacts/123 -H 'Authorization: Bearer sk_live_123'",
    );
    await user.click(screen.getByRole("button", { name: /^parse$/i }));

    expect(parseMutate).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: "mcs_1" }),
      expect.anything(),
    );

    // Preview renders the parsed request and the auth pre-mark notice.
    expect(screen.getByText("/v1/contacts/123")).toBeInTheDocument();
    expect(screen.getByText(/detected credential/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /create tool/i }));

    expect(createMutate).toHaveBeenCalledTimes(1);
    const [payload] = createMutate.mock.calls[0] as [
      { serverId: string; markings: unknown[] },
      unknown,
    ];
    expect(payload.serverId).toBe("mcs_1");
    expect(payload.markings).toEqual([
      {
        value: "sk_live_123",
        as: "variable",
        name: "authorization_token",
        isSecret: true,
      },
    ]);

    // Capture report phase.
    expect(
      screen.getByText(/captured 1 variables and 0 params/i),
    ).toBeInTheDocument();
  });

  it("blocks confirm when a marking name is invalid", async () => {
    const user = userEvent.setup();
    render(<CurlImportDialog serverId="mcs_1" onClose={() => {}} />);

    await user.type(screen.getByLabelText(/curl command/i), "curl …");
    await user.click(screen.getByRole("button", { name: /^parse$/i }));

    // Mark the "limit" query value as a param with an invalid name.
    const limitRow = screen.getByText("10").closest("li");
    expect(limitRow).not.toBeNull();
    const select = limitRow?.querySelector("button[role='combobox']");
    expect(select).not.toBeNull();
    await user.click(select as HTMLElement);
    await user.click(screen.getByRole("option", { name: /agent param/i }));

    const nameInput = limitRow?.querySelector("input");
    expect(nameInput).not.toBeNull();
    await user.clear(nameInput as HTMLElement);
    await user.type(nameInput as HTMLElement, "9bad");

    expect(screen.getByRole("button", { name: /create tool/i })).toBeDisabled();
  });

  it("rejects uppercase variable names but allows them for params", async () => {
    const user = userEvent.setup();
    render(<CurlImportDialog serverId="mcs_1" onClose={() => {}} />);

    await user.type(screen.getByLabelText(/curl command/i), "curl …");
    await user.click(screen.getByRole("button", { name: /^parse$/i }));

    const limitRow = screen.getByText("10").closest("li");
    expect(limitRow).not.toBeNull();
    const select = limitRow?.querySelector("button[role='combobox']");
    expect(select).not.toBeNull();

    // Variables follow the API's lowercase-only pattern.
    await user.click(select as HTMLElement);
    await user.click(screen.getByRole("option", { name: /^variable$/i }));
    const nameInput = limitRow?.querySelector("input");
    expect(nameInput).not.toBeNull();
    await user.clear(nameInput as HTMLElement);
    await user.type(nameInput as HTMLElement, "Tenant");
    expect(screen.getByRole("button", { name: /create tool/i })).toBeDisabled();
    expect(screen.getByText(/invalid name/i)).toBeInTheDocument();

    // Params accept uppercase names.
    await user.click(select as HTMLElement);
    await user.click(screen.getByRole("option", { name: /agent param/i }));
    expect(screen.getByRole("button", { name: /create tool/i })).toBeEnabled();
    expect(screen.queryByText(/invalid name/i)).not.toBeInTheDocument();
  });
});
