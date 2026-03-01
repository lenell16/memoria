# Memoria — Implementation Plan

Concrete implementation details. How the design becomes code. Linked from [MEMORIA_SESSION.md](./MEMORIA_SESSION.md), built on [SYSTEM_DESIGN.md](./SYSTEM_DESIGN.md).

---

## Codebase Layout

Where new code lives inside `apps/palace/src/`:

```
src/
├── db/
│   ├── drizzle.ts                    # existing — DB connection
│   ├── schema/
│   │   ├── profiles.ts               # existing
│   │   ├── embeddings.ts             # existing
│   │   ├── sources.ts                # NEW — source, source_payload, source_item, source_run, source_secret
│   │   └── feeds.ts                  # NEW — feed, feed_item
│   └── queries/
│       ├── profiles.ts               # existing
│       ├── embeddings.ts             # existing
│       ├── sources.ts                # NEW — CRUD for sources, payloads, items, runs
│       └── feeds.ts                  # NEW — CRUD for feeds, feed items, filtered queries
├── lib/
│   ├── connector/
│   │   ├── engine.ts                 # NEW — generic connector executor
│   │   ├── context.ts                # NEW — builds Elo context (_) per pipeline stage
│   │   ├── elo.ts                    # NEW — Elo compile/eval helpers, caching
│   │   ├── pagination.ts             # NEW — pagination strategy implementations
│   │   └── parsers/
│   │       ├── rss.ts                # NEW — XML→JSON for RSS/Atom
│   │       ├── csv.ts                # NEW — CSV→JSON
│   │       ├── bookmarks.ts          # NEW — Chrome HTML, OneTab, SensorBuddy formats
│   │       └── opml.ts               # NEW — OPML import (RSS subscription lists)
│   ├── storage/
│   │   └── payload-store.ts          # NEW — inline vs S3 storage abstraction
│   └── supabase/                     # existing auth/client code
├── workflows/
│   ├── test-workflow.ts              # existing
│   ├── run-source.ts                 # NEW — WDK workflow: full source execution
│   ├── import-upload.ts              # NEW — WDK workflow: file upload processing
│   └── schedule-sources.ts           # NEW — WDK workflow: periodic polling orchestrator
├── routes/
│   ├── __root.tsx                    # existing
│   ├── index.tsx                     # existing (AI chat)
│   ├── _protected.tsx                # existing (auth layout)
│   ├── _protected/
│   │   ├── protected.tsx             # existing
│   │   ├── sources/
│   │   │   ├── index.tsx             # NEW — sources list/manager
│   │   │   ├── $sourceId.tsx         # NEW — source detail/edit
│   │   │   └── new.tsx               # NEW — create source wizard
│   │   ├── feeds/
│   │   │   ├── index.tsx             # NEW — feeds list
│   │   │   ├── $feedId.tsx           # NEW — feed view (item list, mark done, filter)
│   │   │   └── new.tsx               # NEW — feed builder
│   │   ├── inbox.tsx                 # NEW — unassigned items
│   │   ├── import.tsx                # NEW — upload/import UI
│   │   └── search.tsx                # NEW — full-text search across items
│   └── api/
│       ├── chat.ts                   # existing
│       ├── sources/
│       │   ├── index.ts              # NEW — sources CRUD API
│       │   ├── $sourceId.run.ts      # NEW — trigger a source run
│       │   └── $sourceId.runs.ts     # NEW — list runs for a source
│       ├── feeds/
│       │   └── index.ts              # NEW — feeds CRUD API
│       ├── import.ts                 # NEW — file upload endpoint
│       └── extension.ts              # NEW — browser extension push endpoint
```

---

## Drizzle Schema — Concrete Tables

### `src/db/schema/sources.ts`

