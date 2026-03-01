---
name: Phase 2 Manual Ingestion
overview: Get data into Memoria without automation. Import UI (file upload + paste), format parsers (bookmarks, JSON, CSV, OPML), manual quick-add URL, source items list view, storage abstraction, and API routes for all ingestion workflows.
todos:
  - id: payload-store
    content: Create src/lib/storage/payload-store.ts — inline vs S3 abstraction with 256KB threshold
    status: pending
  - id: parser-bookmarks
    content: Create src/lib/connector/parsers/bookmarks.ts — Chrome HTML, OneTab JSON, SensorBuddy export
    status: pending
  - id: parser-json
    content: Create src/lib/connector/parsers/json.ts — generic JSON array + OneTab/SensorBuddy specific formats
    status: pending
  - id: parser-csv
    content: Create src/lib/connector/parsers/csv.ts — CSV with header detection, link-per-line fallback
    status: pending
  - id: parser-opml
    content: Create src/lib/connector/parsers/opml.ts — OPML import to create RSS sources
    status: pending
  - id: api-import
    content: Create POST /api/import route — multipart file upload + text paste endpoint
    status: pending
  - id: api-sources-crud
    content: Create /api/sources CRUD routes — list, get, create, update, delete
    status: pending
  - id: api-manual-add
    content: Create POST /api/sources/quick-add — single URL add with title fetch
    status: pending
  - id: route-import
    content: Create /import route — drop zone, paste area, format selector, recent imports list
    status: pending
  - id: route-sources-list
    content: Create /sources route — list all sources with item counts, type badges, last activity
    status: pending
  - id: route-source-detail
    content: Create /sources/$sourceId route — source detail with items list, payload history, edit form
    status: pending
  - id: route-source-new
    content: Create /sources/new route — create source form (name, type, config)
    status: pending
  - id: app-shell
    content: Update _protected layout with sidebar (feeds, sources, import, search links)
    status: pending
  - id: tests-parsers
    content: Create unit tests for all 4 parsers with fixture data (bookmarks HTML, JSON variants, CSV, OPML)
    status: pending
  - id: tests-integration
    content: Create integration tests for import flow, sources CRUD API, quick-add, and payload store (against local Supabase)
    status: pending
  - id: verify
    content: Type-check, lint, run full test suite, manual smoke test of all UI routes
    status: pending
isProject: false
---

# Phase 2: Manual Ingestion — Get Data In

**Prerequisite:** Phase 1 complete (all 7 tables, query functions, Zod schemas).

**Goal:** A user can import data (files, paste, single URLs) through the UI, see their sources and items, and manage them. No automation yet — everything is manual or upload-driven.

Full design context: [SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md), [IMPLEMENTATION.md](docs/IMPLEMENTATION.md).
Existing patterns to match: [src/routes/_protected/protected.tsx](apps/palace/src/routes/_protected/protected.tsx), [src/db/queries/sources.ts](apps/palace/src/db/queries/sources.ts).

---

## Architecture

```
User Action                 API Route                    Pipeline
─────────────              ─────────                    ────────
Upload file     →  POST /api/import          →  detect format → parse → store payload → create source items
Paste text      →  POST /api/import          →  detect format → parse → store payload → create source items
Quick-add URL   →  POST /api/sources/quick-add → fetch title  → store payload → create source item
Create source   →  POST /api/sources         →  just creates the source row (no items yet)
```

---

## Steps

### 1. Storage Abstraction — `src/lib/storage/payload-store.ts`

Decides whether to store a payload inline (jsonb column) or in S3-compatible storage (Supabase Storage).

```typescript
const INLINE_THRESHOLD = 256 * 1024; // 256KB

export interface StorePayloadResult {
  data: unknown | null;          // populated for inline
  storageKey: string | null;     // populated for S3
  storageBackend: "inline" | "s3";
  sizeBytes: number;
}

export async function storePayload(
  content: Buffer | string,
  options: { sourceId: string; format: string; mimeType?: string }
): Promise<StorePayloadResult>;

export async function retrievePayload(
  payload: { data: unknown; storageKey: string | null; storageBackend: string }
): Promise<unknown>;
```

