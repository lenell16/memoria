---
name: Phase 3 Feed System
overview: "Build the feed layer: CRUD for feeds, feed view with items + status tracking, feed routing (when items come in they get routed to matching feeds), inbox for unrouted items, feed builder UI with source selection and preview."
todos:
  - id: api-feeds-crud
    content: Create /api/feeds CRUD routes — list, get, create, update, delete with cascade
    status: pending
  - id: api-feed-items
    content: Create /api/feeds/$feedId/items routes — list (paginated, status filter), update status, update user data
    status: pending
  - id: api-feed-routing
    content: Create src/lib/feeds/router.ts — routes source items to matching feeds based on feed config
    status: pending
  - id: api-inbox
    content: Create /api/inbox route — lists source items not in any feed
    status: pending
  - id: query-inbox
    content: Add listUnroutedItems query to src/db/queries/sources.ts — source items with no feed_items rows
    status: pending
  - id: route-feeds-list
    content: Create /feeds route — list all feeds with unread counts, last activity
    status: pending
  - id: route-feed-view
    content: Create /feeds/$feedId route — primary consumption UI with item list, status controls, filtering
    status: pending
  - id: route-feed-new
    content: Create /feeds/new route — feed builder with source picker, filter config, preview
    status: pending
  - id: route-feed-edit
    content: Create /feeds/$feedId/edit route — edit feed name, sources, filters
    status: pending
  - id: route-inbox
    content: Create /inbox route — unrouted items with "add to feed" action
    status: pending
  - id: sidebar-feeds
    content: Update sidebar to show feeds list with unread counts, link to inbox with unread badge
    status: pending
  - id: status-sync
    content: Implement cross-feed status sync — marking a source item done in one feed optionally syncs to others
    status: pending
  - id: hook-import
    content: Wire Phase 2 import flow to route newly created items through feed router
    status: pending
  - id: verify
    content: Type-check, lint, test feed routing logic
    status: pending
isProject: false
---

# Phase 3: Feed System — See Data Meaningfully

**Prerequisite:** Phase 2 complete (import works, sources exist with items, app shell with sidebar).

**Goal:** Users can create feeds (curated views over sources), see items in a feed, track read/done status, and have items automatically routed to feeds when ingested. Unrouted items go to an inbox.

Full design context: [SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md) — Feeds are curated views built ON TOP of source items.
Key distinction: Source items are the spine. Feed items are where Memoria's opinion lives (status, notes, tags).

---

## Core Concept: Feed Routing

When source items are created (via import, quick-add, or future automation), they need to land in the right feeds. A feed's `config` declares which sources feed into it and what filters apply:

```jsonc
// feed.config example
{
  "source_ids": ["uuid-of-youtube-source", "uuid-of-rss-source"],
  "auto_route": true     // automatically add matching items
}
```

The routing logic:
1. New source items arrive (from import, quick-add, or future connector run)
2. Find all feeds where `config.source_ids` includes the source's ID AND `config.auto_route` is true
3. For each matching feed: if `feed.filter` exists, evaluate it against the source item's `normalizedData`. If it passes (or no filter), create a feed item.
4. Items that don't match ANY feed → they're "unrouted" and show up in the inbox.

**Phase 3 uses simple JS evaluation for filters.** Elo integration comes in Phase 4. For now, feed filters can be:
- Null/empty → all items from the source pass
- A JSON path check stored in config → evaluated in JS at routing time

---

## Steps

### 1. Feed Routing Engine — `src/lib/feeds/router.ts`

The core routing function called whenever source items are created.

```typescript
export interface RouteResult {
  feedId: string;
  feedName: string;
  itemsRouted: number;
}

export async function routeItemsToFeeds(
  sourceId: string,
  sourceItemIds: string[],
  userId: string
): Promise<RouteResult[]>;

export async function routeSingleItem(
  sourceId: string,
  sourceItemId: string,
  userId: string
): Promise<RouteResult[]>;
```

**Implementation:**
1. Query all feeds for the user where `config->'source_ids'` contains the sourceId
2. Load the source items (with `normalizedData`)
3. For each feed:
   - If feed has a `filter`: evaluate it against each source item's normalizedData (simple JS for now)
   - Create feed_items for all passing items (batch insert)