```typescript
import { sql } from "drizzle-orm";
import {
  pgTable, uuid, text, timestamp, jsonb, integer, boolean, pgPolicy,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUid } from "drizzle-orm/supabase/rls";
import { profiles } from "./profiles";

// Configured input: an RSS feed, API endpoint, scrape target, etc.
export const sources = pgTable("sources", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => profiles.id),
  name: text("name").notNull(),
  type: text("type").notNull(),       // rss | api | scrape | upload | extension | bookmark_import | manual
  config: jsonb("config").notNull().default({}),
  pipeline: text("pipeline"),          // Elo pipeline expression (extract+filter+transform)
  schedule: jsonb("schedule"),         // { interval_ms: 300000 } or { cron: "*/5 * * * *" } or null
  runState: jsonb("run_state").default({}),
  isActive: boolean("is_active").notNull().default(true),
  lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  pgPolicy("sources_select_own", {
    for: "select", to: authenticatedRole,
    using: sql`(select ${authUid}) = ${table.userId}`,
  }),
  pgPolicy("sources_insert_own", {
    for: "insert", to: authenticatedRole,
    withCheck: sql`(select ${authUid}) = ${table.userId}`,
  }),
  pgPolicy("sources_update_own", {
    for: "update", to: authenticatedRole,
    using: sql`(select ${authUid}) = ${table.userId}`,
  }),
  pgPolicy("sources_delete_own", {
    for: "delete", to: authenticatedRole,
    using: sql`(select ${authUid}) = ${table.userId}`,
  }),
]).enableRLS();

// Raw payload per ingestion event — never modified
export const sourcePayloads = pgTable("source_payloads", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceId: uuid("source_id").notNull().references(() => sources.id),
  data: jsonb("data"),                 // inline for small payloads
  storageKey: text("storage_key"),     // S3 key for large payloads
  storageBackend: text("storage_backend").notNull().default("inline"),
  format: text("format").notNull(),    // json | xml | csv | html | pdf | media
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  pgPolicy("payloads_select_own", {
    for: "select", to: authenticatedRole,
    using: sql`${table.sourceId} in (select id from sources where user_id = (select ${authUid}))`,
  }),
]).enableRLS();

// Individual normalized item from a payload
export const sourceItems = pgTable("source_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  payloadId: uuid("payload_id").notNull().references(() => sourcePayloads.id),
  sourceId: uuid("source_id").notNull().references(() => sources.id),
  canonicalId: uuid("canonical_id"),   // self-ref for future dedup
  url: text("url"),
  normalizedData: jsonb("normalized_data").notNull(),
  sourceType: text("source_type").notNull(), // rss_entry | bookmark | api_item | scraped_item
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  pgPolicy("items_select_own", {
    for: "select", to: authenticatedRole,
    using: sql`${table.sourceId} in (select id from sources where user_id = (select ${authUid}))`,
  }),
]).enableRLS();

// Audit log per source execution
export const sourceRuns = pgTable("source_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceId: uuid("source_id").notNull().references(() => sources.id),
  status: text("status").notNull().default("running"), // running | completed | failed | partial
  pagesFetched: integer("pages_fetched").default(0),
  itemsCreated: integer("items_created").default(0),
  error: text("error"),
  stateBefore: jsonb("state_before"),
  stateAfter: jsonb("state_after"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

// Maps secret names to Supabase Vault secret IDs
export const sourceSecrets = pgTable("source_secrets", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceId: uuid("source_id").notNull().references(() => sources.id),
  secretName: text("secret_name").notNull(),
  vaultSecretId: uuid("vault_secret_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
```

### `src/db/schema/feeds.ts`

```typescript
import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, jsonb, pgPolicy } from "drizzle-orm/pg-core";
import { authenticatedRole, authUid } from "drizzle-orm/supabase/rls";
import { profiles } from "./profiles";
import { sourceItems } from "./sources";

// User-defined feed: curated view over sources
export const feeds = pgTable("feeds", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => profiles.id),
  name: text("name").notNull(),
  description: text("description"),
  config: jsonb("config").notNull().default({}), // which sources, filter rules (Elo), display prefs
  filter: text("filter"),                         // Elo expression (SQL-compilable subset)
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  pgPolicy("feeds_select_own", {
    for: "select", to: authenticatedRole,
    using: sql`(select ${authUid}) = ${table.userId}`,
  }),
  pgPolicy("feeds_insert_own", {
    for: "insert", to: authenticatedRole,
    withCheck: sql`(select ${authUid}) = ${table.userId}`,
  }),
  pgPolicy("feeds_update_own", {
    for: "update", to: authenticatedRole,
    using: sql`(select ${authUid}) = ${table.userId}`,
  }),
  pgPolicy("feeds_delete_own", {
    for: "delete", to: authenticatedRole,
    using: sql`(select ${authUid}) = ${table.userId}`,
  }),
]).enableRLS();

// App-level item in a feed
export const feedItems = pgTable("feed_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  feedId: uuid("feed_id").notNull().references(() => feeds.id),
  sourceItemId: uuid("source_item_id").notNull().references(() => sourceItems.id),
  status: text("status").notNull().default("unseen"), // unseen | seen | in_progress | done | archived
  userData: jsonb("user_data"),        // notes, tags, highlights, etc.
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  pgPolicy("feed_items_select_own", {
    for: "select", to: authenticatedRole,
    using: sql`${table.feedId} in (select id from feeds where user_id = (select ${authUid}))`,
  }),
  pgPolicy("feed_items_update_own", {
    for: "update", to: authenticatedRole,
    using: sql`${table.feedId} in (select id from feeds where user_id = (select ${authUid}))`,
  }),
]).enableRLS();
```

---

## Connector Engine — How It Runs

### `src/lib/connector/elo.ts` — Elo Helpers

