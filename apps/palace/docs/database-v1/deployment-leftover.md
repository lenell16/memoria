# Database v1 — deployment work still left

Everything else is already implemented locally. Remaining work is remote deployment to hosted Supabase.

## One-time remote connect

1. Run from `apps/palace`.
2. `supabase login` (if needed).
3. `supabase link --project-ref <project-ref>` with the target project.
4. Verify `supabase status` points at the right remote project before deploying.

## Deploy sequence (first time + repeats)

1. Confirm local branch has a clean migration set in `supabase/migrations`.
2. Validate deploy commands in a non-production environment first.
3. Run `supabase db push` to apply migrations.
4. Run app-level smoke checks that cover schema, auth paths, and any RLS-critical query.

## Remote decision point

- Use `supabase db push` for hosted deploy by default (mirrors local migration folder exactly).
- Use `bun run db:migrate` against a remote `DATABASE_URL` only when you explicitly need incremental migration mode and the target db is prepared for it.

## Post-deploy checklist

1. Confirm required extensions exist (`vector` if your branch uses it).
2. Confirm policy behavior in a user-scoped query.
3. Confirm service-role operations still happen only through server-only paths.
4. Confirm `DRIZZLE` generated artifacts and migration list are unchanged after deploy prep scripts.

## Blockers to clear before marking complete

1. Create exact command block for staging vs production environments.
2. Write the rollback plan for a bad migration push.
3. Record any environment-specific secrets/permissions required by CI.
