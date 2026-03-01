---
name: Phase 4 Connector Engine
overview: "Automate ingestion: Elo expression language integration, configurable connector engine with pagination strategies, WDK durable workflows for source runs, and three automated source types — RSS, API (YouTube), and scrape. Secrets via Supabase Vault."
todos:
  - id: install-elo
    content: Install @enspirit/elo and fast-xml-parser as dependencies
    status: pending
  - id: elo-helpers
    content: Create src/lib/connector/elo.ts — compile, eval, cache, SQL compilation helpers
    status: pending
  - id: context-builder
    content: Create src/lib/connector/context.ts — builds Elo context (_) per pipeline stage
    status: pending
  - id: pagination-engine
    content: Create src/lib/connector/pagination.ts — cursor, offset, page, link-header, none strategies
    status: pending
  - id: connector-engine
    content: Create src/lib/connector/engine.ts — generic fetch→extract→filter→transform→store executor
    status: pending
  - id: rss-parser
    content: Create src/lib/connector/parsers/rss.ts — RSS/Atom XML parsing with fast-xml-parser
    status: pending
  - id: wdk-run-source
    content: Create src/workflows/run-source.ts — WDK durable workflow wrapping the connector engine
    status: pending
  - id: wdk-import-upload
    content: Create src/workflows/import-upload.ts — WDK workflow for file upload processing (upgrade Phase 2)
    status: pending
  - id: secrets-vault
    content: Create src/lib/connector/secrets.ts — Supabase Vault integration for per-source secrets
    status: pending
  - id: api-run-source
    content: Create POST /api/sources/$sourceId/run — manually trigger a source run
    status: pending
  - id: api-source-runs
    content: Create GET /api/sources/$sourceId/runs — list run history for a source
    status: pending
  - id: source-rss
    content: Implement RSS source type end-to-end: config shape, XML parse, Elo pipeline, schedule
    status: pending
  - id: source-api
    content: Implement API source type end-to-end: YouTube Data API as reference, cursor pagination
    status: pending
  - id: source-scrape
    content: Implement scrape source type: HTML fetch + CSS selector extraction
    status: pending
  - id: source-config-ui
    content: Update /sources/new with type-specific config forms (RSS URL, API endpoint+auth, scrape URL+selectors)
    status: pending
  - id: run-history-ui
    content: Update /sources/$sourceId with run history table (status, items created, duration, errors)
    status: pending
  - id: verify
    content: Type-check, lint, test connector engine with mock HTTP responses
    status: pending
isProject: false
---

# Phase 4: Connector Engine — Automate Ingestion

**Prerequisite:** Phase 3 complete (feeds work, routing works, items can be browsed and managed).

**Goal:** Sources can automatically fetch data from external services. RSS feeds poll on schedule, APIs paginate through results, scrapes extract data from pages. Everything runs as durable WDK workflows with retry and checkpoint support. Elo handles all pure data transformation.

Full design context: [SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md) — Connector Engine section.
Elo exploration: [EXPLORATION_ELO_WORKFLOWS.md](docs/EXPLORATION_ELO_WORKFLOWS.md) — Level 2 (pipeline expressions) is our target.

---

## Architecture

```
                    ┌─────────────────────────────────────┐
                    │           WDK Workflow               │
                    │    (durable, retries, checkpoints)   │
                    │                                      │
Trigger ──────────► │  1. Load source config + secrets     │
(cron/manual/API)   │  2. Create source_run                │
                    │  3. LOOP:                            │
                    │     a. Fetch page     ◄── "use step" │
                    │     b. Store payload  ◄── "use step" │
                    │     c. Elo pipeline (pure)           │
                    │     d. Store items    ◄── "use step" │
                    │     e. Route to feeds ◄── "use step" │
                    │     f. Check pagination → continue?  │
                    │  4. Update run state  ◄── "use step" │
                    │  5. Finalize run      ◄── "use step" │
                    └─────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │        Connector Engine        │
                    │  (TypeScript — side effects)   │
                    │  • HTTP fetch                  │
                    │  • Pagination loop             │
                    │  • DB writes                   │
                    │  • Feed routing                │
                    └───────────────┬───────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │        Elo Expressions         │
                    │  (pure — no side effects)      │
                    │  • Extract items from response  │
                    │  • Filter items                 │
                    │  • Transform/normalize items    │
                    │  • Update run state             │
                    └───────────────────────────────┘
```

