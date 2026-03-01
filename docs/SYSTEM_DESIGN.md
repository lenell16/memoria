# Memoria — System Design

Working design doc. Evolves as we talk. Linked from [MEMORIA_SESSION.md](./MEMORIA_SESSION.md).

---

## Data Model — Three Layers

### Layer 1: Source Payloads

The untouched payload as received. Never modified after storage.

- **Small payloads** (JSON, XML, CSV, HTML): stored inline (jsonb/text column)
- **Large payloads** (PDFs, media, big files): stored in S3-compatible object storage, row holds reference
- One per ingestion event

### Layer 2: Source Items

Individual items extracted and normalized from a payload. Format-converted (XML→JSON, CSV→JSON) but NO app-level fields. As close to the original item as possible.

- 1 source payload → N source items
- No Memoria-added metadata

### Layer 3: Feed Items

App-level representation. Where Memoria adds value.

- Tracking: seen/played/done
- Connections: IDs linking to other items, feeds, sources
- App metadata: tags, notes, user-added data
- Same source item → multiple feed items across feeds
- Completion/state syncs across feeds

### How They Stack

```
[Source Payload]  →  [Source Item]  →  [Feed Item(s)]
   (untouched)        (normalized)      (enriched, tracked, connected)
   1 per ingest        N per payload     N per source item (across feeds)
```

---

## Source Types

Each source type describes HOW data enters Memoria. A source has a type, config, and schedule (or is manual).

| Source Type | Input | Schedule | Notes |
|-------------|-------|----------|-------|
| **RSS** | Feed URL | Polling (5m, 15m, etc.) | Standard XML→JSON normalization |
| **API** | Endpoint + auth | Polling or webhook | Twitter, YouTube Data API, etc. |
| **Scrape** | URL + selectors | Polling or one-shot | Extract structured data from pages |
| **Upload** | File (JSON, CSV, OPML, PDF, media) | Manual | Bulk import, one-off files |
| **Extension** | JSON from browser extension | Push (realtime) | Special priority; session-buddy/one-tab style |
| **Bookmark Import** | Chrome/Firefox export, OneTab, SensorBuddy | Manual (one-shot) | CSV or JSON; bulk historical data |
| **Manual** | Single link / note / paste | Manual | Quick-add from UI |

### Source Configuration (conceptual)

A "source" row describes a configured input:

```
source
  id
  name ("My YouTube Subs", "HN Front Page", "Chrome Export Jan 2026")
  type (rss | api | scrape | upload | extension | bookmark_import | manual)
  config (jsonb — URL, selectors, auth, format hints, etc.)
  schedule (jsonb, nullable — polling interval, cron, or null for manual)
  is_active (boolean)
  last_fetched_at
  created_at
```

Each time a source runs (or receives data), it creates a **source payload** and extracts **source items** from it.

### Scraping as a Source Type

Scrapes are sources with extra config: CSS selectors, extraction rules, maybe a template. They can be:

- **One-shot**: "Scrape this page right now" → payload → items
- **Watched**: "Check this page every hour for changes" → periodic payloads

Scrape results are source payloads like anything else. The extracted items are source items. No special treatment downstream.

---

## Ingestion Workflows

### Workflow 1: Polled Source (RSS, API, Scrape)

```
[Schedule triggers]
  → Fetch URL / call API / run scrape
  → Store response as source_payload (inline or S3)
  → Parse payload → create source_items (normalized)
  → For each feed that includes this source:
      → Apply feed filters
      → Create feed_items for matching source_items
```

### Workflow 2: Push Source (Extension)

```
[Extension sends JSON to Memoria API]
  → Store JSON as source_payload
  → Parse → create source_items
  → Route to feeds (extension feed, or user-configured)
```

### Workflow 3: Upload / Import (Bulk)

```
[User uploads file via UI]
  → Store file as source_payload (S3 for large, inline for small)
  → Parse format (CSV, JSON, OPML, bookmark HTML)
  → Create source_items (one per entry)
  → Optionally route to feeds or leave as unassigned source items
```

### Workflow 4: Manual Add

```
[User pastes link or note in UI]
  → Create source_payload (minimal — just the URL/text)
  → Create source_item
  → Add to specified feed(s) or inbox
```

---

## Database Tables (Sketch — Not Final)

Direction: Direct FK chain. Source payloads → source items → feed items.