**Implementation notes:**

- For inline: parse JSON/text content and store in `data` column
- For S3: upload to Supabase Storage bucket `source-payloads` with key `{sourceId}/{payloadId}/{filename}`
- `retrievePayload` reads from the appropriate backend based on `storageBackend`
- Create the `source-payloads` bucket via Supabase dashboard or migration
- For Phase 2, inline storage is sufficient for all text formats. S3 path should exist but can be a stub that throws "not yet implemented" for files above threshold until Supabase Storage is configured.

### 2. Format Parsers — `src/lib/connector/parsers/`

Each parser takes raw content and returns an array of normalized items ready for `createSourceItems`.

#### `bookmarks.ts` — Chrome/Firefox HTML Bookmarks

```typescript
export interface ParsedBookmark {
  url: string;
  title: string;
  folder?: string;       // folder path e.g. "Bookmarks Bar/Dev/React"
  addedAt?: string;      // from ADD_DATE attribute (Unix timestamp → ISO string)
  iconUri?: string;      // from ICON attribute (data URI)
}

export function parseBookmarksHtml(html: string): ParsedBookmark[];
```

**What it does:**

- Parse `<DT><A HREF="..." ADD_DATE="..." ICON="...">Title</A>` elements
- Track `<DT><H3>` for folder hierarchy (recursive DL nesting)
- Return flat array with folder path as a dot/slash-separated string
- Handle malformed HTML gracefully (bookmarks exports are notoriously messy)
- Use a simple HTML parser — no need for a full DOM. Regex or `DOMParser` via jsdom

#### `json.ts` — Generic JSON Import

```typescript
export interface ParsedJsonItem {
  url?: string;
  title?: string;
  data: Record<string, unknown>;  // the full original item
}

export function parseJsonImport(input: unknown): ParsedJsonItem[];
```

**What it does:**

- If input is an array, each element is an item
- If input is an object with a recognizable array field (`.items`, `.bookmarks`, `.tabs`, `.links`, `.data`), extract that
- For each item: look for common URL fields (`url`, `href`, `link`, `uri`) and title fields (`title`, `name`, `label`, `text`)
- OneTab format: text lines of `url | title` — detect and split
- SensorBuddy format: JSON with `tabs` array containing `{url, title, favIconUrl}` — detect and map
- Return the raw item as `data` for full fidelity, plus extracted `url` and `title` for the source_item

#### `csv.ts` — CSV Import

```typescript
export interface ParsedCsvItem {
  url?: string;
  title?: string;
  data: Record<string, unknown>;
}

export function parseCsvImport(csv: string): ParsedCsvItem[];
```

**What it does:**

- Use `papaparse` (add as dependency: `bun add papaparse @types/papaparse` in apps/palace)
- Auto-detect headers vs headerless
- If headers present: look for `url`/`link`/`href` and `title`/`name` columns
- If headerless and single column: treat each row as a URL (links-per-line)
- Return normalized items with `data` holding all columns

#### `opml.ts` — OPML Import (RSS subscription lists)

```typescript
export interface ParsedOpmlFeed {
  title: string;
  xmlUrl: string;      // the RSS feed URL
  htmlUrl?: string;     // the website URL
  category?: string;    // folder/category from OPML
}

export function parseOpml(xml: string): ParsedOpmlFeed[];
```

**What it does:**

- Parse OPML XML (standard format from podcast apps, RSS readers)
- Extract `<outline>` elements with `type="rss"` or `xmlUrl` attribute
- Track category hierarchy from nested `<outline>` elements
- **Special behavior:** OPML items become *sources* (type="rss"), not source items. Each feed URL becomes a new source that can later be automated in Phase 4. For Phase 2, create the sources with `isActive: false` and no schedule.

