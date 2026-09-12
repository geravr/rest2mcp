import { user } from "@repo/db";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

type DB = PostgresJsDatabase<Record<string, unknown>>;

/**
 * Re-reads ban state from the database. Ban fields are not returned on the
 * session user payload (`returned: false`), so session cookies alone are not enough.
 */
export async function isUserBanned(db: DB, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ bannedAt: user.bannedAt })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  return row?.bannedAt != null;
}
