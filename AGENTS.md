# AGENTS.md

## Cursor Cloud specific instructions

### Overview

Palace is a Turborepo monorepo with one app (`apps/palace`) and two internal packages (`packages/shadcn-ui`, `packages/typescript-config`). It's a TanStack Start + Vite + React 19 full-stack app backed by Supabase (Postgres, Auth) with Drizzle ORM.

### Prerequisites

- **Bun 1.3.8** — package manager and runtime (`packageManager` field in root `package.json`)
- **Docker** — required for `supabase start`
- **Supabase CLI** — installed globally via `bun add -g supabase`

### Starting the dev environment

1. **Start Docker daemon** (if not already running): `sudo dockerd &`
2. **Start Supabase**: `cd apps/palace && supabase start` (pulls/starts ~10 containers; first run takes minutes, subsequent runs are fast)
3. **Create `apps/palace/.env.local`** from `supabase status --output json` — see `apps/palace/.env.example` for the template. The four required env vars are `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `DATABASE_URL`.
4. **Start the dev server**: `cd apps/palace && bun run dev` (Vite on port 3000)

### Nitro alias gotcha

The project uses `"nitro": "npm:nitro-nightly@latest"` in `apps/palace/package.json`. Bun creates a symlink at `apps/palace/node_modules/nitro` -> `nitro-nightly`, but tools that run under Node.js (Vite, Vitest) fail because `nitro-nightly` internally imports from `nitro` and Node can't resolve the alias from the real path. Fix: create a symlink inside the bun cache:

```sh
NITRO_DIR=$(readlink -f /workspace/apps/palace/node_modules/nitro/..)
ln -sf nitro-nightly "$NITRO_DIR/nitro" 2>/dev/null
```

This must be re-run after `bun install` if the cache directory changes.

### Common commands

| Task | Command | Notes |
|------|---------|-------|
| Install deps | `bun install` (root) | Uses bun workspaces |
| Dev server | `bun run dev` (`apps/palace`) | Vite on port 3000 |
| Lint | `bun run lint` (root) | `oxlint` |
| Format check | `bun run format` (root) | `oxfmt --check` |
| Format fix | `bun run format:fix` (root) | `oxfmt .` |
| Type check | `bun run check-types` (root) | Turborepo-orchestrated `tsc` |
| Tests | `bun run test` (`apps/palace`) | Vitest (no test files yet) |
| DB migrations | `bun run db:migrate` (`apps/palace`) | Drizzle Kit + `.env.local` |
| Supabase start | `bun run db:local:start` (`apps/palace`) | Needs Docker |
| Supabase stop | `bun run db:local:stop` (`apps/palace`) | |

### Auth testing (local)

Supabase local has email confirmations **disabled** by default (`enable_confirmations = false` in `supabase/config.toml`), so sign-up works immediately without email verification. Mailpit (Inbucket) UI is at `http://localhost:54324` for inspecting auth emails if needed.

### DB migration note

`supabase start` automatically applies all SQL files in `supabase/migrations/`. Running `bun run db:migrate` (Drizzle Kit) after that will fail with "relation already exists" because the tables are already created. Only use `db:migrate` against a database that hasn't had the Supabase migrations applied.

### Type checking note

The turbo `check-types` task runs 0 tasks because no package defines a `check-types` script. Run `npx tsc --noEmit` directly in `apps/palace` for TypeScript checking.

### Docker-in-Docker (Cloud VM)

The Cloud VM runs inside a container. Docker requires `fuse-overlayfs` storage driver and `iptables-legacy`. These are pre-configured in the VM snapshot. If Docker fails to start, verify `/etc/docker/daemon.json` has `{"storage-driver": "fuse-overlayfs"}` and iptables is set to legacy mode.

### AI chat feature

The `/` route has an AI chat interface using Vercel AI SDK streaming to `anthropic/claude-sonnet-4.6`. This requires an AI provider API key (not set up locally by default). The rest of the app works without it.