### 3. API Routes

#### `src/routes/api/sources/index.ts` — Sources CRUD

```
GET    /api/sources         → listSourcesByUser(userId)
POST   /api/sources         → validate(createSourceSchema) → createSource({...data, userId})
```

**Implementation:**

- Use `createAPIFileRoute` from TanStack Start
- Auth: get user from Supabase session (match pattern in `api/chat.ts`)
- POST validates with `createSourceSchema` from `src/lib/validation/sources.ts`
- Returns JSON

#### `src/routes/api/sources/$sourceId.ts` — Single Source

```
GET    /api/sources/:sourceId  → getSourceById(id) + verify ownership
PUT    /api/sources/:sourceId  → validate(updateSourceSchema) → updateSource(id, data)
DELETE /api/sources/:sourceId  → deleteSourceCascade(id)
```

#### `src/routes/api/sources/quick-add.ts` — Quick Add URL

```
POST   /api/sources/quick-add
Body:  { url: string, feedId?: string }
```

**Flow:**

1. Validate URL
2. Fetch page title: `HEAD` request → parse `<title>` from HTML, or fall back to og:title, or use URL hostname
3. Find or create a "manual" source for this user (one shared manual source per user, or create one per add)
4. `createSourcePayload({ sourceId, data: { url, title }, format: "json" })`
5. `createSourceItems([{ payloadId, sourceId, url, normalizedData: { title, url, fetchedAt }, sourceType: "manual" }])`
6. If `feedId` provided: `createFeedItems([{ feedId, sourceItemId }])`
7. Return the created source item

#### `src/routes/api/import.ts` — File Upload + Paste

```
POST   /api/import
Body:  multipart/form-data with:
  - file?: File
  - text?: string (pasted content)
  - format?: string (json | csv | bookmarks_html | opml | auto)
  - name?: string (source name, optional — defaults to filename or "Paste Import")
```

**Flow:**

1. Determine content: file upload (read bytes) or text paste
2. Detect format if `format=auto`:
  - File extension: `.json` → json, `.csv` → csv, `.html` → bookmarks_html, `.opml`/`.xml` → opml
  - Content sniffing: starts with `<!DOCTYPE NETSCAPE-Bookmark` → bookmarks_html, starts with `<?xml` with `<opml` → opml, starts with `[` or `{` → json, has commas/tabs with consistent columns → csv
3. Create source: `type` based on format (upload for files, bookmark_import for bookmarks, manual for paste)
4. Store payload via `storePayload()` → `createSourcePayload()`
5. Parse content via the appropriate parser
6. `createSourceItems()` with parsed items
7. **Special case — OPML:** Instead of source items, create new source rows (one per RSS feed found). Return list of created sources.
8. Return: `{ source, payload, itemCount, items: first10 }`

### 4. App Shell — Update Protected Layout

Convert `_protected.tsx` from a bare redirect guard to a layout with sidebar navigation.

**File: `src/routes/_protected.tsx`** — add `component` to the route config that renders the layout:

```
┌─────────────────────────────────────────────────┐
│  MEMORIA                             [user] [+]  │
├──────────┬──────────────────────────────────────┤
│          │                                       │
│ Inbox    │   <Outlet />                          │
│ Search   │                                       │
│          │                                       │
│ ─ Feeds  │                                       │
│ (empty)  │                                       │
│          │                                       │
│ ─ Sources│                                       │
│ (list)   │                                       │
│          │                                       │
│ Import   │                                       │
│ Settings │                                       │
└──────────┴──────────────────────────────────────┘
```

**Implementation:**

