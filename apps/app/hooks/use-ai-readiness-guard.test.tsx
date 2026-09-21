import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTranslations } from "@/i18n";
import { AiSettingsCta, useAiFeatureReadiness } from "./use-ai-readiness-guard";

const h = vi.hoisted(() => ({
  locale: "en" as "en" | "es",
  readiness: null as null | {
    capabilityProfile: string;
    ready: boolean;
    reason: string | null;
    selection: null | Record<string, unknown>;
  },
  isLoading: false,
}));

vi.mock("@/hooks/use-ai", () => ({
  useAiReadiness: () => ({ data: h.readiness, isLoading: h.isLoading }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: (props: { children: ReactNode; search: { tab: string } }) => (
    <a href={`/settings?tab=${props.search.tab}`}>{props.children}</a>
  ),
}));

vi.mock("@/i18n/use-translations", async () => {
  const { getTranslations } = await import("@/i18n");
  return {
    useTranslations: () => ({
      t: getTranslations(h.locale),
      locale: h.locale,
      setLocale: vi.fn(),
    }),
  };
});

const en = getTranslations("en");

type GuardState = {
  ready: boolean;
  reason: string | null;
  isLoading: boolean;
};

function Probe({ onState }: { onState: (state: GuardState) => void }) {
  onState(useAiFeatureReadiness("structured-text-v1"));
  return null;
}

describe("useAiFeatureReadiness", () => {
  beforeEach(() => {
    h.locale = "en";
    h.readiness = null;
    h.isLoading = false;
  });

  it("reports loading with not-ready defaults while the query resolves", () => {
    h.isLoading = true;
    let state: GuardState | undefined;
    render(<Probe onState={(value) => (state = value)} />);

    expect(state).toEqual({ ready: false, reason: null, isLoading: true });
  });

  it("reports ready with a null reason when the server reports readiness", () => {
    h.readiness = {
      capabilityProfile: "structured-text-v1",
      ready: true,
      reason: null,
      selection: null,
    };
    let state: GuardState | undefined;
    render(<Probe onState={(value) => (state = value)} />);

    expect(state).toEqual({ ready: true, reason: null, isLoading: false });
  });

  it("reports the server reason when the profile is not ready", () => {
    h.readiness = {
      capabilityProfile: "structured-text-v1",
      ready: false,
      reason: "no_selection",
      selection: null,
    };
    let state: GuardState | undefined;
    render(<Probe onState={(value) => (state = value)} />);

    expect(state).toEqual({
      ready: false,
      reason: "no_selection",
      isLoading: false,
    });
  });
});

describe("AiSettingsCta", () => {
  beforeEach(() => {
    h.locale = "en";
    h.readiness = null;
    h.isLoading = false;
  });

  it("renders nothing while readiness is loading", () => {
    h.isLoading = true;
    const { container } = render(
      <AiSettingsCta capabilityProfile="structured-text-v1" />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing once the capability profile is ready", () => {
    h.readiness = {
      capabilityProfile: "structured-text-v1",
      ready: true,
      reason: null,
      selection: null,
    };
    const { container } = render(
      <AiSettingsCta capabilityProfile="structured-text-v1" />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders muted guidance with a localized AI settings link when not ready", () => {
    h.readiness = {
      capabilityProfile: "structured-text-v1",
      ready: false,
      reason: "no_connection",
      selection: null,
    };
    render(<AiSettingsCta capabilityProfile="structured-text-v1" />);

    expect(screen.getByText(en.settings.ai.cta.guidance)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: en.settings.ai.cta.link });
    expect(link).toHaveAttribute("href", "/settings?tab=ai");
  });

  it("renders feature-specific guidance when provided", () => {
    h.readiness = {
      capabilityProfile: "structured-text-v1",
      ready: false,
      reason: "no_connection",
      selection: null,
    };
    render(
      <AiSettingsCta
        capabilityProfile="structured-text-v1"
        guidance="Draft generation needs AI setup."
      />,
    );

    expect(
      screen.getByText("Draft generation needs AI setup."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(en.settings.ai.cta.guidance),
    ).not.toBeInTheDocument();
  });

  it("renders localized copy for the active locale", () => {
    const es = getTranslations("es");
    h.locale = "es";
    h.readiness = {
      capabilityProfile: "structured-text-v1",
      ready: false,
      reason: "no_connection",
      selection: null,
    };
    render(<AiSettingsCta capabilityProfile="structured-text-v1" />);

    expect(screen.getByText(es.settings.ai.cta.guidance)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: es.settings.ai.cta.link }),
    ).toBeInTheDocument();
  });
});
