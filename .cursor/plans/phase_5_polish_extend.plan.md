---
name: Phase 5 Polish and Extend
overview: "Complete the experience: sources manager with full run monitoring, feed builder with live preview and Elo filters compiled to SQL, full-text search across all items, scheduling (periodic source runs via WDK), extension endpoint, and graph-ready foundations."
todos:
  - id: sources-manager
    content: Build full sources manager UI — run monitoring, config editing, toggle active/inactive, run stats dashboard
    status: pending
  - id: feed-builder
    content: Upgrade feed builder — Elo filter editor with validation, SQL preview, live filter preview
    status: pending
  - id: feed-sql-filters
    content: Implement SQL-compiled feed filters — Elo expressions compiled to WHERE clauses for DB-level filtering
    status: pending
  - id: search
    content: Build /search route — full-text search over source items (pg_trgm or tsvector), faceted by source/type/date
    status: pending
  - id: search-index
    content: Add GIN/tsvector index on source_items for full-text search
    status: pending
  - id: scheduling
    content: Create src/workflows/schedule-sources.ts — WDK cron workflow that polls active sources on their schedule
    status: pending
  - id: extension-endpoint
    content: Create POST /api/extension — browser extension push endpoint with JSON schema
    status: pending
  - id: item-detail
    content: Create /items/$itemId route — single item view with metadata, notes, connections, source info
    status: pending
  - id: keyboard-shortcuts
    content: Add keyboard navigation to feed view — j/k navigate, m = mark read, d = mark done, o = open URL
    status: pending
  - id: graph-foundation
    content: Create item_edge and item_tag tables (schema + queries) — foundation for graph/connection features
    status: pending
  - id: dedup-engine
    content: Implement URL-based dedup — canonical_id linking, merge UI for duplicate items
    status: pending
  - id: batch-operations
    content: Add batch operations to feed view — select multiple, mark all read, move to feed, archive
    status: pending
  - id: settings
    content: Create /settings route — user preferences, default feed, theme, notification prefs
    status: pending
  - id: error-handling
    content: Add error boundaries, toast notifications, optimistic updates throughout the app
    status: pending
  - id: verify
    content: Full test suite, type-check, lint, performance check on large datasets
    status: pending
isProject: false
---

# Phase 5: Polish & Extend — Complete the Experience

**Prerequisite:** Phase 4 complete (connector engine works, automated sources fetch data, feeds display items).

**Goal:** Transform Memoria from a functional prototype into a polished, daily-driver knowledge app. This phase is broader — it covers the remaining features from the design doc, performance optimizations, and quality-of-life improvements that make the app feel complete.

Full design context: [SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md), [IMPLEMENTATION.md](docs/IMPLEMENTATION.md), [EXPLORATION_ELO_WORKFLOWS.md](docs/EXPLORATION_ELO_WORKFLOWS.md).

---

## This Phase Has Sub-Phases

Phase 5 is large. Break it into chunks that can ship independently:

**5a: Sources Manager + Scheduling** — make automated sources self-sustaining
**5b: Search + Item Detail** — make the knowledge base queryable
**5c: Feed Builder Upgrade + SQL Filters** — power-user feed creation
**5d: Extension + Graph Foundation + Polish** — connectivity and daily-driver quality

---

## Phase 5a: Sources Manager + Scheduling

### Full Sources Manager — `src/routes/_protected/sources/$sourceId.tsx` (major upgrade)

Transform the basic source detail page into a full management console:

```
┌──────────────────────────────────────────────────┐
│  ← Sources    My YouTube Subs    [Edit][Run Now] │
├──────────────────────────────────────────────────┤
│  ● Active  •  API  •  Every 1h  •  Last: 3m ago  │
│  142 items  •  23 runs  •  0 errors (last 24h)    │
│                                                    │
│  ── Config ──                              [edit]  │
│  URL: googleapis.com/youtube/v3/playlistItems      │
│  Pagination: cursor (nextPageToken)                │
│  Pipeline: _.response.items |> map(v ~ {...})      │
│  Secrets: youtube_api_key (set)                    │
│                                                    │
│  ── Run History ──                    [see all]    │
│  ┌────────────────────────────────────────────┐    │
│  │ #23 ● Completed  3m ago   1pg  18 items    │    │
│  │ #22 ● Completed  1h3m ago 1pg  22 items    │    │
│  │ #21 ● Completed  2h3m ago 1pg  15 items    │    │
│  │ #20 ✕ Failed     3h3m ago Rate limited     │    │
│  └────────────────────────────────────────────┘    │
│                                                    │
│  ── Recent Items ──                   [see all]    │
│  • New Video: "Building with Bun"    3m ago        │
│  • New Video: "React 19 Deep Dive"   1h ago        │
│  • New Video: "TypeScript 6 Preview" 2h ago        │
│                                                    │
│  ── Stats ──                                       │
│  Items/run: avg 19  •  Success rate: 96%           │
│  Total items: 142   •  Active since: Feb 1         │
└──────────────────────────────────────────────────┘
```

