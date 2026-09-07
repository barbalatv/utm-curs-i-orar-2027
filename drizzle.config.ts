import { defineConfig } from "drizzle-kit";

/**
 * Schema tooling talks to the *deployment's* database, never a hard-coded localhost:
 * the history table lives wherever DATABASE_URL points, and pushing a schema at the
 * wrong server is exactly the kind of mistake a checked-in connection string invites.
 *
 *   DATABASE_URL=… npx drizzle-kit migrate    # apply drizzle/*.sql in order (preferred)
 *   npx drizzle-kit generate                  # author a new migration from schema.ts
 *
 * `generate` is offline and needs no URL; `migrate` and `push` do.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