**Key principle: "Elo is the brain, WDK is the body."**
- Pure data logic → Elo
- Side effects (HTTP, DB, storage) → TypeScript + WDK
- The boundary is always side effects

---

## Steps

### 1. Install Dependencies

```bash
cd apps/palace
bun add @enspirit/elo fast-xml-parser
```

- `@enspirit/elo` — expression language (compile to JS + SQL)
- `fast-xml-parser` — RSS/Atom XML parsing

### 2. Elo Helpers — `src/lib/connector/elo.ts`

Core utilities for compiling and evaluating Elo expressions.

```typescript
import { compile, compileToSQL } from "@enspirit/elo";

const jsCache = new Map<string, (input: unknown) => unknown>();
const sqlCache = new Map<string, string>();

export function evalElo(expression: string, context: Record<string, unknown>): unknown {
  let fn = jsCache.get(expression);
  if (!fn) {
    fn = compile(expression);
    jsCache.set(expression, fn);
  }
  return fn(context);
}

export function eloToSQL(expression: string): string {
  let sql = sqlCache.get(expression);
  if (!sql) {
    sql = compileToSQL(expression);
    sqlCache.set(expression, sql);
  }
  return sql;
}

export function validateEloExpression(expression: string): { valid: boolean; error?: string } {
  try {
    compile(expression);
    return { valid: true };
  } catch (e) {
    return { valid: false, error: (e as Error).message };
  }
}

export function clearCache() {
  jsCache.clear();
  sqlCache.clear();
}
```

**Notes:**
- Compile once, cache forever. Elo compiles to plain JS functions — execution is native speed.
- `eloToSQL` is for feed filters (Phase 5 enhancement). It compiles Elo expressions to SQL WHERE clauses for database-level filtering.
- `validateEloExpression` is for UI validation when users write custom expressions.
- The actual `@enspirit/elo` API may differ — verify imports and function signatures when implementing.

### 3. Context Builder — `src/lib/connector/context.ts`

Builds the `_` context object for Elo expressions at each pipeline stage.

```typescript
export interface SourceConfig {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  pipeline: string | null;
  runState: Record<string, unknown>;
}

export interface RunInfo {
  id: string;
  startedAt: Date;
  pageNumber: number;
  itemsSoFar: number;
}

export interface HttpResponse {
  body: unknown;
  headers: Record<string, string>;
  statusCode: number;
}

export interface ConnectorContext {
  source: SourceConfig;
  state: Record<string, unknown>;
  run: RunInfo;
  secrets: Record<string, string>;
  env: Record<string, unknown>;
  response?: HttpResponse;
  item?: Record<string, unknown>;
  items?: Record<string, unknown>[];
  prev?: HttpResponse;
}

export function buildFetchContext(ctx: ConnectorContext): Record<string, unknown> {
  return {
    source: ctx.source,
    state: ctx.state,
    run: ctx.run,
    secrets: ctx.secrets,
    env: ctx.env,
  };
}

export function buildExtractionContext(ctx: ConnectorContext, response: HttpResponse): Record<string, unknown> {
  return {
    source: ctx.source,
    state: ctx.state,
    run: ctx.run,
    response: response.body,
  };
}

export function buildItemContext(ctx: ConnectorContext, item: Record<string, unknown>): Record<string, unknown> {
  return {
    source: ctx.source,
    state: ctx.state,
    run: ctx.run,
    item,
    env: ctx.env,
  };
}

export function buildPostPageContext(
  ctx: ConnectorContext,
  response: HttpResponse,
  items: Record<string, unknown>[]
): Record<string, unknown> {
  return {
    source: ctx.source,
    state: ctx.state,
    run: ctx.run,
    response: response.body,
    items,
  };
}
```

