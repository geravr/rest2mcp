import { z } from "zod";

export const settingsTabValues = [
  "profile",
  "security",
  "privacy",
  "platform",
  "ai",
] as const;

export type SettingsTab = (typeof settingsTabValues)[number];

export const settingsSearchSchema = z.object({
  tab: z.enum(settingsTabValues).optional().catch(undefined),
});