**Implementation:**
- Config display: show human-readable summary of fetch URL, pagination type, secrets (masked), schedule
- Run history: paginated table from `listRunsBySource`, click to expand error details
- Recent items: last 5 source items, link to full items list
- Stats: computed from run history (avg items/run, success rate, total items)
- Edit: inline editing or navigate to edit form
- Run Now: calls `POST /api/sources/:sourceId/run`, shows toast with result
- Active/inactive toggle: calls `updateSource(id, { isActive: !current })`

### Scheduling — `src/workflows/schedule-sources.ts`

A WDK workflow that periodically checks for sources that need to run.

```typescript
export async function scheduleSourceRuns() {
  "use workflow";

  while (true) {
    const sourcesToRun = await findDueSources();

    for (const source of sourcesToRun) {
      // Fan out: each source run is its own workflow
      await triggerSourceRun(source.id);
    }

    // Sleep until next check (1 minute)
    await sleep(60_000);
  }
}

async function findDueSources() {
  "use step";
  // Query: active sources where schedule is set and
  // (last_fetched_at is null OR now() - last_fetched_at > schedule.interval_ms)
  // For cron: evaluate cron expression against current time
}

async function triggerSourceRun(sourceId: string) {
  "use step";
  // Start runSource workflow (non-blocking)
}
```

**How scheduling works:**
- The scheduler is a long-running WDK workflow (essentially a cron job)
- It wakes every 60 seconds, queries for due sources, triggers runs
- Each triggered run is a separate `runSource` workflow (fan-out)
- Uses `source.schedule` config: `{ interval_ms: number }` or `{ cron: string }`
- Compare against `source.lastFetchedAt` to determine if due

**Starting the scheduler:**
- On app boot (in server startup), ensure the scheduler workflow is running
- WDK handles persistence — if the app restarts, the scheduler resumes

### Secrets Management UI

Add to source edit form:
- List current secrets (name only, value masked)
- Add secret: name + value input → calls `storeSecret`
- Remove secret: confirm → calls `deleteSecret`
- Note: values are stored in Supabase Vault, never displayed after creation

---

## Phase 5b: Search + Item Detail

### Full-Text Search — `src/routes/_protected/search.tsx`

```
┌──────────────────────────────────────────────────┐
│  Search                                           │
│  [react server components________________] [🔍]   │
├──────────────────────────────────────────────────┤
│  ── Filters ──                                    │
│  Source: [All ▾]  Type: [All ▾]  Date: [Any ▾]   │
│                                                    │
│  23 results for "react server components"          │
│                                                    │
│  React Server Components Deep Dive                 │
│  example.com • Chrome Import • Feb 15              │
│  "...comprehensive guide to React Server           │
│   Components and how they change..."               │
│                                                    │
│  RSC Architecture Explained                        │
│  blog.example.com • RSS • Jan 28                   │
│  "...the architecture behind React Server          │
│   Components differs fundamentally from..."        │
│                                                    │
│  [Load more]                                       │
└──────────────────────────────────────────────────┘
```

**Implementation:**

Two approaches (can implement one, upgrade later):

**Approach 1 — pg_trgm (simpler, good for Phase 5):**
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX idx_source_items_search ON source_items
  USING gin ((normalized_data->>'title') gin_trgm_ops);

-- Query:
SELECT * FROM source_items
WHERE normalized_data->>'title' ILIKE '%react server%'
   OR normalized_data->>'description' ILIKE '%react server%'
ORDER BY created_at DESC
LIMIT 50;
```

**Approach 2 — tsvector (more powerful, better ranking):**
```sql
ALTER TABLE source_items ADD COLUMN search_vector tsvector;

CREATE OR REPLACE FUNCTION source_items_search_trigger() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    coalesce(NEW.normalized_data->>'title', '') || ' ' ||
    coalesce(NEW.normalized_data->>'description', '') || ' ' ||
    coalesce(NEW.url, '')
  );
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_source_items_search
  BEFORE INSERT OR UPDATE ON source_items
  FOR EACH ROW EXECUTE FUNCTION source_items_search_trigger();

