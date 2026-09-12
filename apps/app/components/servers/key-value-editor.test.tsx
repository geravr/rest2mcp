import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  KeyValueEditor,
  pairsToRecord,
  recordToPairs,
  type KeyValuePair,
} from "./key-value-editor";

describe("recordToPairs / pairsToRecord", () => {
  it("round-trips records and skips empty keys", () => {
    const record = { Authorization: "Bearer {{api_token}}", "x-region": "eu" };
    expect(pairsToRecord(recordToPairs(record))).toEqual(record);
    expect(
      pairsToRecord([
        { key: "", value: "ignored" },
        { key: "a", value: "1" },
      ]),
    ).toEqual({ a: "1" });
  });

  it("maps nullish records to an empty list", () => {
    expect(recordToPairs(null)).toEqual([]);
    expect(recordToPairs(undefined)).toEqual([]);
  });
});

describe("KeyValueEditor", () => {
  it("adds and removes rows", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<KeyValueEditor pairs={[]} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /add row/i }));
    expect(onChange).toHaveBeenCalledWith([{ key: "", value: "" }]);
  });

  it("removes the row at its index", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <KeyValueEditor
        pairs={[
          { key: "a", value: "1" },
          { key: "b", value: "2" },
        ]}
        onChange={onChange}
      />,
    );

    const removeButtons = screen.getAllByRole("button", {
      name: /remove row/i,
    });
    await user.click(removeButtons[0]);
    expect(onChange).toHaveBeenCalledWith([{ key: "b", value: "2" }]);
  });

  it("autocompletes variables after typing {{", () => {
    function Harness() {
      const [pairs, setPairs] = useState<KeyValuePair[]>([
        { key: "Authorization", value: "" },
      ]);
      return (
        <KeyValueEditor
          pairs={pairs}
          onChange={setPairs}
          variableNames={["api_token", "region"]}
        />
      );
    }

    render(<Harness />);

    const input = screen.getByPlaceholderText(
      /value or \{\{variable\}\}/i,
    ) as HTMLInputElement;
    // Set value and caret through the native setter so React's onChange
    // observes both (user-event parses `{{` as a key descriptor).
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, "{{api");
    input.setSelectionRange(5, 5);
    fireEvent.change(input);

    const suggestion = screen.getByRole("option", { name: "{{api_token}}" });
    fireEvent.mouseDown(suggestion);

    expect(input).toHaveValue("{{api_token}}");
  });

  it("navigates suggestions with the keyboard", () => {
    function Harness() {
      const [pairs, setPairs] = useState<KeyValuePair[]>([
        { key: "Authorization", value: "" },
      ]);
      return (
        <KeyValueEditor
          pairs={pairs}
          onChange={setPairs}
          variableNames={["api_token", "region"]}
        />
      );
    }

    render(<Harness />);

    const input = screen.getByPlaceholderText(
      /value or \{\{variable\}\}/i,
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, "{{");
    input.setSelectionRange(2, 2);
    fireEvent.change(input);

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "{{api_token}}" }),
    ).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "{{region}}" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("{{region}}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes suggestions with Escape", () => {
    function Harness() {
      const [pairs, setPairs] = useState<KeyValuePair[]>([
        { key: "Authorization", value: "" },
      ]);
      return (
        <KeyValueEditor
          pairs={pairs}
          onChange={setPairs}
          variableNames={["api_token"]}
        />
      );
    }

    render(<Harness />);

    const input = screen.getByPlaceholderText(
      /value or \{\{variable\}\}/i,
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, "{{");
    input.setSelectionRange(2, 2);
    fireEvent.change(input);

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveValue("{{");
  });
});