```typescript
import { compile } from "@enspirit/elo";

const cache = new Map<string, (input: unknown) => unknown>();

export function evalElo(expression: string, context: Record<string, unknown>) {
  let fn = cache.get(expression);
  if (!fn) {
    fn = compile(expression);
    cache.set(expression, fn);
  }
  return fn(context);
}
```

### `src/lib/connector/context.ts` — Context Builder

```typescript
export interface ConnectorContext {
  source: SourceConfig;
  state: Record<string, unknown>;
  run: RunInfo;
  secrets: Record<string, string>;
  env: Record<string, unknown>;
  response?: HttpResponse;
  item?: Record<string, unknown>;
  items?: Record<string, unknown>[];
}

export function buildFetchContext(ctx: ConnectorContext) {
  return { source: ctx.source, state: ctx.state, run: ctx.run, secrets: ctx.secrets, env: ctx.env };
}

export function buildItemContext(ctx: ConnectorContext, item: Record<string, unknown>) {
  return { ...ctx, item };
}

export function buildPostPageContext(ctx: ConnectorContext, response: HttpResponse, items: Record<string, unknown>[]) {
  return { ...ctx, response, items };
}
```

### `src/workflows/run-source.ts` — WDK Workflow

```typescript
import { evalElo } from "@/lib/connector/elo";
import { buildFetchContext, buildItemContext, buildPostPageContext } from "@/lib/connector/context";

export async function runSource(sourceId: string) {
  "use workflow";

  const { source, secrets, state } = await loadSourceContext(sourceId);
  const run = await createRun(sourceId, state);

  let cursor: unknown = state?.last_cursor ?? null;
  let totalItems = 0;
  let page = 0;

  while (true) {
    const response = await fetchPage(source, secrets, state, cursor);
    const payload = await storePayload(source, response);

    let items: Record<string, unknown>[];
    if (source.pipeline) {
      items = evalElo(source.pipeline, { response: response.body, state, source: source.config }) as Record<string, unknown>[];
    } else {
      items = extractFilterTransform(source, response);
    }

    const created = await storeSourceItems(source, payload.id, items);
    totalItems += created;
    await routeToFeeds(source, items);

    page++;
    const pageCtx = buildPostPageContext({ source: source.config, state, run, secrets, env: {} }, response, items);
    cursor = evalElo(source.config.pagination.cursor_path, pageCtx);

    if (evalElo(source.config.pagination.done_when, pageCtx)) break;
    if (page >= (source.config.pagination.max_pages ?? 100)) break;
  }

  await finalizeRun(run.id, sourceId, state, { pagesFetched: page, itemsCreated: totalItems });
}

async function loadSourceContext(sourceId: string) {
  "use step";
  // Load source row, resolve secrets from Vault, snapshot run_state
}

async function createRun(sourceId: string, state: unknown) {
  "use step";
  // Insert source_run row with status='running', state_before=state
}

async function fetchPage(source: unknown, secrets: unknown, state: unknown, cursor: unknown) {
  "use step";
  // Build URL from config + state + cursor, make HTTP request
}

async function storePayload(source: unknown, response: unknown) {
  "use step";
  // Insert source_payload (inline or S3 based on size)
}

async function storeSourceItems(source: unknown, payloadId: string, items: unknown[]) {
  "use step";
  // Batch insert source_items, return count
}

async function routeToFeeds(source: unknown, items: unknown[]) {
  "use step";
  // Find feeds that include this source, apply feed filters, create feed_items
}

async function finalizeRun(runId: string, sourceId: string, state: unknown, stats: unknown) {
  "use step";
  // Update source_run (status, stats, state_after), update source.run_state
}
```

---

## Ingestion: How Each Data Type Gets In

### RSS Feed

```
User creates source:
  type: "rss"
  config: { url: "https://example.com/feed.xml" }
  pipeline: "_.response |> parseRss |> map(entry ~ { title: entry.title, url: entry.link, published_at: entry.pubDate })"
  schedule: { interval_ms: 900000 }   // 15 min

Workflow (WDK):
  1. fetchPage → GET the XML
  2. storePayload → raw XML as text column
  3. pipeline eval → Elo parses + maps entries
  4. storeSourceItems → one row per entry
  5. routeToFeeds → match against feed configs
```

### Chrome Bookmarks Import

```
User goes to /import, uploads bookmarks.html:
  1. API route receives multipart upload
  2. Store raw file as source_payload (S3 if large)
  3. Create source: type="bookmark_import", name="Chrome Feb 2026"
  4. Parser: bookmarks.ts extracts <A HREF="..."> with folder hierarchy
  5. Elo pipeline: normalize each bookmark to { title, url, folder, added_at }
  6. Create source_items
  7. User assigns to feeds (or goes to inbox)
```

### Browser Extension Push