CREATE INDEX idx_source_items_fts ON source_items USING gin(search_vector);

-- Query:
SELECT *, ts_rank(search_vector, query) AS rank
FROM source_items, to_tsquery('english', 'react & server & components') query
WHERE search_vector @@ query
ORDER BY rank DESC
LIMIT 50;
```

**API route:** `GET /api/search?q=...&source=...&type=...&after=...&before=...`

**Faceted filtering:**
- By source (dropdown of user's sources)
- By source type (rss, api, scrape, etc.)
- By date range
- Combined with text search

### Item Detail — `src/routes/_protected/items/$itemId.tsx`

Single-item view for deep engagement:

```
┌──────────────────────────────────────────────────┐
│  ← Back    React Server Components Deep Dive      │
├──────────────────────────────────────────────────┤
│  📎 https://example.com/rsc-deep-dive     [open]  │
│                                                    │
│  Source: Chrome Import • Type: bookmark            │
│  Added: Feb 15, 2026                               │
│  Status: unseen  [Mark Read] [Mark Done]           │
│                                                    │
│  ── In Feeds ──                                    │
│  • Tech Articles (unseen)                          │
│  • React Learning (seen)                           │
│                                                    │
│  ── Notes ──                          [edit]       │
│  User-added notes appear here...                   │
│                                                    │
│  ── Tags ──                           [add]        │
│  react  rsc  server-components                     │
│                                                    │
│  ── Metadata ──                                    │
│  { title: "React Server Components...",            │
│    url: "...", folder: "Dev/React", ... }          │
│                                                    │
│  ── Connections ── (future)                        │
│  Items linked to or from this one                  │
└──────────────────────────────────────────────────┘
```

**Implementation:**
- Load source item by ID + all feed_items pointing to it
- Show status per feed, allow status changes from here
- Notes: stored in `feedItem.userData.notes` — editable textarea
- Tags: stored in `feedItem.userData.tags` — tag input component
- Metadata: collapsible raw `normalizedData` JSON view
- Open button: opens original URL in new tab
- Connections section: placeholder for Phase 5d graph features

---

## Phase 5c: Feed Builder Upgrade + SQL Filters

### Enhanced Feed Builder

Upgrade the Phase 3 feed builder with Elo filter support:

```
┌──────────────────────────────────────────────────┐
│  Edit Feed: Tech Articles                         │
├──────────────────────────────────────────────────┤
│  ── Sources ──                                    │
│  ☑ Chrome Bookmarks (2,341 items)                │
│  ☑ HN Scrape (891 items)                         │
│  ☐ YouTube Subs (142 items)                      │
│                                                   │
│  ── Filter (Elo) ──                               │
│  ┌────────────────────────────────────────────┐   │
│  │ _.type == 'article' and                    │   │
│  │ _.published_at > TODAY - P30D              │   │
│  └────────────────────────────────────────────┘   │
│  ✓ Valid expression                               │
│  SQL: WHERE type = 'article' AND published_at >   │
│       current_date - interval '30 days'           │
│                                                   │
│  ── Preview ──  (filtered from 3,232 total)       │
│  Showing 10 of 1,247 matching items:              │
│  • React Server Components Deep Dive              │
│  • Understanding TypeScript Generics              │
│  • Building a CLI with Bun                        │
│                                                   │
│  [Save Changes]                                   │
└──────────────────────────────────────────────────┘
```

**Implementation:**
- Elo filter editor: textarea with real-time validation (call `validateEloExpression` on keystroke, debounced)
- SQL preview: show the compiled SQL WHERE clause (call `eloToSQL`)
- Live preview: when sources + filter change, query matching items and show count + sample
- Filter is stored in `feed.filter` column as Elo expression string

### SQL-Compiled Feed Filters

Currently (Phase 3), feed filters are evaluated in JS at routing time. Phase 5c adds SQL compilation:

**At query time (listing feed items):** When `listFeedItems` is called and the feed has a filter, compile the filter to SQL and push it to the WHERE clause. This avoids loading all items into JS to filter.

```typescript
export async function listFeedItemsFiltered(
  feedId: string,
  filter: string | null,
  options?: { limit?: number; offset?: number; status?: string }
) {
  if (!filter) {
    return listFeedItems(feedId, options);
  }

  const sqlWhere = eloToSQL(filter);
  // Build query with additional WHERE clause on source_items.normalized_data
  // This requires the Elo→SQL compiler to output JSON path expressions
  // compatible with Postgres jsonb operators
}
```

**Important constraint:** Only the "simple" Elo dialect (no lambdas, no schemas) compiles to SQL. The feed filter editor should enforce this. Add a `validateFeedFilter` function that checks SQL-compilability.

---

## Phase 5d: Extension + Graph + Polish

### Browser Extension Endpoint — `src/routes/api/extension.ts`

```
POST /api/extension
Headers: Authorization: Bearer <session_token>
Body: {
  tabs: [{ url: string, title: string, favIconUrl?: string }],
  session?: string,      // session name (e.g., "work-research")
  timestamp: string,     // ISO 8601
  source?: string        // "chrome" | "firefox" | "arc"
}
```

**Flow:**
1. Authenticate via Bearer token (Supabase session)
2. Find or create extension source for this user
3. Store tabs JSON as source_payload
4. Create source_items (one per tab)
5. Route to feeds (extension feed + matching feeds)
6. Return `{ itemsCreated, feedsRouted }`

**Extension source auto-creation:**
First push creates a source with `type: "extension"`, `name: "Browser Extension"`. Subsequent pushes reuse it.

### Graph Foundation — Schema + Queries

Add tables for future graph/connection features:

**`src/db/schema/graph.ts`**

```typescript
export const itemEdges = pgTable("item_edges", {
  id: uuid("id").defaultRandom().primaryKey(),
  fromItemId: uuid("from_item_id").notNull().references(() => sourceItems.id),
  toItemId: uuid("to_item_id").notNull().references(() => sourceItems.id),
  edgeType: text("edge_type").notNull(),  // links_to | related | parent | child | duplicate | derived_from
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  createdBy: text("created_by").notNull().default("system"),  // system | user | llm
});