- Use shadcn-ui sidebar components if available, otherwise build with Tailwind
- Sidebar items: Inbox (disabled/placeholder until Phase 3), Search (disabled/placeholder until Phase 5), Feeds section (empty in Phase 2), Sources section (list from `listSourcesByUser`), Import, Settings (placeholder)
- Quick-add button `[+]` in top bar opens a popover/dialog for pasting a URL (calls quick-add API)
- `<Outlet />` renders the child route
- Sidebar data loads via TanStack Query — `useQuery` for sources list, invalidate on mutation

### 5. Import UI — `src/routes/_protected/import.tsx`

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
│  Format: [Auto-detect ▾]   Name: [____________]   │
│                                                   │
│  [Import]                                         │
│                                                   │
│  ── Recent imports ──                             │
│  bookmarks.html  •  2,341 items  •  Feb 15        │
│  onetab-export.json  •  89 items  •  Feb 10       │
└──────────────────────────────────────────────────┘
```

**Implementation:**

- Drop zone: HTML5 drag-and-drop + file input fallback
- Paste area: `<textarea>` with placeholder
- Format selector: dropdown with auto-detect default
- Name field: optional, defaults to filename or "Paste Import {date}"
- Import button: calls `POST /api/import`, shows progress/result
- Recent imports: query sources where `type in ('upload', 'bookmark_import')` ordered by `createdAt DESC`, show name + item count + date
- After successful import: navigate to the created source's detail page, or show a success toast with item count

### 6. Sources List — `src/routes/_protected/sources/index.tsx`

```
┌──────────────────────────────────────────────────┐
│  Sources                              [+ Add]     │
├──────────────────────────────────────────────────┤
│ 📁 Chrome Bookmarks Feb   Import   2,341 items    │
│    Feb 15 • one-shot                              │
│ ─────────────────────────────────────────────── │
│ 📁 OneTab Export           Upload   89 items       │
│    Feb 10 • one-shot                              │
│ ─────────────────────────────────────────────── │
│ 📁 Manual Links            Manual   12 items       │
│    Ongoing                                        │
└──────────────────────────────────────────────────┘
```

**Implementation:**

- TanStack Query: `useQuery(['sources'], () => fetch('/api/sources').then(r => r.json()))`
- Each row: source name, type badge, item count (from `countSourceItemsBySource`), date, active status
- Click → navigate to `/sources/{id}`
- `[+ Add]` → navigate to `/sources/new`
- Empty state: "No sources yet. Import some data or add a link."

### 7. Source Detail — `src/routes/_protected/sources/$sourceId.tsx`

Shows the source's info and its items.

```
┌──────────────────────────────────────────────────┐
│  ← Sources    Chrome Bookmarks Feb    [Edit] [🗑]  │
├──────────────────────────────────────────────────┤
│  Type: bookmark_import  •  Items: 2,341            │
│  Created: Feb 15, 2026  •  Status: inactive        │
│                                                    │
│  ── Items ──                                [search]│
│  ┌────────────────────────────────────────────┐    │
│  │ React Server Components Deep Dive          │    │
│  │ https://example.com/rsc-deep-dive          │    │
│  │ folder: Dev/React • imported Feb 15        │    │
│  ├────────────────────────────────────────────┤    │
│  │ Understanding TypeScript Generics          │    │
│  │ https://example.com/ts-generics            │    │
│  │ folder: Dev/TypeScript • imported Feb 15   │    │
│  └────────────────────────────────────────────┘    │
│                                                    │
│  [Load more]  Showing 1-50 of 2,341               │
└──────────────────────────────────────────────────┘
```

**Implementation:**

- TanStack Query: load source + items (paginated)
- Items: virtual list or load-more pagination (50 per page)
- Each item row: title (from `normalizedData.title`), URL, extra metadata from `normalizedData`
- Edit button → inline edit or navigate to edit form
- Delete button → confirm dialog → `deleteSourceCascade` → navigate back to sources list
- Item click → open original URL in new tab, or navigate to item detail (future)

### 8. Create Source — `src/routes/_protected/sources/new.tsx`

Simple form for creating a source manually.

**Fields:**

- Name (required)
- Type (dropdown: rss, api, scrape, upload, extension, bookmark_import, manual)
- Config (JSON editor for advanced users, or type-specific fields)

For Phase 2, this is a minimal form. Type-specific config editors come in Phase 4 when automation is added. The primary ingestion path in Phase 2 is the Import page, not this form.

---

## Dependencies to Add

```bash
cd apps/palace
bun add papaparse
bun add -D @types/papaparse
```

No other new dependencies needed. HTML parsing for bookmarks uses string manipulation or a lightweight approach (no full DOM parser needed for the simple bookmark format).

---

## File Summary


| File                                          | Type | Purpose                                    |
| --------------------------------------------- | ---- | ------------------------------------------ |
| `src/lib/storage/payload-store.ts`            | NEW  | Inline vs S3 storage abstraction           |
| `src/lib/connector/parsers/bookmarks.ts`      | NEW  | Chrome/Firefox HTML bookmark parser        |
| `src/lib/connector/parsers/json.ts`           | NEW  | Generic JSON + OneTab + SensorBuddy parser |
| `src/lib/connector/parsers/csv.ts`            | NEW  | CSV parser with papaparse                  |
| `src/lib/connector/parsers/opml.ts`           | NEW  | OPML feed list parser                      |
| `src/routes/api/sources/index.ts`             | NEW  | Sources CRUD API                           |
| `src/routes/api/sources/$sourceId.ts`         | NEW  | Single source API                          |
| `src/routes/api/sources/quick-add.ts`         | NEW  | Quick-add URL API                          |
| `src/routes/api/import.ts`                    | NEW  | File upload + paste API                    |
| `src/routes/_protected.tsx`                   | EDIT | Add sidebar layout with Outlet             |
| `src/routes/_protected/import.tsx`            | NEW  | Import UI page                             |
| `src/routes/_protected/sources/index.tsx`     | NEW  | Sources list page                          |
| `src/routes/_protected/sources/$sourceId.tsx` | NEW  | Source detail page                         |
| `src/routes/_protected/sources/new.tsx`       | NEW  | Create source page                         |


---

## Verification Strategy

Phase 2 has three layers that need different testing approaches.

### Layer 1: Parser Unit Tests (pure functions, no DB)

Each parser is a pure function: string in, structured data out. These are the easiest to test and the most important to get right — if parsing is wrong, everything downstream is wrong.

Create test files at `src/lib/connector/parsers/__tests__/`:

#### `bookmarks.test.ts`

Fixture: inline string of real Chrome `bookmarks.html` format (the `<!DOCTYPE NETSCAPE-Bookmark-file-1>` structure).


| Test case                 | What it verifies                                                               |
| ------------------------- | ------------------------------------------------------------------------------ |
| Standard Chrome export    | Extracts URLs, titles, ADD_DATE timestamps                                     |
| Folder hierarchy          | Nested `<DL>` produces correct folder paths (e.g. `"Bookmarks Bar/Dev/React"`) |
| Empty folders             | Folders with no bookmarks don't produce items                                  |
| Special characters        | Titles with `&`, `"`, unicode characters survive                               |
| Missing attributes        | Entries without `ADD_DATE` or `ICON` don't crash                               |
| Large file (100+ entries) | Parses without timeout, correct count                                          |
| Firefox format            | Minor structural differences from Chrome                                       |


