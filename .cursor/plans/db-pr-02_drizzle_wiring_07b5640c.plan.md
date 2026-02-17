---
name: DB-PR-02 Drizzle Wiring
overview: Wire Drizzle ORM into the palace app with typed schema, query modules, and a working endpoint -- all ready for Atlas integration in PR-03.
todos:
  - id: install-deps
    content: Install drizzle-orm, postgres (runtime) and drizzle-kit (dev) in apps/palace/
    status: completed
  - id: drizzle-config
    content: Create drizzle.config.ts at apps/palace/ root
    status: completed
  - id: db-client
    content: Create src/server/db/client.ts with centralized Drizzle client
    status: completed
  - id: schema-table
    content: Create src/server/db/schema/profiles.ts (test table, no barrel file)
    status: completed
  - id: query-module
    content: Create src/server/db/queries/profiles.ts with typed query functions
    status: completed
  - id: server-fn-route
    content: Create server function and wire up a route exercising the typed query path
    status: completed
  - id: push-schema
    content: Run drizzle-kit push to sync profiles table to local DB
    status: completed
  - id: package-scripts
    content: Add db:export and db:push:fast scripts to package.json
    status: completed
  - id: verify-export
    content: Run drizzle-kit export and confirm valid SQL output
    status: completed
isProject: false
---

# DB-PR-02: Drizzle Core Wiring

## Starting point (PR-01 complete)

- Supabase local stack is operational (`apps/palace/supabase/`)
- `DATABASE_URL` is already in `.env.local` and validated by `src/server/env.ts`
- `src/server/db/health.ts` exists (uses Supabase JS client for connectivity proof)
- Package manager is **bun**, project is `"type": "module"` (ESM)

## 1. Install dependencies

In `apps/palace/`:

```bash
bun add drizzle-orm postgres
bun add -d drizzle-kit
```

- `drizzle-orm` -- the ORM runtime
- `postgres` -- postgres.js driver (pure JS, ESM-native, works with bun + Supabase Postgres)
- `drizzle-kit` -- dev tooling for `export`, `push`, introspection (needed for Atlas `external_schema` in PR-03)

## 2. Create `drizzle.config.ts`

New file: [apps/palace/drizzle.config.ts](apps/palace/drizzle.config.ts)

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema/*",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

Key choices:

- `schema` uses a glob pattern -- drizzle-kit natively picks up all `.ts` files in the directory, no barrel file needed
- `out: "./drizzle"` is the default output directory for any kit artifacts
- `dbCredentials.url` reads `DATABASE_URL` from env (same var already in `.env.local`)
- This config is also what Atlas will call via `drizzle-kit export` in PR-03

## 3. Create DB client -- `src/server/db/client.ts`

New file: [apps/palace/src/server/db/client.ts](apps/palace/src/server/db/client.ts)

```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as profiles from "./schema/profiles";

const connection = postgres(env.DATABASE_URL);

export const db = drizzle(connection, { schema: { ...profiles } });
```

Design decisions per [doc 02](apps/palace/docs/database-v1/02-drizzle-schema-and-connections.md):

- Centralized -- no route file should instantiate DB connections
- Reads `DATABASE_URL` from the typed env loader (already validated by zod)
- Passes full schema for relational query support (import each schema module directly, no barrel file)
- Single connection instance strategy (postgres.js handles pooling internally)
- As more schema files are added, add another `import * as <domain>` and spread into the schema object

## 4. Create test table -- `src/server/db/schema/profiles.ts`

New file: [apps/palace/src/server/db/schema/profiles.ts](apps/palace/src/server/db/schema/profiles.ts)

```typescript
import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const profiles = pgTable("profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
```

Why `profiles`:

- A natural first table for any app with auth (ties to Supabase auth users later)
- Simple enough to prove wiring, meaningful enough to keep long-term
- Follows naming conventions from doc 02: snake_case columns, explicit names

## 5. Create query module -- `src/server/db/queries/profiles.ts`

New file: [apps/palace/src/server/db/queries/profiles.ts](apps/palace/src/server/db/queries/profiles.ts)

```typescript
import { eq } from "drizzle-orm";
import { db } from "../client";
import { profiles } from "../schema/profiles";

export async function listProfiles() {
  return db.select().from(profiles);
}

export async function getProfileById(id: string) {
  return db.select().from(profiles).where(eq(profiles.id, id));
}

export async function createProfile(data: { displayName: string; avatarUrl?: string }) {
  return db.insert(profiles).values(data).returning();
}
```

Per doc 02: query logic lives in `queries/*`, not in route files. Routes call query modules through the service layer (or directly for simple cases in PR-02).

## 6. Create server function for the endpoint

New file: [apps/palace/src/server/db/profiles-fn.ts](apps/palace/src/server/db/profiles-fn.ts)

```typescript
import { createServerFn } from "@tanstack/react-start";
import { listProfiles } from "./queries/profiles";

export const getProfiles = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await listProfiles();
  return { profiles: rows, timestamp: new Date().toISOString() };
});
```

This is a TanStack Start server function (same pattern as the existing `checkDbHealth` in `health.ts`). It exercises the full typed query path: route -> server function -> query module -> Drizzle client -> Postgres.

## 7. Wire up a route that exercises the typed path

Either update the existing `/health` route to also show Drizzle connectivity, or create a minimal `/db-test` route that calls `getProfiles` in its loader and renders the result. The route proves the "typed query path is exercised by an app endpoint" acceptance criterion.

## 8. Push the schema to local DB

Before the endpoint will work, the `profiles` table needs to exist in the local Postgres. For PR-02, we use Drizzle's rapid prototyping mode:

```bash
bunx drizzle-kit push
```

This syncs the Drizzle schema directly to the local DB. Per [doc 04](apps/palace/docs/database-v1/04-migration-strategy-supabase-drizzle-atlas.md), `push` is the correct tool for "early prototyping before Atlas config is in place." Atlas takes over in PR-03.

## 9. Add package scripts

Add to [apps/palace/package.json](apps/palace/package.json) scripts:

```json
"db:export": "drizzle-kit export",
"db:push:fast": "drizzle-kit push"
```

- `db:export` -- validates that `drizzle-kit export` produces valid SQL (PR-02 acceptance criterion, and needed by Atlas in PR-03)
- `db:push:fast` -- rapid prototyping sync per doc 04

## 10. Verify `drizzle-kit export`

Run:

```bash
bun run db:export
```

This should output valid SQL DDL for the `profiles` table. This is a hard acceptance criterion for PR-02 and confirms the config is ready for Atlas `external_schema` integration in PR-03.

---

## Final file tree after PR-02

```
apps/palace/
  drizzle.config.ts              (new)
  drizzle/                       (new, generated by drizzle-kit, gitignored or committed per preference)
  src/server/
    env.ts                       (existing, unchanged)
    supabase.ts                  (existing, unchanged)
    db/
      client.ts                  (new - Drizzle client)
      health.ts                  (existing, unchanged)
      profiles-fn.ts             (new - server function)
      schema/
        profiles.ts              (new - test table)
      queries/
        profiles.ts              (new - query module)
  src/routes/
    health.tsx                   (existing, may be updated or new route added)
```

## Acceptance checklist (from delivery plan)

- Drizzle dependencies and `drizzle.config.ts` added
- `src/server/db/*` structure present (client, schema, queries)
- One test schema/table defined in Drizzle TS (`profiles`)
- One query module used by a service (`queries/profiles.ts` -> server function -> route)
- `drizzle-kit export` produces valid SQL output
- Typed query path is exercised by an app endpoint

