# Database Foundation (v1) quick reference

I kept this folder to two files on purpose:

- `README.md`: quick operational setup notes.
- `deployment-leftover.md`: final remote deployment work still pending.

## DB setup in practice

Local stack is expected in `apps/palace/supabase/`.

Use this sequence for local work:

1. `supabase start`
2. `bun run db:generate`
3. `bun run db:reset`
4. run or refresh local checks.

Runtime DB code lives in `apps/palace/src/server/db`:

- `schema/` and `queries/` for typed Drizzle usage
- `client.ts` for a single shared DB connection source
- `db:types` and generated SQL types in `src/server/db/supabase.types.ts`

Supabase clients are split by privilege:

- `src/server/supabase/server.ts` for user context (anon key, RLS respected)
- `src/server/supabase/admin.ts` for service-role work (server-only only)

Migration source of truth for non-ORM SQL objects:

- `apps/palace/supabase/migrations/` for extensions, function/trigger SQL, seeds, and generated migrations.

Important security rule:

- service role keys must never be used in browser/client code.

Vector/security notes:

- `vector` extension and any RLS-sensitive tables should be explicit in migration SQL in the same migration flow.
- keep policy intent small and close to table purpose, then validate with a focused test path.

If this folder grows again, prefer adding notes under this file rather than restoring the old numbered docs.