```
Extension sends POST /api/extension:
  body: { tabs: [{ url, title, favIconUrl }], session: "work-research", timestamp }

API route:
  1. Store JSON as source_payload
  2. Find or create source: type="extension"
  3. Each tab → source_item
  4. Route to extension feed + any matching user feeds
```

### Manual Link Add

```
User pastes URL in UI quick-add bar:
  1. POST /api/sources with { type: "manual", url: "https://..." }
  2. Create minimal source_payload (just the URL)
  3. Create source_item with url + title (fetched via HEAD or og:title)
  4. Add to specified feed or inbox
```

### API (e.g., YouTube Data API)

```
User creates source:
  type: "api"
  config: {
    fetch: { url: "https://www.googleapis.com/youtube/v3/playlistItems", params: { playlistId: "UU...", part: "snippet", maxResults: 50 } },
    pagination: { type: "cursor", cursor_path: ".response.nextPageToken", cursor_param: "pageToken", done_when: "_.response.nextPageToken == null" },
  }
  pipeline: "_.response.items |> map(v ~ { title: v.snippet.title, url: 'https://youtube.com/watch?v=' + v.snippet.resourceId.videoId, published_at: v.snippet.publishedAt, thumbnail: v.snippet.thumbnails.medium.url })"
  secrets: { api_key: <vault ref> }
  schedule: { interval_ms: 3600000 }  // 1 hour

Workflow follows standard runSource flow with pagination.
```

### Scrape

```
User creates source:
  type: "scrape"
  config: {
    fetch: { url: "https://news.ycombinator.com" },
    pagination: { type: "none" },
    scrape: { selector: ".athing", fields: { title: ".titleline > a", url: ".titleline > a@href", score: ".score" } }
  }
  pipeline: "_.items |> filter(item ~ Int(item.score) > 20) |> map(item ~ { title: item.title | trim, url: item.url, score: Int(item.score) })"
  schedule: { interval_ms: 1800000 }  // 30 min
```

---

## UI Architecture

### App Shell

The protected layout (`_protected.tsx`) gets a sidebar + main content area:

```
┌─────────────────────────────────────────────────┐
│  PALACE                              [user] [+]  │
├──────────┬──────────────────────────────────────┤
│          │                                       │
│ Inbox    │   [main content area]                 │
│ Search   │                                       │
│          │   Depends on route:                   │
│ ─── Feeds│   /feeds/:id → feed item list         │
│ Feed 1   │   /sources → sources manager          │
│ Feed 2   │   /import → upload UI                 │
│ Feed 3   │   /search → search results            │
│          │   /inbox → unassigned items            │
│ ── Sources│                                       │
│ Source 1 │                                       │
│ Source 2 │                                       │
│          │                                       │
│ Import   │                                       │
│ Settings │                                       │
└──────────┴──────────────────────────────────────┘
```

### Feed View (`/feeds/:feedId`)

The primary consumption surface. What a user looks at most.

```
┌──────────────────────────────────────────────────┐
│  Podcast Feed                    [filter] [sort]  │
├──────────────────────────────────────────────────┤
│ ○ Episode 142: The Future of...   3h ago    ▶    │
│   source: YouTube • 45:12                        │
│ ─────────────────────────────────────────────── │
│ ● Episode 141: Deep Dive on...   1d ago     ✓    │
│   source: RSS • read                             │
│ ─────────────────────────────────────────────── │
│ ○ New article: How to build...   2d ago          │
│   source: HN Scrape • score: 142                 │
│ ─────────────────────────────────────────────── │
│ ○ Bookmark: React Server...      3d ago          │
│   source: Chrome Import • folder: dev/react      │
└──────────────────────────────────────────────────┘

○ = unseen   ● = seen   ✓ = done
Click → item detail (metadata, notes, connections, original link)
Swipe/keyboard → mark seen/done
```

### Sources Manager (`/sources`)

```
┌──────────────────────────────────────────────────┐
│  Sources                              [+ Add]     │
├──────────────────────────────────────────────────┤
│ ● My YouTube Subs        API    every 1h   3m ago │
│   142 items • 23 runs • last: ok                  │
│ ─────────────────────────────────────────────── │
│ ● HN Front Page          Scrape every 30m  12m ago│
│   891 items • 187 runs • last: ok                 │
│ ─────────────────────────────────────────────── │
│ ○ Chrome Bookmarks Feb   Import  one-shot  Feb 15 │
│   2,341 items • 1 run                             │
│ ─────────────────────────────────────────────── │
│ ● Tech Twitter List      API    every 15m  2m ago │
│   5,012 items • 412 runs • last: ok               │
└──────────────────────────────────────────────────┘

● = active   ○ = inactive
Click → source detail (config, run history, items, edit)
```

### Import (`/import`)