### 4. Pagination Engine — `src/lib/connector/pagination.ts`

Pluggable pagination strategies. Each takes a source config's pagination section and manages cursor/offset state.

```typescript
import { evalElo } from "./elo";

export type PaginationConfig =
  | { type: "none" }
  | { type: "cursor"; cursor_path: string; cursor_param: string; done_when: string; max_pages?: number }
  | { type: "offset"; offset_param: string; limit_param: string; limit: number; done_when: string; max_pages?: number }
  | { type: "page"; page_param: string; done_when: string; max_pages?: number }
  | { type: "link_header"; done_when: string; max_pages?: number };

export interface PaginationState {
  done: boolean;
  nextParams: Record<string, string | number>;
  pageNumber: number;
}

export function initPagination(config: PaginationConfig): PaginationState;

export function advancePagination(
  config: PaginationConfig,
  state: PaginationState,
  context: Record<string, unknown>
): PaginationState;
```

**Strategy implementations:**

- **none**: `done = true` after first page. No next params.
- **cursor**: Evaluate `cursor_path` Elo expression against response to get next cursor. Set `cursor_param` in next request. Evaluate `done_when` to check termination.
- **offset**: Increment offset by `limit` each page. Evaluate `done_when` (usually `items.length == 0` or `offset >= total`).
- **page**: Increment page number. Evaluate `done_when`.
- **link_header**: Parse HTTP `Link` header for `rel="next"` URL. Use full URL as next request. Evaluate `done_when` (usually `!headers.link.next`).

All strategies respect `max_pages` as a safety limit (default 100).

### 5. Connector Engine — `src/lib/connector/engine.ts`

The generic executor. Takes a source config and runs the full pipeline.

```typescript
import { evalElo } from "./elo";
import { buildFetchContext, buildItemContext, buildPostPageContext } from "./context";
import { initPagination, advancePagination } from "./pagination";

export interface ConnectorResult {
  pagesProcessed: number;
  itemsCreated: number;
  payloadIds: string[];
  errors: string[];
}

export async function executeConnector(
  source: SourceConfig,
  secrets: Record<string, string>,
  state: Record<string, unknown>,
  runInfo: RunInfo,
  callbacks: {
    fetchPage: (url: string, options: RequestInit) => Promise<HttpResponse>;
    storePayload: (sourceId: string, response: HttpResponse) => Promise<string>;
    storeItems: (sourceId: string, payloadId: string, items: Record<string, unknown>[]) => Promise<string[]>;
    routeToFeeds: (sourceId: string, itemIds: string[], userId: string) => Promise<void>;
  }
): Promise<ConnectorResult>;
```

**The engine does NOT directly perform I/O.** It receives callback functions for side effects. This lets WDK wrap each callback in a `"use step"` for durability, and lets tests provide mocks.

**Engine flow:**

```
1. Build fetch URL from source.config.fetch + state + pagination
2. Call callbacks.fetchPage (side effect → WDK step)
3. Call callbacks.storePayload (side effect → WDK step)
4. Run Elo pipeline:
   a. If source.pipeline exists: evalElo(pipeline, { response, state, source })
   b. Else: extract via config.extraction.items_path, filter via config.filter, transform via config.transform
5. Call callbacks.storeItems (side effect → WDK step)
6. Call callbacks.routeToFeeds (side effect → WDK step)
7. Advance pagination → if not done, goto 1
8. Evaluate run state update expressions
9. Return ConnectorResult
```

**URL construction:**

