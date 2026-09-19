import { listPaginationSearchSchema } from "@/lib/list-search";
import { z } from "zod";

export const serversSearchSchema = listPaginationSearchSchema;

export const serverDetailTabValues = [
  "tools",
  "playground",
  "logs",
  "revisions",
  "connection",
  "settings",
] as const;

export type ServerDetailTab = (typeof serverDetailTabValues)[number];

export const serverDetailSearchSchema = listPaginationSearchSchema.extend({
  tab: z.enum(serverDetailTabValues).optional().catch(undefined),
  log: z.string().min(1).optional().catch(undefined),
  /** `"all"` and an absent value are both unfiltered; `"ungrouped"` and a group id filter. */
  group: z.string().min(1).optional().catch(undefined),
});
