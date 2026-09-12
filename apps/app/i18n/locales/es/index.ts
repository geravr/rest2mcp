import type { Widened } from "../../schema";
import { en } from "../en";
import { esAdmin } from "./admin";
import { esAuth } from "./auth";
import { esCommon } from "./common";
import { esDashboard } from "./dashboard";
import { esLayout } from "./layout";
import { esErrors } from "./errors";
import { esLegal } from "./legal";
import { esSettings } from "./settings";

export const es: Widened<typeof en> = {
  ...esCommon,
  ...esAuth,
  ...esDashboard,
  ...esSettings,
  ...esAdmin,
  ...esLayout,
  ...esErrors,
  ...esLegal,
};
