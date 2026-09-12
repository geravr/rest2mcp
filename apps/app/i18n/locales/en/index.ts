import { defineTranslations } from "../../schema";
import { enAdmin } from "./admin";
import { enAuth } from "./auth";
import { enCommon } from "./common";
import { enDashboard } from "./dashboard";
import { enLayout } from "./layout";
import { enErrors } from "./errors";
import { enLegal } from "./legal";
import { enServers } from "./servers";
import { enSettings } from "./settings";

export const en = defineTranslations({
  ...enCommon,
  ...enAuth,
  ...enDashboard,
  ...enServers,
  ...enSettings,
  ...enAdmin,
  ...enLayout,
  ...enErrors,
  ...enLegal,
});
