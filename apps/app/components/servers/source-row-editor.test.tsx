import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { SourceRowEditor } from "./source-row-editor";
import type { SourceRow } from "@/lib/value-origin";

function Harness({
  initial = [],
  variableNames = ["api_token"],
  mode = "tool" as const,
  emptyLabel,
}: {
  initial?: SourceRow[];
  variableNames?: string[];
  mode?: "tool" | "defaults";
  emptyLabel?: string;
}) {
  const [rows, setRows] = useState<SourceRow[]>(initial);
  return (
    <SourceRowEditor
      rows={rows}
      onChange={setRows}
      variableNames={variableNames}
      mode={mode}
      emptyLabel={emptyLabel}
    />
  );
}

describe("SourceRowEditor", () => {
  it("shows an empty state before Add row", () => {
    render(<Harness emptyLabel="No query params yet." />);
    expect(screen.getByText("No query params yet.")).toBeInTheDocument();
  });

  it("adds a Fixed row and accepts a literal value", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: /add row/i }));
    await user.type(screen.getByLabelText(/^key$/i), "limit");
    await user.type(screen.getByPlaceholderText(/^value$/i), "50");

    expect(screen.getByLabelText(/^key$/i)).toHaveValue("limit");
    expect(screen.getByPlaceholderText(/^value$/i)).toHaveValue("50");
  });

  it("pre-fills Bearer prefix only on Authorization Variable rows", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={[{ key: "Authorization", origin: "fixed", value: "" }]}
      />,
    );

    await user.click(screen.getByLabelText(/value origin/i));
    await user.click(screen.getByRole("option", { name: /^variable$/i }));
    expect(screen.getByLabelText(/^prefix$/i)).toHaveValue("Bearer ");
    expect(
      screen.queryByRole("button", { name: /add prefix/i }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /select variable/i }));
    await user.click(screen.getByRole("menuitem", { name: "api_token" }));

    expect(
      screen.getByRole("button", { name: /api_token/i }),
    ).toBeInTheDocument();
  });

  it("does not show a prefix control on Query-style Variable rows", async () => {
    const user = userEvent.setup();
    render(
      <Harness initial={[{ key: "email", origin: "fixed", value: "" }]} />,
    );

    await user.click(screen.getByLabelText(/value origin/i));
    await user.click(screen.getByRole("option", { name: /^variable$/i }));
    expect(screen.queryByLabelText(/^prefix$/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /add prefix/i }),
    ).not.toBeInTheDocument();
  });

  it("hides Agent origin on defaults rows", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        mode="defaults"
        initial={[{ key: "Version", origin: "fixed", value: "1" }]}
      />,
    );

    await user.click(screen.getByLabelText(/value origin/i));
    expect(
      screen.queryByRole("option", { name: /^agent$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /^fixed$/i }),
    ).toBeInTheDocument();
  });

  it("derives the agent argument from the key without a duplicate name field", async () => {
    const user = userEvent.setup();
    render(
      <Harness initial={[{ key: "locationId", origin: "fixed", value: "" }]} />,
    );

    await user.click(screen.getByLabelText(/value origin/i));
    await user.click(screen.getByRole("option", { name: /^agent$/i }));

    expect(screen.getByText(/agent param/i)).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/variable or param name/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/what is this value/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/^param type$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^required$/i)).toBeInTheDocument();
  });
});

describe("source row keyboard", () => {
  it("removes a row", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ key: "a", origin: "fixed", value: "1" }]} />);
    await user.click(screen.getByRole("button", { name: /remove row/i }));
    expect(screen.queryByLabelText(/^key$/i)).not.toBeInTheDocument();
  });
});

describe("SourceRowEditor agent input format", () => {
  it("selects a format on a string agent input", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={[
          {
            key: "email",
            origin: "agent",
            name: "email",
            description: "",
            type: "string",
            required: true,
          },
        ]}
      />,
    );

    expect(screen.getByLabelText(/input format/i)).toBeInTheDocument();
    await user.click(screen.getByLabelText(/input format/i));
    await user.click(screen.getByRole("option", { name: /^email$/i }));

    expect(screen.getByLabelText(/input format/i)).toHaveTextContent("Email");
  });

  it("hides the format selector for non-string inputs", () => {
    render(
      <Harness
        initial={[
          {
            key: "count",
            origin: "agent",
            name: "count",
            description: "",
            type: "number",
            required: true,
          },
        ]}
      />,
    );

    expect(screen.queryByLabelText(/input format/i)).not.toBeInTheDocument();
  });
});