#### `json.test.ts`


| Test case                                     | What it verifies                                               |
| --------------------------------------------- | -------------------------------------------------------------- |
| Plain array of `{url, title}`                 | Direct extraction                                              |
| Object with `.items` array                    | Detects nested items                                           |
| Object with `.bookmarks` array                | Detects nested bookmarks                                       |
| Object with `.tabs` array (SensorBuddy)       | Maps `{url, title, favIconUrl}`                                |
| OneTab text format (`url | title` per line)   | Detects line format, splits correctly                          |
| Single object (not array)                     | Wraps in array                                                 |
| Empty array                                   | Returns empty array, no crash                                  |
| Deeply nested data                            | Extracts URL/title from common field names at any depth        |
| Unknown structure (no recognizable URL field) | Returns items with `data` populated, `url` and `title` as null |


#### `csv.test.ts`


| Test case                      | What it verifies                            |
| ------------------------------ | ------------------------------------------- |
| With headers: `url,title,date` | Extracts by header name                     |
| With headers: `link,name`      | Detects `link` as URL field                 |
| Without headers (URLs only)    | Each line treated as a URL                  |
| Tab-separated                  | TSV works same as CSV                       |
| Quoted fields with commas      | `"Smith, John",http://...` parses correctly |
| Empty file                     | Returns empty array                         |
| One row                        | Returns single item                         |