```sql
-- Where data comes from (configured input)
source
  id              uuid PK
  user_id         uuid FK → profiles
  name            text
  type            text (rss, api, scrape, upload, extension, bookmark_import, manual)
  config          jsonb
  schedule        jsonb nullable
  is_active       boolean default true
  last_fetched_at timestamptz nullable
  created_at      timestamptz
  updated_at      timestamptz

-- Raw payload per ingestion event
source_payload
  id              uuid PK
  source_id       uuid FK → source
  data            jsonb nullable (inline storage for small payloads)
  storage_path    text nullable (S3 path for large payloads)
  storage_backend text default 'inline' (inline | s3)
  format          text (json, xml, csv, html, pdf, media, etc.)
  mime_type       text nullable
  size_bytes      integer nullable
  ingested_at     timestamptz

-- Individual normalized item from a payload
source_item
  id              uuid PK
  payload_id      uuid FK → source_payload
  source_id       uuid FK → source (denormalized for fast queries)
  canonical_id    uuid FK → source_item nullable (self-ref, future dedup)
  url             text nullable
  normalized_data jsonb
  source_type     text (rss_entry, bookmark, api_item, scraped_item, etc.)
  created_at      timestamptz

-- User-defined feed (curated view over sources)
feed
  id              uuid PK
  user_id         uuid FK → profiles
  name            text
  description     text nullable
  sources         jsonb (which source IDs feed into this, filter rules, etc.)
  created_at      timestamptz
  updated_at      timestamptz

-- App-level item in a feed
feed_item
  id              uuid PK
  feed_id         uuid FK → feed
  source_item_id  uuid FK → source_item
  status          text default 'unseen' (unseen, seen, in_progress, done, archived)
  user_data       jsonb nullable (notes, tags, highlights, etc.)
  created_at      timestamptz
  updated_at      timestamptz
```

### Supporting Tables (Future)

```
-- For graph/connections between items
item_edge (future)
  id, from_item_id, to_item_id, edge_type, metadata, created_at

-- For LLM-derived tags/classifications
item_tag (future)
  id, source_item_id, tag, confidence, source (user | llm), created_at
```

---

## UI Surfaces (To Think Through)

| Surface | Purpose | Status |
|---------|---------|--------|
| **Feed view** | Read/browse a feed's items, mark done, filter | Core — first UI to build |
| **Sources manager** | Add/edit/toggle sources, see last fetch status | Core |
| **Inbox / unsorted** | Items that arrived but aren't in a feed yet | Likely needed |
| **Import** | Upload files, paste bulk data | Core |
| **Search** | Full-text + filter over all source items | Core |
| **Item detail** | Single item view with metadata, connections, notes | Core |
| **Feed builder** | Combine sources, set filters, preview | Important |
| **AI chat** | Query knowledge base (already exists at `/`) | Exists — evolve later |
| **Graph view** | Visualize connections between items | Future |

---

## Connector Engine — Extensible Source Execution

The core problem: every API/feed/scrape paginates differently, authenticates differently, returns data in a different shape, and needs different state between runs. We need a **configurable connector engine** that handles all of this without hardcoding per-source logic.

### What a Connector Needs to Know

For any source that fetches data, the config must encode:

| Concern | What it answers | Example |
|---------|----------------|---------|
| **Fetch** | How do I make the request? | URL template, method, headers, auth |
| **Pagination** | How do I get the next page? | Cursor, offset, page number, Link header |
| **Extraction** | Where are the items in the response? | Path into the response JSON |
| **Filtering** | Which items do I keep? | Expression evaluated per item |
| **Transform** | How do I normalize each item? | Field mappings |
| **Termination** | When am I done paginating? | No more items, cursor is null, max pages reached |
| **Run state** | What do I carry between runs? | Last cursor, last timestamp, last seen ID |

### Expression Language: Elo

**Decision: Elo** (`@enspirit/elo`) as the primary expression language.

Elo is a portable expression language that compiles to **JavaScript, Ruby, Python, and SQL**. The multi-target compilation is the killer feature: write an expression once, run it in JS at ingestion time, and compile the same expression to SQL for database queries (feed filters, search).

**Why Elo over alternatives:**

| Library | Compiles to JS | Compiles to SQL | Data schemas | Data paths | Verdict |
|---------|:-:|:-:|:-:|:-:|---------|
| **Elo** | Yes | Yes | Yes | Yes | **Winner** — one language for everything |
| JEXL | Yes | No | No | No | Simpler but JS-only; can't push to DB |
| JSONata | Yes | No | No | Yes | Powerful transforms but JS-only |
| Filtrex/Filtron | Yes | No | No | No | Filtering only |
| JMESPath | Yes | No | No | Yes | Query only, no transforms |

