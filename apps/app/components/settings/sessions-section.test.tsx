import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getTranslations } from "@/i18n";
import { SessionsSection } from "./security-sections";

const currentSession = {
  id: "session-1",
  token: "token-1",
  userAgent: "Test Browser",
};

describe("SessionsSection loading", () => {
  it("shows a row skeleton only when sessions have not painted yet", () => {
    const label = getTranslations("en").common.loading;
    const { unmount } = render(
      <SessionsSection
        sessions={[]}
        sessionsLoading
        sessionsError={null}
        currentSessionToken="token-1"
        onRefreshAccountState={async () => undefined}
      />,
    );

    expect(screen.getByRole("status", { name: label })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    unmount();
  });

  it("keeps painted sessions visible while a refresh is pending", () => {
    render(
      <SessionsSection
        sessions={[currentSession]}
        sessionsLoading
        sessionsError={null}
        currentSessionToken="token-1"
        onRefreshAccountState={async () => undefined}
      />,
    );

    expect(screen.getByText("Test Browser")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