```typescript
function buildFetchUrl(
  fetchConfig: { url: string; params?: Record<string, string> },
  secrets: Record<string, string>,
  state: Record<string, unknown>,
  paginationParams: Record<string, string | number>
): string {
  let url = evalElo(fetchConfig.url, { secrets, state }) as string;
  const params = new URLSearchParams();
  // Static params from config
  for (const [key, expr] of Object.entries(fetchConfig.params ?? {})) {
    params.set(key, String(evalElo(expr, { secrets, state })));
  }
  // Pagination params override
  for (const [key, val] of Object.entries(paginationParams)) {
    params.set(key, String(val));
  }
  return `${url}?${params}`;
}
```

**Header construction (resolves secrets):**

```typescript
function buildHeaders(
  fetchConfig: { headers?: Record<string, string> },
  secrets: Record<string, string>,
  state: Record<string, unknown>
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, expr] of Object.entries(fetchConfig.headers ?? {})) {
    headers[key] = String(evalElo(expr, { secrets, state }));
  }
  return headers;
}
```

### 6. RSS Parser — `src/lib/connector/parsers/rss.ts`

```typescript
import { XMLParser } from "fast-xml-parser";

export interface RssEntry {
  title: string;
  url: string;
  description?: string;
  publishedAt?: string;
  author?: string;
  guid?: string;
  categories?: string[];
  enclosure?: { url: string; type: string; length?: number };
}

export function parseRssFeed(xml: string): RssEntry[];
export function parseAtomFeed(xml: string): RssEntry[];
export function parseRssOrAtom(xml: string): RssEntry[];  // auto-detect
```

**Implementation:**
- Use `fast-xml-parser` to parse XML
- Handle both RSS 2.0 (`<rss><channel><item>`) and Atom (`<feed><entry>`)
- Normalize to common `RssEntry` shape
- Handle: `<link>` vs `<link href="..."/>`, `<pubDate>` vs `<published>`, `<description>` vs `<summary>/<content>`
- The RSS parser is a utility — it's called by the connector engine when processing an RSS source type. It does NOT handle side effects.

### 7. WDK Workflow — `src/workflows/run-source.ts`

The durable workflow that wraps the connector engine.

```typescript
import { executeConnector } from "@/lib/connector/engine";
import { loadSecrets } from "@/lib/connector/secrets";
import { routeItemsToFeeds } from "@/lib/feeds/router";
import { createSourcePayload, createSourceItems, createSourceRun, finalizeSourceRun, getSourceById, updateSource } from "@/db/queries/sources";

export async function runSource(sourceId: string) {
  "use workflow";

  // Step 1: Load context
  const source = await loadSourceWithSecrets(sourceId);
  const run = await startRun(sourceId, source.runState);

  try {
    // Step 2: Execute connector
    const result = await executeConnector(
      source,
      source.secrets,
      source.runState ?? {},
      { id: run.id, startedAt: run.startedAt, pageNumber: 0, itemsSoFar: 0 },
      {
        fetchPage: async (url, options) => {
          "use step";
          const res = await fetch(url, options);
          return {
            body: await res.json(),
            headers: Object.fromEntries(res.headers),
            statusCode: res.status,
          };
        },
        storePayload: async (sourceId, response) => {
          "use step";
          const payload = await createSourcePayload({
            sourceId,
            data: response.body,
            format: "json",
          });
          return payload.id;
        },
        storeItems: async (sourceId, payloadId, items) => {
          "use step";
          const created = await createSourceItems(
            items.map(item => ({
              payloadId,
              sourceId,
              url: (item.url as string) ?? null,
              normalizedData: item,
              sourceType: source.type === "rss" ? "rss_entry" : "api_item",
            }))
          );
          return created.map(i => i.id);
        },
        routeToFeeds: async (sourceId, itemIds, userId) => {
          "use step";
          await routeItemsToFeeds(sourceId, itemIds, userId);
        },
      }
    );

    // Step 3: Finalize
    await finishRun(run.id, sourceId, result);
  } catch (error) {
    await failRun(run.id, sourceId, error);
    throw error;
  }
}

async function loadSourceWithSecrets(sourceId: string) {
  "use step";
  const source = await getSourceById(sourceId);
  if (!source) throw new Error(`Source not found: ${sourceId}`);
  const secrets = await loadSecrets(sourceId);
  return { ...source, secrets };
}

async function startRun(sourceId: string, currentState: unknown) {
  "use step";
  return createSourceRun({
    sourceId,
    stateBefore: currentState as Record<string, unknown>,
  });
}

async function finishRun(runId: string, sourceId: string, result: ConnectorResult) {
  "use step";
  await finalizeSourceRun(runId, {
    status: "completed",
    pagesFetched: result.pagesProcessed,
    itemsCreated: result.itemsCreated,
    stateAfter: result.newState,
  });
  await updateSource(sourceId, {
    lastFetchedAt: new Date(),
    runState: result.newState,
  });
}

async function failRun(runId: string, sourceId: string, error: unknown) {
  "use step";
  await finalizeSourceRun(runId, {
    status: "failed",
    error: error instanceof Error ? error.message : String(error),
  });
}
```

