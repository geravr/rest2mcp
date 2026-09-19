import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ToolGroupFilter } from "./tool-group-filter";

function group(id: string, name: string, toolCount: number) {
  return {
    id,
    name,
    normalizedName: name.toLowerCase(),
    toolCount,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

const groups = [group("mtg_1", "Invoices", 2), group("mtg_2", "Bills", 1)];

describe("ToolGroupFilter", () => {
  it("renders All with the total and every group with its own tool count", async () => {
    const user = userEvent.setup();
    render(
      <ToolGroupFilter
        groups={groups}
        value={undefined}
        total={5}
        onChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("combobox"));

    expect(
      screen.getByRole("option", { name: /All · 5 tools/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /Ungrouped/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /Invoices · 2 tools/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /Bills · 1 tool/ }),
    ).toBeInTheDocument();
  });

  it("reports undefined when All is selected", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ToolGroupFilter
        groups={groups}
        value="ungrouped"
        total={5}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: /All/ }));

    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("reports ungrouped when Ungrouped is selected", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ToolGroupFilter
        groups={groups}
        value="mtg_1"
        total={5}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: /Ungrouped/ }));

    expect(onChange).toHaveBeenCalledWith("ungrouped");
  });

  it("reports the group id when a group is selected", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ToolGroupFilter
        groups={groups}
        value={undefined}
        total={5}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: /Invoices/ }));

    expect(onChange).toHaveBeenCalledWith("mtg_1");
  });

  it("omits the All count when no total is provided", () => {
    render(
      <ToolGroupFilter groups={groups} value={undefined} onChange={vi.fn()} />,
    );

    expect(screen.getByText("All")).toBeInTheDocument();
  });
});