#### `opml.test.ts`

Fixture: inline string of real OPML (Overcast/Pocket Casts export format).


| Test case                      | What it verifies                                              |
| ------------------------------ | ------------------------------------------------------------- |
| Standard podcast OPML          | Extracts `title`, `xmlUrl`, `htmlUrl`                         |
| Category hierarchy             | Nested `<outline>` produces correct category path             |
| Mixed outlines (RSS + non-RSS) | Only extracts entries with `xmlUrl` attribute                 |
| Empty OPML                     | Returns empty array                                           |
| Malformed XML                  | Fails gracefully with a useful error, doesn't throw unhandled |


### Layer 2: Integration Tests (real DB, match Phase 1 pattern)

Follow the pattern established in `src/db/__tests__/sources.test.ts` — run against local Supabase Postgres. Each test creates its own user profile, cleans up after itself.

#### `src/lib/storage/__tests__/payload-store.test.ts`


| Test case                       | What it verifies                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| Small payload stores inline     | Content < 256KB → `storageBackend: "inline"`, `data` populated, `storageKey` null                |
| Round-trip inline               | `storePayload` → `retrievePayload` returns identical content                                     |
| Large payload triggers S3 path  | Content > 256KB → `storageBackend: "s3"`, `storageKey` populated (or stub throws expected error) |
| Size bytes calculated correctly | `sizeBytes` matches actual content length                                                        |


#### `src/lib/connector/parsers/__tests__/import-flow.test.ts`

End-to-end integration test for the import pipeline (parser → payload → items):


| Test case                                 | What it verifies                                                                                                                                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bookmarks HTML → source + payload + items | Upload bookmarks → source created with `type: "bookmark_import"`, payload stored with `format: "html"`, correct number of source items created, each item has `url` and `normalizedData.title` |
| JSON array → source + payload + items     | Same flow for JSON input                                                                                                                                                                       |
| CSV links → source + payload + items      | Same flow for CSV                                                                                                                                                                              |
| OPML → creates source rows (not items)    | OPML import creates N source rows with `type: "rss"` and `isActive: false`, NOT source items                                                                                                   |
| Empty input → no items created            | Graceful handling, source and payload still created, zero items                                                                                                                                |
| Quick-add URL → source item               | POST a URL → source item created with `url` populated, `sourceType: "manual"`                                                                                                                  |


#### `src/routes/api/__tests__/sources-api.test.ts`

Test the API routes directly (call the handler functions, or use `fetch` against the dev server):


| Test case                              | What it verifies                |
| -------------------------------------- | ------------------------------- |
| `POST /api/sources` with valid data    | Returns 200 + created source    |
| `POST /api/sources` with invalid data  | Returns 400 + validation errors |
| `GET /api/sources`                     | Returns array of user's sources |
| `GET /api/sources/:id`                 | Returns single source           |
| `GET /api/sources/:id` with wrong user | Returns 404 (RLS)               |
| `PUT /api/sources/:id`                 | Updates and returns source      |
| `DELETE /api/sources/:id`              | Cascades delete, returns 200    |


