# Palace Appendix

Living notes for how this app is structured and why certain template pieces were kept or removed.

## Decision Log

- 2026-02-15: Reduced app to a single route (`/`) while preserving query integration and form hook scaffolding.
- 2026-02-15: Removed template demo surfaces (db chat, table, store, query demo pages, form demo pages).

## Baseline

- Router: TanStack file-based routing, intentionally reduced to only `src/routes/index.tsx`.
- Query integration: Keep `src/integrations/tanstack-query/root-provider.tsx` and `src/integrations/tanstack-query/devtools.tsx`.
- Root shell: Minimal `src/routes/__root.tsx` with `ThemeProvider`, children, `Scripts`, and TanStack devtools plugins.
- Form setup pattern retained:
  - `src/hooks/form-context.ts` for shared form/field contexts
  - `src/hooks/form.ts` for app-level `useAppForm` hook scaffold

## Dependency Snapshot (After Cleanup)

### Currently used in app source

- `@tanstack/react-router`
- `@tanstack/react-router-ssr-query`
- `@tanstack/react-query`
- `@tanstack/react-query-devtools`
- `@tanstack/react-devtools`
- `@tanstack/react-form`
- `@repo/shadcn-ui`

### Intentionally carried for later (not currently used in source files)

- `@tanstack/react-db`
- `@tanstack/query-db-collection`
- `@tanstack/react-store`
- `@tanstack/store`
- `@tanstack/react-table`
- `@tanstack/match-sorter-utils`
- `zod`
- `@faker-js/faker`

### Cleanup policy

- Keep all dependencies for now (explicit product decision).
- Revisit package pruning only after first real feature scaffolds are in place.

## Why This Cleanup

- We want a near-empty starting point without losing useful integration patterns.
- Template demos were helpful for learning but are not part of current product scope.
- Keeping integration scaffolding now avoids rediscovering setup details later.

## Concepts Preserved

### TanStack Query + Router SSR integration

- `src/router.tsx` creates a `queryClient` through the integration context.
- `setupRouterSsrQueryIntegration` wires query hydration/dehydration through router lifecycle.
- This preserves the query architecture even after demo route removal.

### Form hook composition pattern

- `createFormHookContexts` centralizes typed contexts for field/form components.
- `createFormHook` gives us one app-level hook entrypoint (`useAppForm`) so future form UI components plug in consistently.
- Field/form UI components are intentionally deferred.

## Template Recipes To Reuse Later

### Recipe: API route colocated with feature route

- Pattern: put server handlers in a route file under `src/routes/...`.
- Benefit: keeps API behavior close to UI feature context and fully typed by the route system.
- Notes:
  - Use `createFileRoute("...")` with `server.handlers`.
  - Start with `GET` + `POST` only; add auth/validation as needed.

### Recipe: React Query for route data + mutation

- Pattern: `useQuery` for read path and `useMutation` for write path.
- Benefit: clear separation between fetch and write concerns, easy refetch/invalidation strategy.
- Notes:
  - Keep stable `queryKey` naming from day one.
  - Prefer invalidation over direct refetch once multiple views share the same key.

### Recipe: Form architecture without UI lock-in

- Pattern: keep `useAppForm` + shared contexts in hooks, register UI field components later.
- Benefit: form state/validation architecture is decoupled from component library decisions.
- Notes:
  - Keep this stable in `src/hooks/form.ts` and `src/hooks/form-context.ts`.
  - Add field/form components only when a real form screen is introduced.

### Recipe: Collection-style local realtime state (from template chat concept)

- Pattern: collection with schema + key extractor, then stream inserts into the collection.
- Benefit: normalized client data flow and reactive querying for chat/feed-like features.
- Notes:
  - Use when you need event streams or websocket-like updates.
  - Keep this optional; do not introduce until a product feature needs it.

### Recipe: Derived local store state

- Pattern: base store + derived selector/computed state.
- Benefit: deterministic computed values and fewer repeated transformations in UI.
- Notes:
  - Best for lightweight local app state.
  - Skip if query cache alone can own the state.

### Recipe: Advanced table filtering/sorting

- Pattern: custom filter/sort functions with debounced global filter input.
- Benefit: powerful client-side exploration for data-heavy screens.
- Notes:
  - Introduce only if product needs large interactive tables.
  - Avoid pulling this in for simple list/detail screens.

## Removed Template Areas (Current Pass)

- Demo routes under `src/routes/demo/*`.
- Demo components, data, and stores (chat/table/store examples and helpers).
- Demo navigation header that was tightly coupled to those routes.

## Next Decisions To Capture

- Naming conventions for feature folders and route files.
- Preferred baseline layout components and app shell structure.
- First real feature implementation and which integration patterns it should use.
