import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  detectPlaceholders,
  ParamsEditor,
  type ToolParamDraft,
} from "./params-editor";

const noop = () => {};

describe("detectPlaceholders", () => {
  it("collects placeholders across fields and excludes variable names", () => {
    expect(
      detectPlaceholders(
        ["/contacts/{{id}}", "{{limit}}", "Bearer {{api_token}}", ""],
        ["api_token"],
      ),
    ).toEqual(["id", "limit"]);
  });

  it("dedupes repeated placeholders", () => {
    expect(detectPlaceholders(["/{{id}}/{{id}}"], [])).toEqual(["id"]);
  });
});

describe("ParamsEditor", () => {
  const baseProps = {
    pathTemplate: "",
    query: [],
    headers: [],
    body: "",
    variableNames: [],
  };

  it("auto-declares a param when a new placeholder appears", () => {
    const onChange = vi.fn();
    render(
      <ParamsEditor
        {...baseProps}
        pathTemplate="/contacts/{{id}}"
        params={[]}
        onChange={onChange}
      />,
    );

    expect(onChange).toHaveBeenCalledWith([
      { name: "id", required: true, type: "string" },
    ]);
  });

  it("shows the empty hint when no params exist", () => {
    render(<ParamsEditor {...baseProps} params={[]} onChange={noop} />);

    expect(
      screen.getByText(/use \{\{name\}\} in the path/i),
    ).toBeInTheDocument();
  });

  it("flags orphaned params and removes them on demand", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const params: ToolParamDraft[] = [
      { name: "ghost", required: true, type: "string" },
    ];
    render(<ParamsEditor {...baseProps} params={params} onChange={onChange} />);

    expect(screen.getByText(/\{\{ghost\}\}/)).toBeInTheDocument();
    expect(screen.getByText(/declared but never used/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /remove param/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("renders server warnings next to the matching param", () => {
    const params: ToolParamDraft[] = [
      { name: "id", required: true, type: "string" },
    ];
    render(
      <ParamsEditor
        {...baseProps}
        pathTemplate="/contacts/{{id}}"
        params={params}
        onChange={noop}
        warnings={[{ type: "placeholder_without_param", name: "id" }]}
      />,
    );

    expect(
      screen.getByText(/used but has no declared param or variable/i),
    ).toBeInTheDocument();
  });
});
