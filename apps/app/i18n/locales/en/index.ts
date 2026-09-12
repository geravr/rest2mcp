import { defineTranslations } from "../../schema";
import { enAdmin } from "./admin";
import { enAuth } from "./auth";
import { enCommon } from "./common";
import { enDashboard } from "./dashboard";
import { enLayout } from "./layout";
import { enErrors } from "./errors";
import { enLegal } from "./legal";
import { enSettings } from "./settings";

export const en = defineTranslations({
  ...enCommon,
  ...enAuth,
  ...enDashboard,
  ...enSettings,
  ...enAdmin,
  ...enLayout,
  ...enErrors,
  ...enLegal,
});