### 8. Secrets Manager — `src/lib/connector/secrets.ts`

Resolves secret names for a source from Supabase Vault.

```typescript
import { db } from "@/db/drizzle";
import { sourceSecrets } from "@/db/schema/sources";
import { eq, sql } from "drizzle-orm";

export async function loadSecrets(sourceId: string): Promise<Record<string, string>> {
  const mappings = await db.select().from(sourceSecrets)
    .where(eq(sourceSecrets.sourceId, sourceId));

  if (mappings.length === 0) return {};

  const secrets: Record<string, string> = {};
  for (const mapping of mappings) {
    const [result] = await db.execute(
      sql`SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = ${mapping.vaultSecretId}`
    );
    if (result?.decrypted_secret) {
      secrets[mapping.secretName] = result.decrypted_secret as string;
    }
  }
  return secrets;
}

export async function storeSecret(
  sourceId: string,
  secretName: string,
  secretValue: string,
  description?: string
): Promise<void> {
  const [vaultResult] = await db.execute(
    sql`SELECT vault.create_secret(${secretValue}, ${description ?? secretName}) as id`
  );
  const vaultSecretId = (vaultResult as { id: string }).id;

  await db.insert(sourceSecrets).values({
    sourceId,
    secretName,
    vaultSecretId,
  }).onConflictDoUpdate({
    target: [sourceSecrets.sourceId, sourceSecrets.secretName],
    set: { vaultSecretId, updatedAt: sql`now()` },
  });
}

export async function deleteSecret(sourceId: string, secretName: string): Promise<void> {
  const [mapping] = await db.select().from(sourceSecrets)
    .where(sql`${sourceSecrets.sourceId} = ${sourceId} AND ${sourceSecrets.secretName} = ${secretName}`);

  if (mapping) {
    await db.execute(sql`SELECT vault.delete_secret(${mapping.vaultSecretId})`);
    await db.delete(sourceSecrets)
      .where(sql`${sourceSecrets.sourceId} = ${sourceId} AND ${sourceSecrets.secretName} = ${secretName}`);
  }
}
```

**Security rules:**
- Decrypted secrets NEVER written to: run logs, state snapshots, payloads, error messages
- Held in memory only during the workflow execution
- RLS on `source_secrets` restricts access to the source owner

### 9. API Routes — Trigger & Monitor Runs

#### `src/routes/api/sources/$sourceId.run.ts`

```
POST /api/sources/:sourceId/run → manually trigger a source run
```

