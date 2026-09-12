/**
 * @file Database schema exports.
 *
 * Re-exports Drizzle ORM schemas for users, authentication, and platform admin.
 */

import * as schema from "./schema";

export * from "./schema";
export { schema };
export type DatabaseSchema = typeof schema;