```
┌──────────────────────────────────────────────────┐
│  Import Data                                      │
├──────────────────────────────────────────────────┤
│                                                   │
│  ┌─ Drop files here or click to upload ──────┐   │
│  │                                            │   │
│  │  Supports: JSON, CSV, OPML, HTML bookmarks │   │
│  │  PDF, media files                          │   │
│  └────────────────────────────────────────────┘   │
│                                                   │
│  ── Or paste data ──                              │
│  ┌────────────────────────────────────────────┐   │
│  │ Paste JSON, CSV, or links (one per line)   │   │
│  └────────────────────────────────────────────┘   │
│                                                   │
│  [Import]                                         │
│                                                   │
│  ── Recent imports ──                             │
│  bookmarks.html  •  2,341 items  •  Feb 15        │
│  onetab-export.json  •  89 items  •  Feb 10       │
└──────────────────────────────────────────────────┘
```

---

## Build Order — What to Build First

### Phase 1: Foundation (schema + basic CRUD) — DETAILED SPEC

**Goal:** All tables exist in the database with RLS. Query functions cover basic CRUD. `drizzle.ts` exports the full schema. No UI yet — just the data layer.

#### Step 1: Create schema files

Create two new files:
- `src/db/schema/sources.ts` — tables: `sources`, `sourcePayloads`, `sourceItems`, `sourceRuns`, `sourceSecrets`
- `src/db/schema/feeds.ts` — tables: `feeds`, `feedItems`

Use the exact Drizzle schema code from the "Drizzle Schema — Concrete Tables" section above. All seven tables get created in Phase 1, even though `sourceRuns` and `sourceSecrets` won't be used until Phase 4. Reason: fewer migration headaches later, and the schema is complete from the start.

#### Step 2: Update `src/db/drizzle.ts`

Add the new schemas to the drizzle instance:

```typescript
import * as embeddings from "@/db/schema/embeddings";
import * as profiles from "@/db/schema/profiles";
import * as sources from "@/db/schema/sources";
import * as feeds from "@/db/schema/feeds";
import { env } from "@/lib/env";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const connection = postgres(env.DATABASE_URL);

export const db = drizzle(connection, {
  schema: { ...profiles, ...embeddings, ...sources, ...feeds },
});
```

#### Step 3: Generate and apply migration

```bash
cd apps/palace
bun run db:generate    # creates migration SQL in supabase/migrations/
bun run db:migrate     # applies to local Supabase Postgres
```

Verify: `bun run db:studio` and confirm all seven tables appear with correct columns.

#### Step 4: Create `src/db/queries/sources.ts`

Match the existing query style in `queries/profiles.ts` — import db, import schema, export async functions, use `.returning()`.

**Required functions:**

