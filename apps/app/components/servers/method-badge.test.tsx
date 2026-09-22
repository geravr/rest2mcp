import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MethodBadge } from "./method-badge";

describe("MethodBadge", () => {
  it("tints each known verb with its pastel method color", () => {
    render(
      <>
        <MethodBadge method="GET" />
        <MethodBadge method="POST" />
        <MethodBadge method="PUT" />
        <MethodBadge method="PATCH" />
        <MethodBadge method="DELETE" />
      </>,
    );

    expect(screen.getByText("GET")).toHaveClass("bg-emerald-100");
    expect(screen.getByText("POST")).toHaveClass("bg-sky-100");
    expect(screen.getByText("PUT")).toHaveClass("bg-amber-100");
    expect(screen.getByText("PATCH")).toHaveClass("bg-violet-100");
    expect(screen.getByText("DELETE")).toHaveClass("bg-rose-100");
  });

  it("matches verbs case-insensitively and keeps unknown verbs neutral", () => {
    render(
      <>
        <MethodBadge method="get" />
        <MethodBadge method="TRACE" />
      </>,
    );

    expect(screen.getByText("get")).toHaveClass("bg-emerald-100");
    expect(screen.getByText("TRACE")).not.toHaveClass("bg-emerald-100");
  });

  it("merges caller classes over the method tint", () => {
    render(<MethodBadge method="GET" className="font-mono" />);

    const badge = screen.getByText("GET");
    expect(badge).toHaveClass("font-mono");
    expect(badge).toHaveClass("bg-emerald-100");
  });
});