4. Return summary of what was routed where

**Where it's called:**
- `POST /api/import` → after `createSourceItems`, call `routeItemsToFeeds`
- `POST /api/sources/quick-add` → after creating item, call `routeSingleItem`
- Phase 4: after connector run completes

### 2. Unrouted Items Query — Update `src/db/queries/sources.ts`

Add a new query function:

```typescript
export async function listUnroutedItems(
  userId: string,
  options?: { limit?: number; offset?: number }
): Promise<(typeof sourceItems.$inferSelect)[]>;
```

**SQL logic:**
```sql
SELECT si.* FROM source_items si
JOIN sources s ON si.source_id = s.id
WHERE s.user_id = $userId
  AND si.id NOT IN (SELECT source_item_id FROM feed_items)
ORDER BY si.created_at DESC
LIMIT $limit OFFSET $offset;
```

Also add `countUnroutedItems(userId)` for the inbox badge.

### 3. API Routes

#### `src/routes/api/feeds/index.ts` — Feeds CRUD

```
GET    /api/feeds           → listFeedsByUser(userId)
POST   /api/feeds           → validate(createFeedSchema) → createFeed({...data, userId})
```

#### `src/routes/api/feeds/$feedId.ts` — Single Feed

```
GET    /api/feeds/:feedId      → getFeedById(id) + verify ownership
PUT    /api/feeds/:feedId      → validate(updateFeedSchema) → updateFeed(id, data)
DELETE /api/feeds/:feedId      → deleteFeedCascade(id)
```

#### `src/routes/api/feeds/$feedId.items.ts` — Feed Items

```
GET    /api/feeds/:feedId/items     → listFeedItems(feedId, { limit, offset, status })
PATCH  /api/feeds/:feedId/items/:itemId/status  → updateFeedItemStatus(itemId, status)
PATCH  /api/feeds/:feedId/items/:itemId/data    → updateFeedItemUserData(itemId, userData)
```

**Query params for GET:**
- `limit` (default 50)
- `offset` (default 0)
- `status` (filter: unseen, seen, in_progress, done, archived)

Response includes the joined source item data (title, URL, normalizedData).

#### `src/routes/api/inbox.ts` — Inbox

```
GET    /api/inbox           → listUnroutedItems(userId, { limit, offset })
POST   /api/inbox/route     → { sourceItemIds: string[], feedId: string } → createFeedItems for each → removes from inbox
```

The "route" endpoint lets a user manually assign inbox items to a feed.

### 4. Feed List — `src/routes/_protected/feeds/index.tsx`

```
┌──────────────────────────────────────────────────┐
│  Feeds                              [+ New Feed]  │
├──────────────────────────────────────────────────┤
│ 📰 Tech Articles                    23 unread     │
│    3 sources • 892 items total                    │
│ ─────────────────────────────────────────────── │
│ 🎙 Podcasts                         5 unread      │
│    2 sources • 142 items total                    │
│ ─────────────────────────────────────────────── │
│ 📚 Reading List                     0 unread      │
│    1 source • 45 items total                      │
└──────────────────────────────────────────────────┘
```

**Implementation:**
- Query feeds + unread counts (count where status='unseen')
- Click → navigate to `/feeds/{id}`
- `[+ New Feed]` → navigate to `/feeds/new`
- Show source count from `config.source_ids.length`
- Show total item count from `countFeedItems(feedId)`

### 5. Feed View — `src/routes/_protected/feeds/$feedId.tsx`

**This is the primary consumption surface.** What the user looks at most of the time.

