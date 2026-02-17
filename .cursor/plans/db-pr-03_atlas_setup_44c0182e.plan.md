---
name: DB-PR-03 Atlas Setup
overview: Wire Atlas declarative schema management into the palace app, using composite_schema to merge Drizzle's external_schema with raw SQL files. Prove the full preview -> apply -> drift workflow for both Drizzle TS changes and raw SQL changes.
todos:
  - id: sql-dir
    content: Create `apps/palace/sql/extensions.sql` placeholder file
    status: cancelled
  - id: atlas-hcl
    content: Create `apps/palace/atlas.hcl` with external_schema (drizzle-kit export) + composite_schema + local env
    status: cancelled
  - id: package-scripts
    content: Add db:preview, db:apply, db:drift scripts to package.json
    status: cancelled
  - id: verify-env-loading
    content: Test that `bun run db:preview` correctly loads .env.local and passes DATABASE_URL to atlas and drizzle-kit export subprocess
    status: cancelled
  - id: verify-no-drift
    content: Run db:preview and db:drift against current DB state -- expect no changes (profiles table already matches)
    status: cancelled
  - id: test-drizzle-change
    content: Add a test column to profiles Drizzle schema, run preview -> apply -> drift cycle
    status: cancelled
  - id: test-sql-change
    content: Add a test extension to extensions.sql, run preview -> apply -> drift cycle
    status: cancelled
  - id: handle-edge-cases
    content: Handle __drizzle_migrations exclusion, docker image pull, any first-run diffs
    status: cancelled
  - id: docs-update
    content: Update README/appendix with Atlas workflow documentation
    status: cancelled
isProject: false
---

# DB-PR-03: Atlas Declarative Setup

## Starting point (PR-01 + PR-02 complete)

- Supabase local stack operational (Postgres 17, port 54322)
- Drizzle wired: `drizzle.config.ts`, `src/server/db/schema/profiles.ts`, client, queries
- `drizzle-kit export` produces valid SQL for the `profiles` table
- `drizzle-kit push` was used to sync the schema to local DB (creates `__drizzle_migrations` table)
- Atlas CLI v1.0.0 already installed (`/etc/profiles/per-user/alonzothomas/bin/atlas`)
- Package manager: **bun** (auto-loads `.env.local` when running scripts)
- `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`

## Key decisions