export const itemTags = pgTable("item_tags", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceItemId: uuid("source_item_id").notNull().references(() => sourceItems.id),
  tag: text("tag").notNull(),
  confidence: real("confidence"),          // 0-1 for LLM-derived, null for user-added
  source: text("source").notNull(),        // user | llm | rule
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
```

**Queries:**
- `getItemEdges(itemId)` — all edges from/to an item
- `createEdge(fromId, toId, edgeType, metadata)` — create connection
- `getItemTags(itemId)` — all tags for an item
- `addTag(itemId, tag, source)` — add a tag
- `findItemsByTag(userId, tag)` — search by tag
- `findRelatedItems(itemId)` — items connected via edges

**Usage in Phase 5d:**
- When a source item has sub-links in its content, extract them and create `links_to` edges
- When dedup finds matching items, create `duplicate` edges
- User can manually link items from the item detail page
- Tags can be added manually or (future) via LLM classification

### Dedup Engine

URL-based deduplication across sources:

```typescript
export async function findDuplicatesByUrl(url: string, userId: string) {
  return db.select().from(sourceItems)
    .innerJoin(sources, eq(sourceItems.sourceId, sources.id))
    .where(and(
      eq(sourceItems.url, normalizeUrl(url)),
      eq(sources.userId, userId)
    ));
}

export function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  parsed.searchParams.delete("utm_source");
  parsed.searchParams.delete("utm_medium");
  parsed.searchParams.delete("utm_campaign");
  // Strip trailing slash, www prefix, etc.
  return parsed.toString();
}
```

**When dedup runs:**
- At source item creation time: check if URL already exists
- If duplicate found: set `canonical_id` to point to the existing item, create an `item_edge` with type `duplicate`
- UI: show "also appears in" on item detail page

### Keyboard Shortcuts

Add to feed view:
- `j` / `k` — move selection down/up
- `m` — toggle seen/unseen
- `d` — mark done
- `o` — open URL in new tab
- `a` — archive
- `Space` — expand item inline (show description/notes)

Implementation: `useEffect` with `keydown` listener, track selected index, dispatch status updates.

### Batch Operations

Add to feed view:
- Checkbox column on each item
- "Select all" checkbox in header
- Bulk actions bar: "Mark Read", "Mark Done", "Archive", "Move to Feed"
- API: `PATCH /api/feeds/:feedId/items/batch` with `{ ids: string[], action: string }`

### Settings Page — `src/routes/_protected/settings.tsx`

```
┌──────────────────────────────────────────────────┐
│  Settings                                         │
├──────────────────────────────────────────────────┤
│  ── General ──                                    │
│  Default feed: [Tech Articles ▾]                  │
│  Items per page: [50 ▾]                           │
│                                                   │
│  ── Display ──                                    │
│  Theme: [System ▾]                                │
│  Compact mode: [off]                              │
│                                                   │
│  ── Notifications ──                              │
│  New items: [off]                                 │
│                                                   │
│  ── Data ──                                       │
│  Export all data: [Export JSON]                    │
│  Delete account: [Delete...]                      │
└──────────────────────────────────────────────────┘
```

### Error Handling & UX Polish

- **Error boundaries:** Wrap routes in React error boundaries with friendly fallback UI
- **Toast notifications:** Success/error toasts for all mutations (import, status change, run trigger, etc.)
- **Optimistic updates:** Mark read/done immediately in UI, revert on API error
- **Loading states:** Skeleton loaders for item lists, sources, feeds
- **Empty states:** Custom illustrations/copy for empty feeds, sources, inbox, search
- **Responsive:** Sidebar collapses on mobile, feed view is touch-friendly

---

## Migrations for Phase 5

```sql
-- Full-text search (pick one approach)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- OR
ALTER TABLE source_items ADD COLUMN search_vector tsvector;
-- + trigger + index (see Phase 5b section)

