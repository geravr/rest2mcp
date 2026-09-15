import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { TemplateValueInput } from "./template-value-input";

function Harness() {
  const [value, setValue] = useState("");
  return (
    <TemplateValueInput
      multiline
      showInsert
      value={value}
      onChange={setValue}
      variableNames={["api_token", "region"]}
      placeholder='{ "name": "{{name}}" }'
    />
  );
}

function typePartial(element: HTMLTextAreaElement, next: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(element, next);
  element.setSelectionRange(next.length, next.length);
  fireEvent.change(element);
}

describe("TemplateValueInput advanced textarea", () => {
  it("autocompletes variables after typing {{", () => {
    render(<Harness />);
    const textarea = screen.getByPlaceholderText(
      /\{\{name\}\}/,
    ) as HTMLTextAreaElement;
    typePartial(textarea, "{{api");

    const suggestion = screen.getByRole("option", { name: "{{api_token}}" });
    fireEvent.mouseDown(suggestion);

    expect(textarea).toHaveValue("{{api_token}}");
  });

  it("selects a suggestion with the keyboard", () => {
    render(<Harness />);
    const textarea = screen.getByPlaceholderText(
      /\{\{name\}\}/,
    ) as HTMLTextAreaElement;
    typePartial(textarea, "{{re");

    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });

    expect(textarea).toHaveValue("{{region}}");
  });

  it("inserts a variable from the insert control", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const textarea = screen.getByPlaceholderText(
      /\{\{name\}\}/,
    ) as HTMLTextAreaElement;

    await user.click(screen.getByRole("button", { name: /insert variable/i }));
    await user.click(screen.getByRole("menuitem", { name: "region" }));

    expect(textarea).toHaveValue("{{region}}");
  });
});