```typescript
import { db } from "@/db/drizzle";
import { sources, sourcePayloads, sourceItems, sourceRuns } from "@/db/schema/sources";
import { eq, desc, and } from "drizzle-orm";

// ── Sources ──

export async function listSourcesByUser(userId: string) {
  return db.select().from(sources)
    .where(eq(sources.userId, userId))
    .orderBy(desc(sources.updatedAt));
}

export async function getSourceById(id: string) {
  const rows = await db.select().from(sources).where(eq(sources.id, id));
  return rows[0] ?? null;
}

export type CreateSourceInput = {
  userId: string;
  name: string;
  type: string;
  config?: Record<string, unknown>;
  pipeline?: string;
  schedule?: Record<string, unknown>;
};

export async function createSource(data: CreateSourceInput) {
  const rows = await db.insert(sources).values(data).returning();
  return rows[0]!;
}

export type UpdateSourceInput = Partial<
  Pick<typeof sources.$inferInsert, "name" | "type" | "config" | "pipeline" | "schedule" | "isActive" | "runState" | "lastFetchedAt">
>;

export async function updateSource(id: string, data: UpdateSourceInput) {
  const rows = await db.update(sources)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(sources.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function deleteSource(id: string) {
  return db.delete(sources).where(eq(sources.id, id)).returning();
}

// ── Source Payloads ──

export type CreatePayloadInput = {
  sourceId: string;
  data?: unknown;
  storageKey?: string;
  storageBackend?: string;
  format: string;
  mimeType?: string;
  sizeBytes?: number;
};

export async function createSourcePayload(data: CreatePayloadInput) {
  const rows = await db.insert(sourcePayloads).values(data).returning();
  return rows[0]!;
}

export async function listPayloadsBySource(sourceId: string) {
  return db.select().from(sourcePayloads)
    .where(eq(sourcePayloads.sourceId, sourceId))
    .orderBy(desc(sourcePayloads.ingestedAt));
}

export async function getPayloadById(id: string) {
  const rows = await db.select().from(sourcePayloads).where(eq(sourcePayloads.id, id));
  return rows[0] ?? null;
}

// ── Source Items ──

export type CreateSourceItemInput = {
  payloadId: string;
  sourceId: string;
  url?: string;
  normalizedData: Record<string, unknown>;
  sourceType: string;
};

export async function createSourceItems(items: CreateSourceItemInput[]) {
  if (items.length === 0) return [];
  return db.insert(sourceItems).values(items).returning();
}

export async function listSourceItemsBySource(sourceId: string, options?: { limit?: number; offset?: number }) {
  const query = db.select().from(sourceItems)
    .where(eq(sourceItems.sourceId, sourceId))
    .orderBy(desc(sourceItems.createdAt));
  if (options?.limit) query.limit(options.limit);
  if (options?.offset) query.offset(options.offset);
  return query;
}

export async function listSourceItemsByPayload(payloadId: string) {
  return db.select().from(sourceItems)
    .where(eq(sourceItems.payloadId, payloadId))
    .orderBy(desc(sourceItems.createdAt));
}

export async function getSourceItemById(id: string) {
  const rows = await db.select().from(sourceItems).where(eq(sourceItems.id, id));
  return rows[0] ?? null;
}

export async function countSourceItemsBySource(sourceId: string) {
  const result = await db.select({ count: sql<number>`count(*)` })
    .from(sourceItems)
    .where(eq(sourceItems.sourceId, sourceId));
  return result[0]?.count ?? 0;
}

// ── Source Runs (create now, used heavily in Phase 4) ──

export type CreateRunInput = {
  sourceId: string;
  stateBefore?: Record<string, unknown>;
};

export async function createSourceRun(data: CreateRunInput) {
  const rows = await db.insert(sourceRuns)
    .values({ ...data, status: "running" })
    .returning();
  return rows[0]!;
}

export async function finalizeSourceRun(
  id: string,
  data: { status: string; pagesFetched?: number; itemsCreated?: number; error?: string; stateAfter?: Record<string, unknown> },
) {
  const rows = await db.update(sourceRuns)
    .set({ ...data, finishedAt: new Date() })
    .where(eq(sourceRuns.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function listRunsBySource(sourceId: string, options?: { limit?: number }) {
  const query = db.select().from(sourceRuns)
    .where(eq(sourceRuns.sourceId, sourceId))
    .orderBy(desc(sourceRuns.startedAt));
  if (options?.limit) query.limit(options.limit);
  return query;
}
```

**Import note:** Add `import { sql } from "drizzle-orm"` for the count query.

#### Step 5: Create `src/db/queries/feeds.ts`

```typescript
import { db } from "@/db/drizzle";
import { feeds, feedItems } from "@/db/schema/feeds";
import { sourceItems } from "@/db/schema/sources";
import { eq, desc, and, sql } from "drizzle-orm";

// ── Feeds ──

export async function listFeedsByUser(userId: string) {
  return db.select().from(feeds)
    .where(eq(feeds.userId, userId))
    .orderBy(desc(feeds.updatedAt));
}

export async function getFeedById(id: string) {
  const rows = await db.select().from(feeds).where(eq(feeds.id, id));
  return rows[0] ?? null;
}

export type CreateFeedInput = {
  userId: string;
  name: string;
  description?: string;
  config?: Record<string, unknown>;
  filter?: string;
};

export async function createFeed(data: CreateFeedInput) {
  const rows = await db.insert(feeds).values(data).returning();
  return rows[0]!;
}

export type UpdateFeedInput = Partial<
  Pick<typeof feeds.$inferInsert, "name" | "description" | "config" | "filter">
>;

export async function updateFeed(id: string, data: UpdateFeedInput) {
  const rows = await db.update(feeds)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(feeds.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function deleteFeed(id: string) {
  return db.delete(feeds).where(eq(feeds.id, id)).returning();
}

// ── Feed Items ──

export type CreateFeedItemInput = {
  feedId: string;
  sourceItemId: string;
  status?: string;
  userData?: Record<string, unknown>;
};

export async function createFeedItems(items: CreateFeedItemInput[]) {
  if (items.length === 0) return [];
  return db.insert(feedItems).values(items).returning();
}

export async function listFeedItems(feedId: string, options?: { limit?: number; offset?: number; status?: string }) {
  const conditions = [eq(feedItems.feedId, feedId)];
  if (options?.status) conditions.push(eq(feedItems.status, options.status));

  const query = db.select({
    feedItem: feedItems,
    sourceItem: sourceItems,
  })
    .from(feedItems)
    .innerJoin(sourceItems, eq(feedItems.sourceItemId, sourceItems.id))
    .where(and(...conditions))
    .orderBy(desc(feedItems.createdAt));

  if (options?.limit) query.limit(options.limit);
  if (options?.offset) query.offset(options.offset);
  return query;
}

export async function updateFeedItemStatus(id: string, status: string) {
  const rows = await db.update(feedItems)
    .set({ status, updatedAt: new Date() })
    .where(eq(feedItems.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function updateFeedItemUserData(id: string, userData: Record<string, unknown>) {
  const rows = await db.update(feedItems)
    .set({ userData, updatedAt: new Date() })
    .where(eq(feedItems.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function countFeedItems(feedId: string, status?: string) {
  const conditions = [eq(feedItems.feedId, feedId)];
  if (status) conditions.push(eq(feedItems.status, status));

  const result = await db.select({ count: sql<number>`count(*)` })
    .from(feedItems)
    .where(and(...conditions));
  return result[0]?.count ?? 0;
}
```

