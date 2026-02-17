---
name: DB-PR-01 Execution Plan
overview: "Detailed execution plan for DB-PR-01: Local Supabase Baseline. Initialize Supabase CLI in `apps/palace/`, wire environment variables, add convenience scripts, and prove connectivity with a server function and route."
todos:
  - id: init-supabase
    content: Run `supabase init` in apps/palace/ and review config.toml
    status: completed
  - id: start-capture-env
    content: Start local stack, capture credentials, create .env.example and .env.local
    status: completed
  - id: install-deps
    content: Install @supabase/supabase-js dependency
    status: completed
  - id: server-env
    content: Create src/server/env.ts (typed env loader with zod)
    status: completed
  - id: supabase-client
    content: Create src/server/supabase.ts (minimal server-only client factory)
    status: completed
  - id: health-check
    content: Create server function + /health route for connectivity proof
    status: completed
  - id: scripts
    content: Add db:local:start/stop/status scripts to package.json
    status: completed
  - id: gitignore
    content: Verify .gitignore covers supabase temp files and .env.local
    status: completed
  - id: runbook
    content: Write local setup runbook in README.md
    status: completed
isProject: false
---

# DB-PR-01: Local Supabase Baseline -- Execution Plan

## Current state

- TanStack Start app at `apps/palace/` (Vite + Vinxi/Nitro SSR)
- No `supabase/` directory, no `src/server/` directory, no `.env` files
- No database or Supabase dependencies installed
- Package manager: **bun**
- `.gitignore` already covers `.env` and `*.local`

## Prerequisites (manual, before running the PR)

- **Docker Desktop** installed and running (Supabase local stack runs in Docker)
- **Supabase CLI** installed: `brew install supabase/tap/supabase`

---

## Step 1: Initialize Supabase project

Run from `apps/palace/`:

```bash
supabase init
```

This creates `apps/palace/supabase/config.toml`. Review the generated config:

- Confirm project name / ID
- Note default ports (API: 54321, DB: 54322, Studio: 54323, Inbucket: 54324)
- No custom changes needed for PR-01

The Supabase CLI also creates a `.gitignore` inside `supabase/` to exclude temp/branch data.

## Step 2: Start local stack and capture credentials

```bash
supabase start
supabase status
```

`supabase status` outputs the local URLs and keys we need:

- `API URL` (e.g. `http://127.0.0.1:54321`)
- `anon key`
- `service_role key`
- `DB URL` (e.g. `postgresql://postgres:postgres@127.0.0.1:54322/postgres`)

## Step 3: Create environment files

`**.env.example**` at `apps/palace/.env.example` -- committed, documents all required vars:

```env
# Supabase local (from `supabase status`)
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<from supabase status>
SUPABASE_SERVICE_ROLE_KEY=<from supabase status>
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

`**.env.local**` at `apps/palace/.env.local` -- gitignored, populated with real local values from `supabase status`. Same shape as `.env.example` but with actual keys.

Note: TanStack Start (Vite-based) auto-loads `.env.local`. Server-side code gets all vars via `process.env`. Client-exposed vars would need a `VITE_` prefix, but for PR-01 everything is server-only.

## Step 4: Install Supabase JS dependency

```bash
bun add @supabase/supabase-js
```

in `apps/palace/`. This is the only new dependency for PR-01.

## Step 5: Create server-side env config

Create `[apps/palace/src/server/env.ts](apps/palace/src/server/env.ts)` -- a typed env loader using `zod` (already a dependency):

```typescript
import { z } from 'zod';

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;
export const env = envSchema.parse(process.env);
```

This validates at import time -- the app will fail fast if env vars are missing.

## Step 6: Create Supabase client factory (server-only)

Create `[apps/palace/src/server/supabase.ts](apps/palace/src/server/supabase.ts)`:

```typescript
import { createClient } from '@supabase/supabase-js';
import { env } from './env';

export function createSupabaseAdmin() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}
```

This is a minimal server-only client for the connectivity check. The full typed-client setup (browser client, user-context client, generated types) is deferred to PR-04 per the delivery plan.

## Step 7: Create connectivity check server function + route

**Server function** at `[apps/palace/src/server/db/health.ts](apps/palace/src/server/db/health.ts)`:

```typescript
import { createServerFn } from '@tanstack/react-start';
import { createSupabaseAdmin } from '../supabase';

export const checkDbHealth = createServerFn({ method: 'GET' })
  .handler(async () => {
    try {
      const supabase = createSupabaseAdmin();
      // Simple connectivity proof: list 0 rows from a system endpoint
      const { error } = await supabase.auth.admin.listUsers({ perPage: 1 });
      return {
        ok: !error,
        timestamp: new Date().toISOString(),
        error: error?.message ?? null,
      };
    } catch (e) {
      return {
        ok: false,
        timestamp: new Date().toISOString(),
        error: e instanceof Error ? e.message : 'Unknown error',
      };
    }
  });
```

**Route** at `[apps/palace/src/routes/health.tsx](apps/palace/src/routes/health.tsx)` -- a simple page that calls the server function and displays the result. This gives a visual confirmation and satisfies the "any developer can verify connectivity" acceptance criterion.

Alternatively, this could be integrated into the existing index route as a small status indicator. The route approach is cleaner for PR-01 since it's self-contained and easy to remove later.

## Step 8: Add package.json scripts

Add to `[apps/palace/package.json](apps/palace/package.json)` scripts:

```json
{
  "db:local:start": "supabase start",
  "db:local:stop": "supabase stop",
  "db:local:status": "supabase status"
}
```

These are local-only dev commands -- no turbo task wiring needed for PR-01.

## Step 9: Update .gitignore (if needed)

Verify that `supabase init` created its own `.gitignore` inside `supabase/` for temp data. If not, ensure the palace-level `.gitignore` excludes:

- `supabase/.branches`
- `supabase/.temp`

The `supabase/config.toml` **should** be committed (it is the project config).

## Step 10: Write setup runbook

Add a concise **"Local Database Setup"** section to `[apps/palace/README.md](apps/palace/README.md)` (or a dedicated `SETUP.md`):

1. Install prerequisites (Docker, Supabase CLI)
2. `cd apps/palace && bun run db:local:start`
3. Copy `.env.example` to `.env.local`, fill in values from `bun run db:local:status`
4. `bun run dev`
5. Visit `/health` to confirm connectivity

---

## Files created or modified in this PR


| Action    | Path                                                      |
| --------- | --------------------------------------------------------- |
| Generated | `apps/palace/supabase/config.toml` (+ supabase internals) |
| Created   | `apps/palace/.env.example`                                |
| Created   | `apps/palace/.env.local` (gitignored)                     |
| Created   | `apps/palace/src/server/env.ts`                           |
| Created   | `apps/palace/src/server/supabase.ts`                      |
| Created   | `apps/palace/src/server/db/health.ts`                     |
| Created   | `apps/palace/src/routes/health.tsx`                       |
| Modified  | `apps/palace/package.json` (dependency + scripts)         |
| Modified  | `apps/palace/README.md` (runbook section)                 |


## What is intentionally NOT in this PR

- Drizzle (PR-02)
- Atlas (PR-03)
- Typed Supabase clients with generated types (PR-04)
- Browser Supabase client (PR-04)
- Any real schema/tables
- VITE_-prefixed env vars for client-side access

## Done-when checklist

- `supabase start` boots the local stack from `apps/palace/`
- `.env.local` is populated and gitignored
- `bun run dev` starts the app with DB env vars loaded
- `/health` route shows a green connectivity status
- Any new developer can follow the runbook from zero to running