### Layer 3: UI Smoke Tests (manual checklist)

These are walked through in the browser (manually or via browser automation). They verify the full stack — UI renders, API calls succeed, data appears.

```
PHASE 2 SMOKE TEST CHECKLIST
─────────────────────────────

Setup: dev server running (bun run dev), local Supabase running, logged in user

[ ] 1. SIDEBAR
    - Navigate to any protected route
    - Sidebar renders with: Inbox (disabled), Search (disabled), Sources, Import links
    - Sources section shows "No sources" empty state or existing sources

[ ] 2. CREATE SOURCE
    - Navigate to /sources/new
    - Fill in name: "Test Source", type: "manual"
    - Submit → redirects to source detail page
    - Source appears in sidebar sources list

[ ] 3. IMPORT — FILE UPLOAD
    - Navigate to /import
    - Drop zone and paste area are visible
    - Upload a Chrome bookmarks.html file (use a real export or the test fixture)
    - Progress indicator shows
    - Success: shows item count, navigates to source detail or shows toast
    - Source detail shows items list with titles and URLs

[ ] 4. IMPORT — PASTE
    - Navigate to /import
    - Paste JSON: [{"url":"https://example.com","title":"Test"}]
    - Format auto-detected as JSON
    - Submit → source created, 1 item
    - Verify item appears in source detail

[ ] 5. IMPORT — CSV LINKS
    - Paste plain text URLs (one per line)
    - Format detected as CSV or auto
    - Submit → items created, one per URL

[ ] 6. QUICK-ADD
    - Click [+] in top bar
    - Enter URL: https://github.com
    - Submit → source item created (verify title was fetched or URL used as fallback)

[ ] 7. SOURCES LIST
    - Navigate to /sources
    - All created sources visible with correct type badges and item counts
    - Click a source → navigates to detail page

[ ] 8. SOURCE DETAIL
    - Items list is paginated (if > 50 items)
    - "Load more" button works
    - Each item shows title, URL hostname, source type
    - Delete source → confirm dialog → source removed → redirected to /sources

[ ] 9. RECENT IMPORTS
    - Navigate to /import
    - "Recent imports" section shows the uploads/pastes from steps 3-5
    - Each shows name, item count, date
```

### Running It All

```bash
# 1. Static analysis
bun run check-types          # TypeScript — no errors
bun run lint                 # oxlint — no errors

# 2. Unit tests (parsers — fast, no DB needed)
bun run test -- --run src/lib/connector/parsers

# 3. Integration tests (needs local Supabase running)
bun run db:local:start       # if not already running
bun run test                 # full suite including Phase 1 + Phase 2

# 4. Manual smoke test
bun run dev                  # start dev server
# Walk through the checklist above in browser at localhost:3000
```

---

## Phase 2 Deliverables Checklist

**Code:**

- `payload-store.ts` — inline storage works, S3 stub exists
- All 4 parsers created and handle their respective formats
- `POST /api/import` accepts file upload and text paste, creates source + payload + items
- Sources CRUD API complete (list, get, create, update, delete)
- Quick-add URL endpoint works (fetches title, creates source item)
- App shell has sidebar navigation
- Import page: drop zone + paste + format detect + recent imports
- Sources list page: shows all sources with counts
- Source detail page: shows source info + paginated items
- Create source page: form works
- OPML import creates RSS source rows (inactive)

**Tests:**

- Parser unit tests: bookmarks (7 cases), JSON (9 cases), CSV (7 cases), OPML (5 cases)
- Integration tests: payload-store round-trip, import flow end-to-end, sources API CRUD
- All tests pass: `bun run test`

**Static analysis:**

- `bun run check-types` passes
- `bun run lint` passes

**Smoke test:**

- 9-point manual UI checklist completed (sidebar, create source, 3 import types, quick-add, sources list, source detail, recent imports)

