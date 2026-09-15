import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CreateServerForm } from "./create-server-form";

describe("CreateServerForm", () => {
  it("submits Bearer auth in the create payload", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <CreateServerForm
        pending={false}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    await user.type(screen.getByLabelText(/^name$/i), "CRM");
    await user.type(
      screen.getByLabelText(/^base url$/i),
      "https://api.example.com",
    );
    await user.click(screen.getByLabelText(/^authentication$/i));
    await user.click(screen.getByRole("option", { name: /bearer token/i }));
    await user.type(screen.getByLabelText(/^token$/i), "sk_live_123");
    await user.click(screen.getByRole("button", { name: /create server/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: "CRM",
      baseUrl: "https://api.example.com",
      auth: { type: "bearer", token: "sk_live_123" },
    });
  });

  it("omits auth when type is None", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <CreateServerForm
        pending={false}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    await user.type(screen.getByLabelText(/^name$/i), "CRM");
    await user.type(
      screen.getByLabelText(/^base url$/i),
      "https://api.example.com",
    );
    await user.click(screen.getByRole("button", { name: /create server/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: "CRM",
      baseUrl: "https://api.example.com",
    });
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty("auth");
  });

  it("shows Header fields only for that auth type", async () => {
    const user = userEvent.setup();
    render(
      <CreateServerForm
        pending={false}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    await user.click(screen.getByLabelText(/^authentication$/i));
    await user.click(screen.getByRole("option", { name: /api key header/i }));

    expect(screen.getByLabelText(/header name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/header value/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^username$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^password$/i)).not.toBeInTheDocument();
  });
});