**What Elo gives us:**

- **Extraction**: Data paths — `.response.data.items` to reach into nested responses
- **Filtering**: `_.type != 'retweet'` — evaluates per item in JS, compiles to SQL WHERE clause
- **Transformation**: Pipeline operator — `_.title | trim | upper`, lambda maps, let bindings
- **Validation**: Data schemas — define expected shape of a source's items, coerce types
- **Guards**: Runtime assertions — `guard _.url != null in ...` for fail-fast
- **Date/Duration first-class**: `NOW`, `TODAY`, `P7D`, date arithmetic built-in
- **Null handling**: `_.description | 'no description'` (alternative/fallback operator)

**The JS + SQL dual compilation is the real differentiator:**

```
Feed filter: "_.type == 'podcast' and _.duration > PT30M"

At ingestion (JS):  compile('...') → function that filters source items in Node
At query time (SQL): compileToSQL('...') → WHERE clause pushed to Postgres
```

This means feed filters are fast at scale — they don't need to load all items into JS to filter. The DB does the work.

**Other libraries researched (kept for reference):** JEXL, JSONata, Filtrex/Filtron, JMESPath. Could still be useful as lightweight alternatives for specific narrow cases, but Elo covers all the needs in one language.

### Variable Context System

Every Elo expression runs against a context — the `_` input variable. The context changes depending on WHERE in the pipeline the expression runs.

**Context layers:**

| Context var | Available where | What it contains |
|-------------|----------------|-----------------|
| `_.source` | Everywhere | Source config: name, type, URL, schedule |
| `_.state` | Fetch, pagination, run_state.update | Persisted run state: last_cursor, last_timestamp, last_id, counters |
| `_.run` | Everywhere during a run | Current run info: run_id, started_at, page_number, items_so_far |
| `_.secrets` | Fetch (headers, params) | Resolved secrets: API keys, tokens, passwords |
| `_.env` | Everywhere | Environment-level: base URLs, feature flags, user prefs |
| `_.response` | After fetch, pagination, extraction | HTTP response: body (parsed), headers, status_code |
| `_.item` | Filter, transform | Current individual item being processed |
| `_.items` | run_state.update, post-extraction | All items extracted from current page |
| `_.prev` | Fetch (after first page) | Previous page's response (for delta comparison) |

**How context builds up through the pipeline:**

```
1. FETCH
   Context: { source, state, run, secrets, env }
   Used in: URL templates, headers, query params

2. RESPONSE RECEIVED
   Context adds: { response }
   Used in: pagination expressions

3. EXTRACTION
   Context: { source, state, run, response }
   Expression: extraction.items_path → e.g. ".response.data.posts"

4. FILTER (per item)
   Context: { source, state, run, item, env }
   Expression: e.g. "_.item.type != 'retweet'"

5. TRANSFORM (per item)
   Context: { source, state, run, item, env }
   Expression: e.g. "{ title: _.item.title | trim, url: _.item.link }"

6. PAGINATION
   Context: { source, state, run, response, items }
   Expression: e.g. "_.response.meta.next_cursor"

7. RUN STATE UPDATE
   Context: { source, state, run, items }
   Expression: e.g. "max(_.items, i ~ i.id)"
```

**Where each variable comes from (source of truth):**

| Variable | Source of truth | Loaded from |
|----------|----------------|-------------|
| `source` | `source` table | DB at run start |
| `state` | `source.run_state` column (jsonb) | DB at run start, updated at run end |
| `run` | `source_run` table row | Created at run start |
| `secrets` | Supabase Vault (see below) | Decrypted at run start, held in memory only |
| `env` | Environment config (TBD) | Loaded at app start |
| `response` | HTTP fetch result | Built per request |
| `item` | Extracted from response | Built per item in the loop |
| `items` | All extracted items for current page | Built per page |

### Pagination Strategies

Each source's config declares its pagination strategy:

```jsonc
// Cursor-based (Twitter, many modern APIs)
{
  "type": "cursor",
  "cursor_path": "response.meta.next_token",     // expression: where to find next cursor
  "cursor_param": "pagination_token",              // query param name to send it as
  "done_when": "response.meta.next_token == null"  // expression: when to stop
}

// Offset-based
{
  "type": "offset",
  "offset_param": "offset",
  "limit_param": "limit",
  "limit": 100,
  "total_path": "response.total",                  // optional: total count from response
  "done_when": "items.length == 0"
}

// Page-number
{
  "type": "page",
  "page_param": "page",
  "done_when": "response.page >= response.total_pages"
}

// Link-header (GitHub, standard REST)
{
  "type": "link_header",
  "done_when": "!headers.link.next"
}

// None (single request)
{
  "type": "none"
}
```