```
┌──────────────────────────────────────────────────┐
│  ← Feeds    Tech Articles           [filter][⚙]   │
│  23 unread of 892                                  │
├──────────────────────────────────────────────────┤
│  [All] [Unread] [In Progress] [Done] [Archived]   │
├──────────────────────────────────────────────────┤
│ ○ React Server Components Deep Dive    3h ago      │
│   example.com • Chrome Import                      │
│                                     [mark read] ✓  │
│ ─────────────────────────────────────────────── │
│ ○ Understanding TypeScript Generics    1d ago      │
│   example.com • Chrome Import                      │
│                                     [mark read] ✓  │
│ ─────────────────────────────────────────────── │
│ ● Podcast Ep 142: Future of...        2d ago      │
│   youtube.com • YouTube Subs • seen                │
│                                     [mark done] ✓  │
│ ─────────────────────────────────────────────── │
│                                                    │
│  [Load more]                                       │
└──────────────────────────────────────────────────┘

○ = unseen   ● = seen   ◉ = in_progress   ✓ = done   ▪ = archived
```

**Implementation:**
- Status filter tabs at top (All, Unread, In Progress, Done, Archived)
- Items loaded via `listFeedItems` with status filter
- Each item row shows:
  - Status indicator (circle/dot)
  - Title from `sourceItem.normalizedData.title`
  - URL hostname
  - Source name (need to join or denormalize)
  - Relative time since `feedItem.createdAt`
  - Quick-action buttons: mark as next status
- Click on item title → open URL in new tab
- Click on item row (not title) → future item detail view
- Keyboard shortcuts (future): j/k navigate, m = mark read, d = mark done
- Infinite scroll or load-more pagination

**Status transition flow:**
```
unseen → seen → in_progress → done → archived
               (optional)
```
Each transition calls `PATCH /api/feeds/:feedId/items/:itemId/status`.

### 6. Feed Builder — `src/routes/_protected/feeds/new.tsx`

```
┌──────────────────────────────────────────────────┐
│  Create Feed                                      │
├──────────────────────────────────────────────────┤
│  Name: [Tech Articles_________________]           │
│  Description: [Optional description___]           │
│                                                   │
│  ── Sources ──                                    │
│  Select which sources feed into this:             │
│  ☑ Chrome Bookmarks Feb  (2,341 items)           │
│  ☑ Manual Links          (12 items)              │
│  ☐ OneTab Export         (89 items)              │
│                                                   │
│  ── Auto-route ──                                 │
│  ☑ Automatically add new items from sources       │
│                                                   │
│  ── Preview ──                                    │
│  Showing first 10 items that would match:         │
│  • React Server Components Deep Dive              │
│  • Understanding TypeScript Generics              │
│  • Building a CLI with Bun                        │
│  ... and 2,340 more                               │
│                                                   │
│  [Create Feed]                                    │
└──────────────────────────────────────────────────┘
```

**Implementation:**
- Name + description fields
- Source picker: checkbox list of user's sources with item counts
- Auto-route toggle: when on, new items from selected sources automatically land in this feed
- Preview: when sources are selected, query source items from those sources (first 10) to show what the feed would contain
- On submit:
  1. `createFeed({ name, description, config: { source_ids: [...], auto_route: true } })`
  2. Batch-create feed_items for ALL existing source items from the selected sources (this could be large — handle pagination in the API, show progress in the UI)
  3. Navigate to the new feed's view

**Backfill on create:**
When a feed is created with existing sources, we need to retroactively create feed_items for all existing source items. This is a bulk operation:
```typescript
// In the create feed API or a helper:
async function backfillFeedItems(feedId: string, sourceIds: string[]) {
  for (const sourceId of sourceIds) {
    let offset = 0;
    const batchSize = 500;
    while (true) {
      const items = await listSourceItemsBySource(sourceId, { limit: batchSize, offset });
      if (items.length === 0) break;
      await createFeedItems(items.map(si => ({ feedId, sourceItemId: si.id })));
      offset += batchSize;
    }
  }
}
```

### 7. Feed Edit — `src/routes/_protected/feeds/$feedId/edit.tsx`

Same form as feed builder, pre-populated. Changing sources updates the config. If a new source is added, backfill. If a source is removed, optionally remove feed items from that source (confirm dialog).

### 8. Inbox — `src/routes/_protected/inbox.tsx`

```
┌──────────────────────────────────────────────────┐
│  Inbox                              12 items       │
├──────────────────────────────────────────────────┤
│  Items not assigned to any feed.                   │
│                                                    │
│ ☐ Some Random Article                 3h ago       │
│   example.com • Manual                             │
│ ☐ Another Unrouted Item               1d ago       │
│   example.com • Chrome Import                      │
│                                                    │
│  [Add selected to feed ▾]                          │
│                                                    │
└──────────────────────────────────────────────────┘
```