- **Postgres version**: Local Supabase runs PG 17, so Atlas dev URL must use `docker://postgres/17/dev`
- **Schema scope**: Use `schemas = ["public"]` to only manage public schema (cleaner than excluding every Supabase internal schema)
- **Drizzle migration table**: Exclude `public.__drizzle_migrations` from Atlas management (artifact from PR-02's `drizzle-kit push`)
- **Env loading**: `bun run <script>` auto-loads `.env.local` -- atlas (spawned as child process) inherits env vars. If this doesn't work, fallback to explicit `set -a && . ./.env.local && ...` shell wrapper
- **Auto-approve**: Use `--auto-approve` for dev scripts (skip interactive prompt). The dry-run command still shows what would change.

---

## Phase 1: Create `sql/` directory with placeholder files

Create the following files under `apps/palace/sql/`:

**`sql/extensions.sql`** -- placeholder for extension declarations:
```sql
-- Extensions managed by Atlas composite_schema.
-- Add `create extension if not exists <name>;` statements here.
```

No `functions.sql` or `triggers.sql` yet -- those belong to PR-06. The `atlas.hcl` composite_schema will only reference files that exist. Adding more SQL files later is trivial (add the file, add one line to `atlas.hcl`).

## Phase 2: Create `atlas.hcl`

New file: [apps/palace/atlas.hcl](apps/palace/atlas.hcl)

```hcl
data "external_schema" "drizzle" {
  program = ["bunx", "drizzle-kit", "export"]
}

data "composite_schema" "app" {
  schema "public" {
    url = data.external_schema.drizzle.url
  }
  schema "public" {
    url = "file://sql/extensions.sql"
  }
}

env "local" {
  url = getenv("DATABASE_URL")
  dev = "docker://postgres/17/dev?search_path=public"
  schemas = ["public"]
  exclude = ["public.__drizzle_migrations"]

  schema {
    src = data.composite_schema.app.url
  }
}
```

Key design choices:

- **`external_schema`**: Runs `bunx drizzle-kit export` to get Drizzle DDL as SQL. Atlas captures stdout as a schema source. `bunx` (not `npx`) because the project uses bun.
- **`composite_schema`**: Merges Drizzle output + raw SQL files into one desired state. Both target `schema "public"`. When new SQL files are added (functions, triggers, seeds), add another `schema "public"` block pointing to them.
- **`dev = "docker://postgres/17/dev?search_path=public"`**: Atlas spins up a temporary PG 17 Docker container (matching Supabase's PG 17) for normalizing and validating schema diffs. Requires Docker (already running for Supabase).
- **`schemas = ["public"]`**: Atlas only manages the `public` schema. Supabase's internal schemas (`auth`, `storage`, `realtime`, `supabase_functions`, `extensions`, `pgsodium`, `vault`, etc.) are completely ignored.
- **`exclude = ["public.__drizzle_migrations"]`**: Ignores the migration tracking table left by `drizzle-kit push` in PR-02. Atlas should not try to drop it.

## Phase 3: Add package.json scripts

Add to [apps/palace/package.json](apps/palace/package.json) scripts:

```json
"db:preview": "atlas schema apply --env local --dry-run",
"db:apply": "atlas schema apply --env local --auto-approve",
"db:drift": "atlas schema diff --env local"
```

- **`db:preview`** -- Shows what SQL Atlas would run without touching the DB. This is the "what will change?" check.
- **`db:apply`** -- Applies the diff to the local DB. Uses `--auto-approve` for frictionless local dev. Remove flag for production.
- **`db:drift`** -- Compares live DB state against desired state. No diff = schema is in sync.

Note on env loading: When run via `bun run db:preview`, bun auto-loads `.env.local`, making `DATABASE_URL` available to atlas. The `drizzle-kit export` subprocess also inherits these env vars. If bun's auto-load doesn't propagate to system binaries, the fallback approach is:

```json
"db:preview": "set -a && . ./.env.local && atlas schema apply --env local --dry-run"
```

## Phase 4: Verification sequence

This is the critical acceptance flow. Run these in order:

### 4a. Verify initial state (no drift)

The DB currently has a `profiles` table (from `drizzle-kit push`). The Drizzle schema also defines `profiles`. On first run, these should match.

```bash
bun run db:preview
# Expected: "Schema is synced, no changes to be made" (or no statements)

bun run db:drift
# Expected: no diff
```

If there IS a diff on first run (e.g., minor column default discrepancy between push and export), apply it once to synchronize:

```bash
bun run db:apply
bun run db:drift  # Now should show no diff
```

### 4b. Test Drizzle schema change flow

Add a column to `profiles` in [apps/palace/src/server/db/schema/profiles.ts](apps/palace/src/server/db/schema/profiles.ts):

```typescript
bio: text("bio"),  // new nullable column
```

Then run the full cycle:

```bash
bun run db:preview
# Expected: shows ALTER TABLE "profiles" ADD COLUMN "bio" text;

bun run db:apply
# Expected: applies the ALTER

bun run db:drift
# Expected: no diff
```

Revert the test column after verification (or keep it if useful).

### 4c. Test raw SQL file change flow

Add a real extension to `sql/extensions.sql`:

```sql
create extension if not exists pg_trgm;
```

Then:

```bash
bun run db:preview
# Expected: shows CREATE EXTENSION "pg_trgm"

bun run db:apply
# Expected: applies cleanly

bun run db:drift
# Expected: no diff
```

Revert the test extension after verification (or keep `pg_trgm` if useful for text search).

## Phase 5: Handle edge cases and cleanup

### Edge case: Atlas `docker://` dev database

The `docker://postgres/17/dev` URL requires Atlas to pull the `postgres:17` Docker image on first use. If this hasn't been pulled before, the first `db:preview` run will take 30-60 seconds. Document this in the runbook.

### Edge case: `__drizzle_migrations` table

If the `exclude` pattern for `__drizzle_migrations` doesn't work as expected (Atlas tries to drop it), we have two options:
- Drop the table manually (`DROP TABLE IF EXISTS __drizzle_migrations;`) since Atlas now owns schema management
- Adjust the exclude pattern syntax (may need `"__drizzle_migrations"` without schema prefix)

### Cleanup: Remove `db:push:fast` script

With Atlas managing schema applies, `drizzle-kit push` should no longer be the primary sync mechanism. Either:
- Remove `db:push:fast` from package.json (clean break)
- Keep it but add a comment that it's for emergency rapid prototyping only

Recommendation: Keep it for now with a note. It's still useful for pure-Drizzle experimentation. Atlas is the authority for production-path schema management.

### Update .gitignore

Ensure `atlas.hcl` IS committed (it's project config, like `drizzle.config.ts`). The `sql/` directory IS committed. No Atlas artifacts need gitignoring for declarative mode (no migration directory in this PR).

## Phase 6: Documentation

Add a brief "Schema Management" section to [apps/palace/README.md](apps/palace/README.md) or the appendix:

- Day-to-day workflow: edit Drizzle schema or SQL files -> `bun run db:preview` -> `bun run db:apply` -> `bun run db:drift`
- Atlas owns schema apply; Supabase CLI owns local infrastructure
- `db:push:fast` is for rapid prototyping only

---

## Final file tree after PR-03

```
apps/palace/
  atlas.hcl                        (new - Atlas config)
  sql/
    extensions.sql                 (new - extension declarations placeholder)
  drizzle.config.ts                (existing, unchanged)
  src/server/db/
    schema/profiles.ts             (existing, unchanged -- or with test column)
    client.ts                      (existing, unchanged)
    queries/profiles.ts            (existing, unchanged)
    health.ts                      (existing, unchanged)
    profiles-fn.ts                 (existing, unchanged)
  package.json                     (modified - new scripts)
```

## Acceptance checklist (from delivery plan)

- Atlas CLI installed and `atlas.hcl` configured
- `sql/` directory created with initial `extensions.sql` placeholder
- `composite_schema` merges Drizzle `external_schema` + SQL files
- `db:preview` (`atlas schema apply --dry-run`) works
- `db:apply` (`atlas schema apply`) applies cleanly
- `db:drift` shows no diff after apply
- Package scripts added
- Schema change in Drizzle TS -> preview -> apply -> drift check all work
- Raw SQL file change (e.g., add extension) -> preview -> apply works

## Potential gotchas to watch for

1. **Atlas "unofficial" binary**: The installed version is from the community build (`v1.0.0`). If `docker://` dev URLs or `composite_schema` don't work, install the official binary via `curl -sSf https://atlasgo.sh | sh`
2. **Env var propagation**: If `bun run` doesn't propagate `.env.local` vars to atlas, switch to the `set -a && . ./.env.local` wrapper pattern
3. **First-run diff**: The profiles table created by `drizzle-kit push` might have subtle differences from what `drizzle-kit export` produces. One initial apply should reconcile this.
4. **Docker image pull**: First `docker://postgres/17` usage will pull the image (~150MB). Subsequent runs reuse it.
5. **Supabase internal tables in public**: If Supabase creates any objects in `public` that Atlas sees, add them to the `exclude` list
