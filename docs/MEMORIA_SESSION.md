# Memoria — Collaborative Session

A living document for our conversation. Dump thoughts, compile ideas, keep a running memory.

---

## Your Goals & Vision

_What you want Memoria to be. Share here and we'll refine as we go._

- **Primary**: Knowledge app — collects everything: links, articles, PDFs, podcasts, YouTube, movies, music, books, studies
- **Input**: Mostly links (to articles, PDFs, videos, etc.) + local data, API data, Twitter feeds
- **Mental models**: Bookmark/link aggregator × Google Reader (RSS) × podcast reader × knowledge base (Obsidian/Notion)
- **Scale**: Big — everything in one place
- **Integration**: Connect to Obsidian, Notion; silos may remain but Memoria could "take over any thoughts period"
- **Palace**: Headquarters of everything — not just one app in the stack
- **AI**: Involved but NOT the main focus. Main thing = **data management** (bookmarking-style)
- **Secondary use**: Test bed for library experimentation; translate ideas into work

---

## Data Model — Three Layers

**Full details → [SYSTEM_DESIGN.md](./SYSTEM_DESIGN.md)**

Quick reference:
1. **Source Payloads** — untouched raw data (inline or S3). Never modified.
2. **Source Items** — normalized individual items from a payload. No app metadata.
3. **Feed Items** — enriched, tracked, connected. Where Memoria adds value.

```
[Source Payload]  →  [Source Item]  →  [Feed Item(s)]
```

Plus a **source** table (configured input: RSS feed, API endpoint, scrape target, etc.) that owns payloads.

---

## Sources & Feeds (Concepts)

**Sources** = configured inputs (RSS, API, scrape, upload, extension, bookmark import, manual). Each produces payloads → source items.

**Feeds** = curated views built on top of source items. Combine sources, filter, track state.

**Why different:** Build UP from sources → feeds. Dynamic combination, shared state, graph/interconnection.

**Full source types, workflows, and table sketches → [SYSTEM_DESIGN.md](./SYSTEM_DESIGN.md)**

---

## Running Memory

_Ideas, decisions, places in the codebase, and threads we want to remember._

| Thing | Where / What |
|-------|--------------|
| Sources first, feeds on top | Architecture: ingest raw → build views |
| Knowledge = links + media + studies + feeds | Core data model |
| Embeddings schema | `apps/palace/src/db/schema/embeddings.ts` |
| AI chat at `/` | Query interface — secondary to data mgmt |
| Ingestion: OneTab, SensorBuddy, Chrome, CSV, API, extension | Source formats to support |
| Same item, multiple feeds, shared completion state | Feed design |
| Storage: inline + S3-compatible | Source payloads need both; Supabase Storage is S3-compatible |
| PDFs, media files are first-class | Not just links — binary content too |
| Scraping is a source type | One-shot or watched; same pipeline as everything else |
| SYSTEM_DESIGN.md created | Architecture, tables, workflows, UI surfaces |
| Connector engine | Configurable fetch/paginate/extract/filter/transform per source |
| **Elo** = expression language | Compiles to JS + SQL. Extraction, filtering, transforms, schemas, guards |
| Workflow Devkit (WDK) installed | `workflow@4.1.0-beta.60` — durable execution, retries, fan-out |
| Secrets → Supabase Vault | Encrypted at rest, per-source mapping via `source_secret` table |
| Variable context system | `_.source`, `_.state`, `_.run`, `_.secrets`, `_.env`, `_.response`, `_.item` |
| Expression languages researched | JEXL, JSONata, Filtron, Elo, JMESPath — Elo chosen |
| Elo+workflow exploration | `docs/EXPLORATION_ELO_WORKFLOWS.md` — "Elo is the brain, WDK is the body" |
| Implementation plan | `docs/IMPLEMENTATION.md` — schema, workflows, UI, build order |
| Two Elo dialects | Full (pipelines, JS-only) vs simple (feed filters, JS+SQL) |
| Run state between fetches | Last cursor, last ID, etc. — persisted on source row + snapshots in run log |
| source_run table | Audit log: status, pages, items, error, state before/after |

