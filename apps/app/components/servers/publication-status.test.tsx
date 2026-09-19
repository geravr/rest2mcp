import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ServerPublicationStatus } from "./publication-status";

describe("ServerPublicationStatus", () => {
  it("never claims a never-published server is callable", () => {
    render(
      <ServerPublicationStatus
        publishedRevisionNumber={null}
        dirty
        publishReady
      />,
    );

    expect(
      screen.getByText(/agents cannot call this server/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/unpublished changes/i)).toBeInTheDocument();
    expect(screen.queryByText(/publication blocked/i)).not.toBeInTheDocument();
  });

  it("shows the published revision and hides the dirty badge when clean", () => {
    render(
      <ServerPublicationStatus
        publishedRevisionNumber={3}
        dirty={false}
        publishReady
      />,
    );

    expect(screen.getByText(/published revision 3/i)).toBeInTheDocument();
    expect(screen.queryByText(/unpublished changes/i)).not.toBeInTheDocument();
  });

  it("flags blocking readiness while the draft is dirty", () => {
    render(
      <ServerPublicationStatus
        publishedRevisionNumber={3}
        dirty
        publishReady={false}
      />,
    );

    expect(screen.getByText(/publication blocked/i)).toBeInTheDocument();
  });
});