### Source Config Shape (Full — with Elo expressions)

```jsonc
{
  "fetch": {
    "url": "https://api.example.com/v1/posts",
    "method": "GET",
    "headers": {
      "Authorization": "'Bearer ' + _.secrets.api_key"    // Elo expression
    },
    "params": {
      "since": "_.state.last_fetched_id"                  // Elo: from persisted run state
    }
  },
  "pagination": {
    "type": "cursor",
    "cursor_path": ".response.meta.next_cursor",           // Elo data path
    "cursor_param": "cursor",
    "done_when": "_.response.meta.next_cursor == null"     // Elo expression
  },
  "extraction": {
    "items_path": ".response.data.posts",                  // Elo data path
    "item_url": ".url",                                    // relative to each extracted item
    "item_id": ".id"                                       // for dedup between runs
  },
  "filter": "_.item.type != 'retweet'",                   // Elo: evaluated per item
  "transform": {                                           // Elo: field mapping per item
    "title": "_.item.title | trim",
    "url": "_.item.link",
    "published_at": "_.item.created_at",
    "summary": "_.item.text | slice(0, 200)"
  },
  "run_state": {
    "carry": ["last_fetched_id", "last_run_at"],
    "update": {
      "last_fetched_id": "_.items | map(i ~ i.id) | max",
      "last_run_at": "NOW"
    }
  }
}
```

### Run State & Run Log

Between runs, we need to track:

```
source_run
  id              uuid PK
  source_id       uuid FK → source
  started_at      timestamptz
  finished_at     timestamptz nullable
  status          text (running, completed, failed, partial)
  pages_fetched   integer
  items_created   integer
  error           text nullable
  state_before    jsonb (snapshot of run state going in)
  state_after     jsonb (snapshot of run state coming out)
  payload_ids     uuid[] (payloads created during this run)
```

The `source` table gets a `run_state` jsonb column that holds the current state (last cursor, last timestamp, etc.). Each run snapshots it before/after.

This gives you:
- **Auditability**: what happened on each run
- **Resumability**: if a run fails mid-pagination, you know where it stopped
- **Debugging**: compare state_before vs state_after, check error, see how many pages/items

### Execution Flow (Polled Source with Pagination)

```
1. Load source config + current run_state
2. Create source_run (status: running)
3. Build first request from config.fetch + run_state vars
4. LOOP:
   a. Execute request
   b. Store raw response as source_payload
   c. Extract items via config.extraction.items_path
   d. Filter items via config.filter expression
   e. Normalize via config.transform expressions
   f. Create source_items
   g. Evaluate pagination: get next cursor/offset
   h. Evaluate config.pagination.done_when → if true, break
   i. Build next request with pagination params
5. Update run_state via config.run_state.update expressions
6. Update source_run (status: completed, stats)
7. Route new source_items to feeds
```

### Workflow Engine: Vercel Workflow Devkit (WDK)

**Already installed:** `"workflow": "^4.1.0-beta.60"` in `apps/palace/package.json`.

WDK provides durable, long-running workflows with two directives: `use workflow` (defines a durable function) and `use step` (marks a unit of work that persists and retries). Workflows survive crashes, deployments, and can pause for arbitrary durations.

**What WDK handles for us:**

| Concern | WDK | Us |
|---------|-----|-----|
| Durable execution (survives crashes) | Yes | — |
| Automatic retries with backoff | Yes | — |
| Step-level persistence (resume where stopped) | Yes | — |
| Scheduling / cron | Yes (sleep, webhooks) | — |
| Fan-out (parallel source runs) | Yes | — |
| Multi-step pipelines (fetch → enrich → embed) | Yes | — |
| Source config & Elo expression eval | — | Yes |
| Pagination loop logic | — | Yes |
| Run state management | — | Yes (DB) |
| Feed routing | — | Yes |

**How a source run maps to WDK:**

