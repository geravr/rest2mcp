/**
 * @file Shared database client using PostgreSQL via a direct connection string.
 */

import { schema } from "@repo/db";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

type CreateDbOptions = {
  max?: number;
};

export function createDb(connectionString: string, options?: CreateDbOptions) {
  const client = postgres(connectionString, {
    max: options?.max ?? 10,
    connect_timeout: 10,
    prepare: false,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    transform: {
      undefined: null,
    },
    onnotice: () => {},
  });

  return drizzle(client, { schema, casing: "snake_case" });
}

export { schema as Db };