-- Graph tables
CREATE TABLE item_edges (...);
CREATE TABLE item_tags (...);

-- Indexes
CREATE INDEX idx_item_edges_from ON item_edges (from_item_id);
CREATE INDEX idx_item_edges_to ON item_edges (to_item_id);
CREATE INDEX idx_item_tags_item ON item_tags (source_item_id);
CREATE INDEX idx_item_tags_tag ON item_tags (tag);
CREATE INDEX idx_source_items_url_norm ON source_items (url) WHERE url IS NOT NULL;
```

---

## File Summary

| File | Type | Phase | Purpose |
|------|------|-------|---------|
| `src/routes/_protected/sources/$sourceId.tsx` | EDIT | 5a | Full source management console |
| `src/workflows/schedule-sources.ts` | NEW | 5a | WDK cron scheduler for active sources |
| `src/routes/_protected/search.tsx` | NEW | 5b | Full-text search page |
| `src/routes/api/search.ts` | NEW | 5b | Search API endpoint |
| `src/routes/_protected/items/$itemId.tsx` | NEW | 5b | Item detail page |
| `src/routes/api/items/$itemId.ts` | NEW | 5b | Item detail API |
| `src/routes/_protected/feeds/new.tsx` | EDIT | 5c | Enhanced feed builder with Elo filters |
| `src/routes/_protected/feeds/$feedId/edit.tsx` | EDIT | 5c | Enhanced feed editor |
| `src/db/queries/feeds.ts` | EDIT | 5c | SQL-compiled filter queries |
| `src/routes/api/extension.ts` | NEW | 5d | Browser extension push endpoint |
| `src/db/schema/graph.ts` | NEW | 5d | item_edges + item_tags tables |
| `src/db/queries/graph.ts` | NEW | 5d | Graph query functions |
| `src/lib/dedup.ts` | NEW | 5d | URL normalization + dedup engine |
| `src/routes/_protected/settings.tsx` | NEW | 5d | Settings page |

---

## Phase 5 Deliverables Checklist

### 5a: Sources Manager + Scheduling
- [ ] Source detail page shows config, run history, recent items, stats
- [ ] Source edit: inline config editing, secrets management, schedule picker
- [ ] Scheduler workflow runs, checks for due sources, triggers runs
- [ ] Sources auto-run on their configured schedule
- [ ] Active/inactive toggle works

### 5b: Search + Item Detail
- [ ] Full-text search works across all source items
- [ ] Search has faceted filtering (source, type, date)
- [ ] Search results show snippets with highlighted matches
- [ ] Item detail page shows metadata, feed memberships, notes, tags
- [ ] Notes are editable from item detail
- [ ] Tags are addable/removable from item detail

### 5c: Feed Builder + SQL Filters
- [ ] Feed builder has Elo filter editor with real-time validation
- [ ] SQL preview shows compiled WHERE clause
- [ ] Live preview shows matching item count + sample
- [ ] Feed filters compile to SQL for database-level filtering
- [ ] Performance: 10k+ items in a feed load quickly with SQL filters

### 5d: Extension + Graph + Polish
- [ ] Extension endpoint accepts tab pushes, creates items, routes to feeds
- [ ] item_edges and item_tags tables created with RLS
- [ ] Dedup engine normalizes URLs, links duplicates via canonical_id
- [ ] Keyboard shortcuts work in feed view
- [ ] Batch operations (select + bulk action) work in feed view
- [ ] Settings page exists with basic preferences
- [ ] Error boundaries, toasts, loading states, empty states throughout
- [ ] App is responsive on mobile
- [ ] `bun run check-types` passes
- [ ] `bun run lint` passes
- [ ] Full test suite passes