```typescript
// conceptual — not final code
async function runSource(sourceId: string) {
  "use workflow";

  const source = await loadSource(sourceId);       // "use step"
  const secrets = await loadSecrets(source);        // "use step"
  const state = source.run_state;

  let page = 0;
  let cursor = state?.last_cursor;

  while (true) {
    const response = await fetchPage(source, cursor, secrets);  // "use step" — durable
    const payload = await storePayload(source, response);       // "use step"
    const items = extractAndFilter(source, response);           // pure Elo eval
    await storeSourceItems(payload, items);                     // "use step"
    await routeToFeeds(source, items);                          // "use step"

    cursor = evalElo(source.config.pagination.cursor_path, { response });
    if (evalElo(source.config.pagination.done_when, { response, items })) break;
    page++;
  }

  await updateRunState(source, items);                          // "use step"
}
```

Each `"use step"` is a checkpoint. If the workflow crashes mid-pagination on page 7, it resumes from the last completed step — it doesn't re-fetch pages 1–6.

**What we own:** The connector logic — Elo evaluation, context building, pagination decisions, source config interpretation. WDK wraps it in durability. Clean separation.

---

## Secrets Management

### The Problem

Sources need credentials: API keys, OAuth tokens, bearer tokens, passwords. These must be:
- Encrypted at rest
- Never logged or exposed in run logs
- Resolvable at runtime by the connector engine
- Manageable per-source (each source can have different keys)

### Recommendation: Supabase Vault (primary) + source_secret table (mapping)

**Supabase Vault** is already in the stack. It uses `pgsodium` for authenticated encryption at rest. Secrets are stored encrypted in `vault.secrets`, decrypted on-the-fly via the `vault.decrypted_secrets` view. The encryption key is managed by Supabase and never exposed to SQL.

**Architecture:**

```
source.config references secrets by name:
  "Authorization": "'Bearer ' + _.secrets.api_key"

source_secret maps names to vault IDs:
  source_id + secret_name → vault_secret_id

vault.secrets stores the actual encrypted value:
  vault_secret_id → encrypted blob

At runtime:
  1. Load source config
  2. Find which secret names the config references
  3. Look up vault IDs via source_secret
  4. Decrypt via vault.decrypted_secrets view
  5. Inject into Elo context as _.secrets
  6. NEVER persist decrypted values; hold in memory only for the run
```

**Tables:**

```sql
source_secret
  id              uuid PK
  source_id       uuid FK → source
  secret_name     text (e.g. 'api_key', 'oauth_token')
  vault_secret_id uuid FK → vault.secrets
  created_at      timestamptz
  updated_at      timestamptz
  UNIQUE(source_id, secret_name)
```

### Why Supabase Vault over alternatives

| Option | Encrypted at rest | Per-source | UI manageable | In our stack | Verdict |
|--------|:-:|:-:|:-:|:-:|---------|
| **Supabase Vault** | Yes (pgsodium) | Yes (via mapping) | Yes (Supabase dashboard + our UI) | Yes | **Primary choice** |
| Encrypted column (DIY) | Manual (we manage key) | Yes | Yes | Partial | Fallback if Vault insufficient |
| External (HashiCorp, AWS SM, Doppler) | Yes | Yes | Separate UI | No — new service | Future option for prod/team use |
| Env vars | No | No (global) | No | Yes | Not viable — can't be per-source |

### Security rules

- Decrypted secrets NEVER written to: run logs, source_run state snapshots, source_payload data, error messages
- Secret values held in memory only during execution, then discarded
- Vault access gated by Supabase RLS — only the source owner's session can decrypt their secrets
- Source configs store secret *references* (`_.secrets.api_key`), never raw values

### Future: OAuth provider integration

For sources that use OAuth (Twitter, YouTube, etc.), we'll eventually need:
- OAuth flow UI (connect account)
- Token refresh logic (refresh tokens before they expire)
- Token storage in Vault (access_token + refresh_token as secrets)

This plugs into the same architecture: the OAuth tokens live in Vault, `source_secret` maps them, and the connector engine resolves them at runtime. The refresh logic could be its own WDK workflow.

---

## Open Design Questions

- **Elo prototyping**: Need to verify Elo's SQL compilation covers our filter/query patterns. Test with real feed filter scenarios.
- **Feed filter DSL**: Elo expressions compiled to SQL for DB-level filtering? Or simpler UI-driven rules that generate Elo?
- Dedup strategy: when same URL arrives from multiple sources, how/when to merge?
- Extension protocol: what JSON shape does the browser extension send?
- Scrape templates: reusable extraction configs? Or per-source?
- Offline/sync: any mobile or offline concerns?
- Processing pipeline: where does LLM enrichment (tagging, summarization, embedding) plug in?
- **WDK local vs deployed**: Local World uses `.workflow-data/` storage. What's the self-host story for production?
