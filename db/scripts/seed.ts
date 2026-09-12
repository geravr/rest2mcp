#!/usr/bin/env bun
// Usage: bun scripts/seed.ts [--env ENVIRONMENT=staging|prod]

const environment = (process.env.ENVIRONMENT ?? "").toLowerCase();
const allowProdSeed = process.env.ALLOW_PROD_SEED === "true";

if (
  (environment === "prod" || environment === "production") &&
  !allowProdSeed
) {
  console.error(
    "Refusing to seed production. Set ALLOW_PROD_SEED=true to override.",
  );
  process.exit(1);
}

const { drizzle } = await import("drizzle-orm/postgres-js");
const postgres = (await import("postgres")).default;
const schema = await import("../schema");
const { seedUsers } = await import("../seeds/users");

// Import drizzle config to trigger environment loading
await import("../drizzle.config");

const client = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(client, { schema, casing: "snake_case" });

console.log("🌱 Starting database seeding...");

try {
  await seedUsers(db);
  console.log("✅ Database seeding completed successfully!");
} catch (error) {
  console.error("❌ Database seeding failed:");
  console.error(error);
  process.exitCode = 1;
} finally {
  await client.end();
}