**Implementation:**
- Shows source items that have NO feed_items (using `listUnroutedItems`)
- Checkbox selection for batch operations
- "Add to feed" dropdown: pick a feed → `POST /api/inbox/route` with selected item IDs + feed ID
- Items disappear from inbox once routed to a feed

### 9. Sidebar Updates

Update the sidebar (from Phase 2) to:
- Show feeds list with unread count badges
- Show inbox with unread badge
- Feeds are clickable → navigate to feed view
- "New Feed" link in the feeds section
- Sources section remains as-is from Phase 2

### 10. Cross-Feed Status Sync

**Design decision:** When the same source item appears in multiple feeds, and a user marks it "done" in one feed, should it sync?

**Phase 3 approach:** Optional sync via a setting in feed config:
```jsonc
{
  "source_ids": [...],
  "auto_route": true,
  "sync_status": true  // when true, status changes propagate to this item in other feeds
}
```

**Implementation:**
When `updateFeedItemStatus` is called:
1. Get the `sourceItemId` from the feed item
2. If the feed has `sync_status: true` in config:
   - Find all other feed_items with the same `sourceItemId`
   - Check if THEIR feeds also have `sync_status: true`
   - Update matching feed_items to the same status

This is a soft convention, not an absolute rule. Users can have some feeds sync and others not.

### 11. Wire Import → Routing

Update the Phase 2 import flow to call the feed router after creating source items:

- `POST /api/import` → after `createSourceItems()`, add: `await routeItemsToFeeds(source.id, createdItemIds, userId)`
- `POST /api/sources/quick-add` → same pattern

---

## File Summary

| File | Type | Purpose |
|------|------|---------|
| `src/lib/feeds/router.ts` | NEW | Feed routing engine |
| `src/db/queries/sources.ts` | EDIT | Add `listUnroutedItems`, `countUnroutedItems` |
| `src/routes/api/feeds/index.ts` | NEW | Feeds CRUD API |
| `src/routes/api/feeds/$feedId.ts` | NEW | Single feed API |
| `src/routes/api/feeds/$feedId.items.ts` | NEW | Feed items API (list, update status/data) |
| `src/routes/api/inbox.ts` | NEW | Inbox API (list unrouted, assign to feed) |
| `src/routes/_protected/feeds/index.tsx` | NEW | Feeds list page |
| `src/routes/_protected/feeds/$feedId.tsx` | NEW | Feed view (primary consumption UI) |
| `src/routes/_protected/feeds/new.tsx` | NEW | Feed builder |
| `src/routes/_protected/feeds/$feedId/edit.tsx` | NEW | Feed editor |
| `src/routes/_protected/inbox.tsx` | NEW | Inbox page |
| `src/routes/_protected.tsx` | EDIT | Update sidebar with feeds + inbox |
| `src/routes/api/import.ts` | EDIT | Wire in feed routing after import |
| `src/routes/api/sources/quick-add.ts` | EDIT | Wire in feed routing after quick-add |

---

## Phase 3 Deliverables Checklist

- [ ] Feed routing engine routes items to matching feeds based on `config.source_ids`
- [ ] Feeds CRUD API complete
- [ ] Feed items API with pagination, status filter, status update, user data update
- [ ] Inbox API lists unrouted items, supports batch routing to a feed
- [ ] Feed list page shows all feeds with unread counts
- [ ] Feed view is the primary consumption UI — status tabs, item list, status controls
- [ ] Feed builder creates feed + backfills existing items from selected sources
- [ ] Inbox shows unrouted items with "add to feed" action
- [ ] Sidebar shows feeds with unread counts and inbox badge
- [ ] Import and quick-add automatically route items to matching feeds
- [ ] Cross-feed status sync works when enabled
- [ ] `bun run check-types` passes
- [ ] `bun run lint` passes
- [ ] Manual test: import bookmarks → create a feed with that source → see items in feed → mark some done → check inbox is empty (all items routed)