---

## Your Thoughts

_Raw notes, questions, half-baked ideas — whatever you want to capture._

---

## My Thoughts

_Reactions, implications, questions back, or things I'm synthesizing._

**Earlier:** Unified ingestion → queryable knowledge. Brain metaphor. Embeddings + chat fit.

**Now:** Three layers, not two. Source payloads (untouched) → source items (normalized, no app metadata) → feed items (enriched, tracked). The source items are the spine. Feed items are where Memoria's opinion lives.

**Connector engine:** This is the real muscle. Every source needs configurable fetch, pagination, extraction, filtering, transformation, and run state — all without hardcoding per-source logic. Expression languages (JEXL, JSONata, etc.) are the glue. The source config becomes a declarative description of "how to talk to this API." Run state + run log give you auditability and resumability. We own the core loop; a workflow engine can handle scheduling/retries/fan-out later.

---

## Compiled Ideas

_Things we've converged on or want to keep._

1. **Three layers** — Raw blob (untouched) → Source items (normalized, no app fields) → Feed items (enriched, tracked, connected).
2. **One source item, many feed items** — Same underlying thing can live in multiple feeds; completion/state syncs.
3. **Raw blob = receipt** — Never modify; always reprocessable.
4. **Graph-ready** — Plan for interconnection: links, sublinks, seen/not-seen, future LLM-derived edges.
5. **Layer 1 = "Source Payloads"** — name decided.
6. **Dual storage** — Small payloads inline (jsonb/text), large payloads (PDFs, media) in S3-compatible storage. Design for both from day one.
7. **ID strategy sketch** — Direct FK chain (source_payload → source_item → feed_item). Self-ref canonical_id for future dedup. Saved in doc, not committed yet.
8. **Connector engine** — Configurable source execution: fetch, paginate, extract, filter, transform, run state. Expression language as the glue. Details in SYSTEM_DESIGN.md.
9. **source_run table** — Audit/debug log per execution: status, pages fetched, items created, state snapshots, errors.
10. **Elo as expression language** — Compiles to JS (runtime eval) AND SQL (push filters to Postgres). Data paths, schemas, guards, pipeline operator. One language for extraction, filtering, transformation, and feed queries.
11. **WDK for durable execution** — Each source run = a durable workflow. Steps checkpoint; crashes resume mid-pagination. WDK handles retries, scheduling, fan-out. We own the Elo eval + connector logic inside.
12. **Supabase Vault for secrets** — Encrypted at rest (pgsodium). `source_secret` table maps `(source_id, secret_name) → vault_secret_id`. Decrypted at runtime, held in memory only, never logged.
13. **Variable context (`_`)** — Elo's `_` input varies by pipeline stage. Full map: source, state, run, secrets, env, response, item, items, prev.
14. **"Elo is the brain, WDK is the body"** — Pure data logic = Elo. Side effects = TypeScript + WDK. Boundary is side effects.
15. **Level 2 Elo** — Unify extract+filter+transform into one Elo pipeline expression per connector. Don't try to put workflows in Elo (Levels 3–4). See exploration doc.
16. **Build order** — Foundation (schema) → Manual ingestion (import/paste) → Feeds (views) → Connector engine (automation) → Polish.
17. **Phase 1 fully specified** — Step-by-step: schema files, drizzle.ts update, migration, query functions (every function listed), Zod validation, cascade delete, indexes, tests, deliverables checklist. Hand-off ready.

---

## Current State Snapshot

- **Repo**: Memoria (Turborepo monorepo)
- **App**: Palace (`apps/palace`) — TanStack Start, Vite, React 19, Supabase, Drizzle
- **What exists**: Auth (sign up, login, forgot password), AI chat at `/`, profiles, embeddings schema, form scaffolding
- **Status**: Minimal baseline, ready for real features
