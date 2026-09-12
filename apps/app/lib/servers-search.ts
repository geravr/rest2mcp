import { listPaginationSearchSchema } from "@/lib/list-search";
import { z } from "zod";

export const serversSearchSchema = listPaginationSearchSchema;

export const serverDetailTabValues = [
  "tools",
  "credential",
  "playground",
  "logs",
] as const;

export type ServerDetailTab = (typeof serverDetailTabValues)[number];

export const serverDetailSearchSchema = listPaginationSearchSchema.extend({
  tab: z.enum(serverDetailTabValues).optional().catch(undefined),
});