- Verify user owns the source
- Validate source has config (can't run an empty source)
- Enqueue the WDK workflow `runSource(sourceId)`
- Return `{ runId, status: "started" }`

#### `src/routes/api/sources/$sourceId.runs.ts`

```
GET /api/sources/:sourceId/runs → list run history
Query: limit (default 20)
```

Returns: `[{ id, status, pagesFetched, itemsCreated, error, startedAt, finishedAt, duration }]`

### 10. RSS Source Type — End-to-End

**Source config shape:**

```jsonc
{
  "fetch": {
    "url": "'https://example.com/feed.xml'",
    "method": "GET"
  },
  "pagination": { "type": "none" },
  "extraction": {
    "parser": "rss"
  }
}
```

**Pipeline (Elo):**

```elo
_.items |> map(entry ~ {
  title: entry.title | trim,
  url: entry.url,
  published_at: entry.publishedAt,
  description: entry.description,
  author: entry.author,
  guid: entry.guid
})
```

**Special handling:**
- The connector engine detects `extraction.parser: "rss"` and uses `parseRssOrAtom` instead of generic JSON extraction.
- RSS feeds don't paginate (single request per run).
- Run state carries `last_guid` or `last_published_at` to avoid re-importing items.
- Dedup: before creating source items, check if a source item with the same `url` already exists for this source.

**Schedule:** RSS sources default to `{ interval_ms: 900000 }` (15 minutes). Configurable per source.

### 11. API Source Type — YouTube as Reference

**Source config shape:**

```jsonc
{
  "fetch": {
    "url": "'https://www.googleapis.com/youtube/v3/playlistItems'",
    "method": "GET",
    "headers": {},
    "params": {
      "playlistId": "'UU...'",
      "part": "'snippet'",
      "maxResults": "50",
      "key": "_.secrets.youtube_api_key"
    }
  },
  "pagination": {
    "type": "cursor",
    "cursor_path": "_.response.nextPageToken",
    "cursor_param": "pageToken",
    "done_when": "_.response.nextPageToken == null",
    "max_pages": 10
  }
}
```

**Pipeline (Elo):**

```elo
_.response.items |> map(v ~ {
  title: v.snippet.title | trim,
  url: 'https://youtube.com/watch?v=' + v.snippet.resourceId.videoId,
  published_at: v.snippet.publishedAt,
  thumbnail: v.snippet.thumbnails.medium.url,
  description: v.snippet.description | slice(0, 500),
  channel: v.snippet.channelTitle
})
```

This demonstrates cursor-based pagination and secret resolution (`_.secrets.youtube_api_key`).

### 12. Scrape Source Type

**Source config shape:**

```jsonc
{
  "fetch": {
    "url": "'https://news.ycombinator.com'",
    "method": "GET"
  },
  "pagination": { "type": "none" },
  "extraction": {
    "parser": "scrape",
    "selector": ".athing",
    "fields": {
      "title": ".titleline > a",
      "url": ".titleline > a@href",
      "score": ".score",
      "rank": ".rank"
    }
  }
}
```

**Pipeline (Elo):**

```elo
_.items
  |> filter(item ~ item.url != null and item.title != null)
  |> map(item ~ {
    title: item.title | trim,
    url: item.url,
    score: Int(item.score),
    rank: Int(item.rank)
  })
```

**Scrape extraction:**
- The connector engine detects `extraction.parser: "scrape"` and performs CSS selector extraction.
- For Phase 4: use a lightweight approach — fetch HTML, use regex or a simple DOM parser to extract elements matching the selector and extract field values.
- For production scraping, consider adding `cheerio` or `linkedom` as a dependency.
- Scrape sources can be one-shot or scheduled.

### 13. Source Config UI Updates

Update `/sources/new` and source detail pages with type-specific config forms:

**RSS:** Just a URL field. "Paste an RSS feed URL and we'll handle the rest."

**API:** URL, method, headers (key-value pairs with secret references), params, pagination type dropdown with type-specific fields, pipeline expression editor (textarea with Elo syntax highlighting if possible).

**Scrape:** URL, CSS selector, fields (key-value where value is a CSS selector expression).

**All types:** Pipeline editor (optional — if empty, uses config.extraction + config.filter + config.transform). Schedule picker (interval dropdown or cron input). Secrets manager (add/remove API keys).

### 14. Run History UI

Update `/sources/$sourceId` to show run history:

```
── Run History ──
┌────────────────────────────────────────────────┐
│ ● Completed  5m ago  •  1 page  •  23 items    │
│ ● Completed  20m ago •  1 page  •  18 items    │
│ ✕ Failed     35m ago •  0 pages •  Rate limit   │
│ ● Completed  1h ago  •  3 pages •  142 items   │
└────────────────────────────────────────────────┘
```

Plus a "Run Now" button that calls `POST /api/sources/:sourceId/run`.

---

## Two Elo Dialects

Established convention from [EXPLORATION_ELO_WORKFLOWS.md](docs/EXPLORATION_ELO_WORKFLOWS.md):

| Usage | Elo subset | Target | Where used |
|-------|-----------|--------|------------|
| **Source pipeline** (ingestion-time) | Full Elo: lambdas, pipes, schemas, guards | JS only | `source.pipeline` column |
| **Feed filter** (query-time) | Simple expressions: comparisons, booleans, dates | JS + SQL | `feed.filter` column |

The connector engine always uses JS compilation. Feed filters use JS at routing time (Phase 3) and will be enhanced with SQL compilation in Phase 5 for database-level filtering.

---

## File Summary

| File | Type | Purpose |
|------|------|---------|
| `src/lib/connector/elo.ts` | NEW | Elo compile/eval/cache/SQL helpers |
| `src/lib/connector/context.ts` | NEW | Context builder for pipeline stages |
| `src/lib/connector/pagination.ts` | NEW | Pluggable pagination strategies |
| `src/lib/connector/engine.ts` | NEW | Generic connector executor |
| `src/lib/connector/parsers/rss.ts` | NEW | RSS/Atom XML parser |
| `src/lib/connector/secrets.ts` | NEW | Supabase Vault integration |
| `src/workflows/run-source.ts` | NEW | WDK durable workflow for source runs |
| `src/workflows/import-upload.ts` | NEW | WDK workflow for upload processing |
| `src/routes/api/sources/$sourceId.run.ts` | NEW | Manual trigger API |
| `src/routes/api/sources/$sourceId.runs.ts` | NEW | Run history API |
| `src/routes/_protected/sources/new.tsx` | EDIT | Type-specific config forms |
| `src/routes/_protected/sources/$sourceId.tsx` | EDIT | Run history + "Run Now" button |

---

## Testing Strategy

**Unit tests for pure logic:**
- Elo evaluation with mock contexts
- Pagination state machine (each strategy)
- RSS parser with sample XML
- Context builder output shape

**Integration tests for connector engine:**
- Mock HTTP responses, verify items created
- Test pagination loop with cursor/offset strategies
- Test error handling (HTTP errors, parse errors)

**WDK workflow tests:**
- WDK has its own test helpers for simulating workflow execution
- Test that steps checkpoint correctly
- Test crash recovery (interrupt mid-pagination, verify resume)

---

## Phase 4 Deliverables Checklist

- [ ] `@enspirit/elo` and `fast-xml-parser` installed
- [ ] Elo helpers: compile, eval, cache, validate, SQL compile
- [ ] Context builder creates correct `_` for each pipeline stage
- [ ] Pagination engine handles all 5 strategies
- [ ] Connector engine executes full fetch→extract→filter→transform→store pipeline
- [ ] RSS parser handles RSS 2.0 and Atom feeds
- [ ] WDK workflow wraps connector engine with durability
- [ ] Secrets load from Supabase Vault, never persisted in logs
- [ ] Manual run trigger API works
- [ ] Run history API returns paginated run list
- [ ] RSS source works end-to-end: create source → trigger run → items appear → routed to feeds
- [ ] API source works end-to-end: YouTube Data API with cursor pagination
- [ ] Scrape source works end-to-end: fetch HTML → extract items → store
- [ ] Source creation UI has type-specific config forms
- [ ] Source detail shows run history
- [ ] Dedup: same URL from same source doesn't create duplicate items
- [ ] `bun run check-types` passes
- [ ] `bun run lint` passes
- [ ] Unit tests for Elo eval, pagination, RSS parser
- [ ] Integration test for connector engine with mock HTTP