#### Step 6: Validation types (Zod schemas for API input)

Create `src/lib/validation/sources.ts` and `src/lib/validation/feeds.ts`:

```typescript
// src/lib/validation/sources.ts
import { z } from "zod";

export const sourceTypeEnum = z.enum([
  "rss", "api", "scrape", "upload", "extension", "bookmark_import", "manual",
]);

export const createSourceSchema = z.object({
  name: z.string().min(1).max(255),
  type: sourceTypeEnum,
  config: z.record(z.unknown()).optional().default({}),
  pipeline: z.string().optional(),
  schedule: z.object({
    interval_ms: z.number().int().positive().optional(),
    cron: z.string().optional(),
  }).optional(),
});

export const updateSourceSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  type: sourceTypeEnum.optional(),
  config: z.record(z.unknown()).optional(),
  pipeline: z.string().nullable().optional(),
  schedule: z.object({
    interval_ms: z.number().int().positive().optional(),
    cron: z.string().optional(),
  }).nullable().optional(),
  isActive: z.boolean().optional(),
});

export type CreateSourcePayload = z.infer<typeof createSourceSchema>;
export type UpdateSourcePayload = z.infer<typeof updateSourceSchema>;
```

```typescript
// src/lib/validation/feeds.ts
import { z } from "zod";

export const createFeedSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  config: z.record(z.unknown()).optional().default({}),
  filter: z.string().optional(),
});

export const updateFeedSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).nullable().optional(),
  config: z.record(z.unknown()).optional(),
  filter: z.string().nullable().optional(),
});

export const feedItemStatusEnum = z.enum([
  "unseen", "seen", "in_progress", "done", "archived",
]);

export type CreateFeedPayload = z.infer<typeof createFeedSchema>;
export type UpdateFeedPayload = z.infer<typeof updateFeedSchema>;
```

#### Cascade / deletion behavior

Defined in the schema via Drizzle `.references()` — the FK constraints use default `NO ACTION`. This means:

- **Deleting a source fails if it has payloads, items, or runs.** Intentional — you must clean up children first (or we add an explicit `deleteSourceWithChildren()` that deletes in order: feed_items → source_items → source_payloads → source_runs → source_secrets → source).
- **Deleting a feed fails if it has feed_items.** Same pattern — explicit cleanup function.

Add these to `queries/sources.ts`:

```typescript
export async function deleteSourceCascade(id: string) {
  // Order matters: children before parents
  await db.delete(feedItems).where(
    sql`${feedItems.sourceItemId} in (select id from source_items where source_id = ${id})`
  );
  await db.delete(sourceItems).where(eq(sourceItems.sourceId, id));
  await db.delete(sourcePayloads).where(eq(sourcePayloads.sourceId, id));
  await db.delete(sourceRuns).where(eq(sourceRuns.sourceId, id));
  await db.delete(sourceSecrets).where(eq(sourceSecrets.sourceId, id));
  return db.delete(sources).where(eq(sources.id, id)).returning();
}
```

And to `queries/feeds.ts`:

```typescript
export async function deleteFeedCascade(id: string) {
  await db.delete(feedItems).where(eq(feedItems.feedId, id));
  return db.delete(feeds).where(eq(feeds.id, id)).returning();
}
```

#### Index strategy

Phase 1 indexes — add to schema files:

```typescript
// In sources.ts, after table definitions:
import { index } from "drizzle-orm/pg-core";

// On sources:
// (added as 3rd arg to pgTable or via .addIndex — depends on Drizzle version)
// For now, add as a custom migration if needed:

// source_items: most queried table
// idx_source_items_source_id — fast lookup by source
// idx_source_items_url — fast dedup lookups
// idx_source_items_created_at — feed ordering

// feed_items: primary consumption table
// idx_feed_items_feed_id_status — "show me unseen items in this feed"
// idx_feed_items_source_item_id — "which feeds contain this item?"
```

