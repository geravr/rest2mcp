import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getTranslations } from "@/i18n";
import {
  SettingsFormSkeleton,
  StatValueSkeleton,
  TableRowsSkeleton,
} from "./index";

const composites = [
  ["TableRowsSkeleton", TableRowsSkeleton],
  ["StatValueSkeleton", StatValueSkeleton],
  ["SettingsFormSkeleton", SettingsFormSkeleton],
] as const;

describe("loading skeleton composites", () => {
  it.each(composites)(
    "%s exposes a busy status with the shared locale name",
    (_name, Composite) => {
      const label = getTranslations("en").common.loading;

      const { unmount } = render(<Composite />);

      const status = screen.getByRole("status", { name: label });
      expect(status).toHaveAttribute("aria-busy", "true");
      unmount();
    },
  );

  it("uses a loading label present in both locales", () => {
    expect(getTranslations("en").common.loading).toBe("Loading");
    expect(getTranslations("es").common.loading).toBe("Cargando");
  });
});
