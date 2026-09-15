import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { PathPartsEditor } from "./path-parts-editor";
import { joinPath, type PathPart } from "@/lib/value-origin";

function Harness({
  initial,
  variableNames = ["api_version"],
}: {
  initial: PathPart[];
  variableNames?: string[];
}) {
  const [parts, setParts] = useState<PathPart[]>(initial);
  return (
    <div>
      <PathPartsEditor
        parts={parts}
        onChange={setParts}
        variableNames={variableNames}
        pathInputId="tool-form-path"
      />
      <p data-testid="compiled-path">{joinPath(parts)}</p>
    </div>
  );
}

describe("PathPartsEditor", () => {
  it("shows a path placeholder without mustache syntax", () => {
    render(<Harness initial={[]} />);
    expect(screen.getByPlaceholderText("/contacts/")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/\{\{/)).not.toBeInTheDocument();
  });

  it("inserts an Agent token after static path text", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ kind: "text", value: "/contacts/" }]} />);

    await user.click(
      screen.getByRole("button", { name: /insert agent param/i }),
    );
    await user.type(
      screen.getByPlaceholderText(/what is this value/i),
      "Contact id",
    );

    expect(screen.getByDisplayValue("id")).toBeInTheDocument();
    expect(screen.queryByText("{{id}}")).not.toBeInTheDocument();
    expect(screen.getByTestId("compiled-path")).toHaveTextContent(
      "/contacts/{{id}}",
    );
  });

  it("inserts a Variable token", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ kind: "text", value: "/" }]} />);

    await user.click(screen.getByRole("button", { name: /insert variable/i }));

    expect(screen.getByTestId("compiled-path")).toHaveTextContent(
      "/{{api_version}}",
    );
  });

  it("types in the trailing caret after inserting a variable", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ kind: "text", value: "/contacts/" }]} />);

    await user.click(screen.getByRole("button", { name: /insert variable/i }));
    await user.type(screen.getByLabelText(/^path 3$/i), "/notes");

    expect(screen.getByTestId("compiled-path")).toHaveTextContent(
      "/contacts/{{api_version}}/notes",
    );
  });

  it("disables insert variable when there are no variables", () => {
    render(<Harness initial={[]} variableNames={[]} />);
    expect(
      screen.getByRole("button", { name: /insert variable/i }),
    ).toBeDisabled();
  });

  it("removes a variable token without a double slash", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={[
          { kind: "text", value: "/contacts/" },
          { kind: "variable", name: "api_version" },
          { kind: "text", value: "/notes" },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /remove token/i }));

    expect(screen.getByTestId("compiled-path")).toHaveTextContent(
      "/contacts/notes",
    );
  });

  it("types in a caret between two tokens", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={[
          { kind: "text", value: "/a/" },
          { kind: "variable", name: "api_version" },
          { kind: "text", value: "" },
          {
            kind: "agent",
            name: "id",
            description: "",
            type: "string",
            required: true,
          },
          { kind: "text", value: "/c" },
        ]}
      />,
    );

    await user.type(screen.getByLabelText(/^path 3$/i), "/mid/");

    expect(screen.getByTestId("compiled-path")).toHaveTextContent(
      "/a/{{api_version}}/mid/{{id}}/c",
    );
  });
});