Concrete SQL (add as custom migration if Drizzle doesn't generate them from schema):

```sql
CREATE INDEX idx_source_items_source_id ON source_items (source_id);
CREATE INDEX idx_source_items_url ON source_items (url) WHERE url IS NOT NULL;
CREATE INDEX idx_source_items_created_at ON source_items (created_at DESC);
CREATE INDEX idx_feed_items_feed_status ON feed_items (feed_id, status);
CREATE INDEX idx_feed_items_source_item ON feed_items (source_item_id);
CREATE INDEX idx_source_payloads_source_id ON source_payloads (source_id);
CREATE INDEX idx_source_runs_source_id ON source_runs (source_id, started_at DESC);
```

#### Tests

Create `src/db/__tests__/sources.test.ts` and `src/db/__tests__/feeds.test.ts`. Use Vitest. Test against the local Supabase Postgres (requires `bun run db:local:start` before tests).

**What to test in Phase 1:**

- `createSource` → returns row with ID, defaults filled
- `listSourcesByUser` → returns only sources for that user (RLS)
- `getSourceById` → returns null for nonexistent
- `updateSource` → updates only specified fields, bumps `updatedAt`
- `deleteSourceCascade` → removes source + all children
- `createSourceItems` → batch insert works, returns all rows
- `listSourceItemsBySource` → respects limit/offset
- `createFeed` → returns row
- `createFeedItems` → links feed to source items
- `listFeedItems` → joins source_items, respects status filter
- `updateFeedItemStatus` → changes status, bumps `updatedAt`

Test file pattern:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
// Tests will need a test DB connection — can reuse the existing drizzle.ts
// pointing at local Supabase, or set up a test-specific connection
```

#### Phase 1 deliverables checklist

- [ ] `src/db/schema/sources.ts` — 5 tables with RLS
- [ ] `src/db/schema/feeds.ts` — 2 tables with RLS
- [ ] `src/db/drizzle.ts` — updated with new schemas
- [ ] Migration generated and applied (`supabase/migrations/` has new file)
- [ ] `src/db/queries/sources.ts` — all functions listed above
- [ ] `src/db/queries/feeds.ts` — all functions listed above
- [ ] `src/lib/validation/sources.ts` — Zod schemas
- [ ] `src/lib/validation/feeds.ts` — Zod schemas
- [ ] Indexes applied (custom migration or schema-level)
- [ ] Tests: `src/db/__tests__/sources.test.ts`
- [ ] Tests: `src/db/__tests__/feeds.test.ts`
- [ ] All tests pass with `bun run test`
- [ ] `bun run check-types` passes
- [ ] `bun run lint` passes

---

### Phase 2: Manual Ingestion (get data in without automation)

5. Import UI: file upload + paste
6. Parsers: bookmarks.html, JSON, CSV
7. Manual add: quick-add URL bar
8. Source items display: basic list view of ingested items

### Phase 3: Feed System (see data meaningfully)

9. Feed CRUD: create/edit/delete feeds
10. Feed view: list items in a feed, mark status
11. Feed routing: when items come in, route to matching feeds
12. Inbox: unassigned items view

### Phase 4: Connector Engine (automate ingestion)

13. Elo integration: install `@enspirit/elo`, build eval helpers
14. Connector engine: generic executor with pagination
15. WDK integration: wrap executor in durable workflow
16. RSS source: first automated source type
17. API source: YouTube or Twitter as second type
18. Scrape source: third type

### Phase 5: Polish & Extend

19. Sources manager UI: run history, status, config editing
20. Feed builder: combine sources, set filters, preview
21. Search: full-text over source items
22. Secrets management: Vault integration, per-source secrets
23. Scheduling: periodic source runs via WDK

---

## Dependencies to Add

```bash
# In apps/palace
bun add @enspirit/elo        # Expression language
bun add fast-xml-parser       # RSS/XML parsing
bun add papaparse             # CSV parsing
```

`workflow` is already installed. Supabase client is already installed. No other external deps needed for Phase 1–3.

---

## Key Patterns

### RLS everywhere

Every new table uses `enableRLS()` with policies scoped to the authenticated user. Source items and payloads use subquery policies checking the parent source's `user_id`.

### WDK step boundaries

Each `"use step"` is a checkpoint. Place them around I/O operations (DB writes, HTTP fetches, S3 uploads). Pure computation (Elo eval, parsing) does NOT need step boundaries — it's fast and deterministic.

### Elo two-dialect convention

| Where | Elo subset | Compiles to |
|-------|-----------|------------|
| Source pipeline (ingestion) | Full Elo: lambdas, pipes, schemas | JS only |
| Feed filter (query) | Simple expressions: comparisons, boolean logic, dates | JS + SQL |

### Storage decision

```typescript
const INLINE_THRESHOLD = 256 * 1024; // 256KB

function shouldInline(payload: Buffer): boolean {
  return payload.length <= INLINE_THRESHOLD;
}
```

Below threshold → `data` jsonb column. Above → Supabase Storage (S3-compatible), `storage_key` holds the path.
