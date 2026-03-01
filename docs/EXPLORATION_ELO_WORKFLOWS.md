# Exploration: Elo-Native Workflows

An exploratory thought exercise on embedding workflow/pipeline capabilities into Elo, and whether that's a good idea.

**Status:** Exploration — not a decision. Written to stress-test the idea before committing to an architecture.

---

## Context: What We Have Today

The current design has a clean separation of concerns:

| Layer | Tool | Responsibility |
|-------|------|----------------|
| **Durable execution** | WDK | Retry, checkpoint, crash recovery, scheduling |
| **Pipeline logic** | TypeScript | Orchestrates fetch → extract → filter → transform → store |
| **Expression evaluation** | Elo | Data paths, filtering, transforms, validation inside each step |
| **Configuration** | JSON (with Elo strings) | Declares how a connector fetches, paginates, extracts, etc. |

A connector config is a JSON object with Elo expressions embedded as strings:

```jsonc
{
  "fetch": {
    "url": "https://api.example.com/v1/posts",
    "headers": { "Authorization": "'Bearer ' + _.secrets.api_key" }
  },
  "extraction": { "items_path": ".response.data.posts" },
  "filter": "_.item.type != 'retweet'",
  "transform": {
    "title": "_.item.title | trim",
    "url": "_.item.link"
  }
}
```

The TypeScript runtime reads this JSON, calls `compile()` on each Elo string at the appropriate pipeline stage, and invokes the compiled functions with the right context. WDK wraps the whole thing in durability.

**The question:** Could Elo do more than fill in the blanks? Could it describe the pipeline itself?

---

## What Elo Actually Is (and Isn't)

Grounding the exploration in Elo's real capabilities:

**What Elo has:**
- Pure expression language (everything returns a value)
- Pipe operator (`|>`) for chaining
- `let...in` bindings for local variables
- `if...then...else` conditionals
- Lambdas (`fn(x ~ x * 2)`) and higher-order functions (`map`, `filter`, `reduce`)
- Tuples (like JS objects) and Lists
- Data paths (`.response.data.items`)
- Data schemas (validation + type coercion)
- Guards (runtime assertions)
- First-class dates, durations
- `_` as implicit input
- Compiles to JS, Ruby, Python, SQL

**What Elo does NOT have:**
- Side effects (no I/O, no HTTP, no DB writes)
- Statements (no sequential execution)
- Loops (functional iteration via `map`/`filter` only)
- Async/await
- Error handling (guards throw, but no try/catch)
- Mutable state
- Module system or imports
- Any concept of durability, retries, or checkpointing

This is by design. Elo is a **data transformation language**, not a general-purpose programming language. Its power comes from what it *can't* do — the constraints make it safe, portable, and SQL-compilable.

---

## The Spectrum of Possibilities

Five levels, from conservative to radical.

### Level 0: Status Quo — JSON Config + Elo Expressions

What we have now. JSON structure defines the pipeline shape. Elo strings handle the dynamic parts.

```jsonc
{
  "filter": "_.item.type != 'retweet' and _.item.created_at > TODAY - P7D",
  "transform": {
    "title": "_.item.title | trim",
    "url": "_.item.link",
    "published_at": "_.item.created_at"
  }
}
```

**Strengths:** Simple. JSON is universal. Each Elo expression is small and testable in isolation. Clear boundary between structure (JSON) and logic (Elo).

**Weaknesses:** Elo expressions are opaque strings inside JSON — no type checking across expressions, no composition, no shared variables between pipeline stages. Duplicated context (the `_.item.` prefix repeated everywhere). The JSON structure is a parallel schema that the TypeScript runtime has to interpret.

---

### Level 1: Elo as Connector Config — Replace JSON with Elo Tuples

Instead of JSON-with-Elo-strings, write the entire connector config as an Elo program. The config *is* an Elo expression that evaluates to a tuple.

```elo
let api_key = _.secrets.api_key in
{
  fetch: {
    url: 'https://api.example.com/v1/posts',
    method: 'GET',
    headers: { Authorization: 'Bearer ' + api_key },
    params: { since: _.state.last_fetched_id }
  },
  pagination: {
    cursor_path: .response.meta.next_cursor,
    cursor_param: 'cursor',
    done_when: fn(ctx ~ ctx.response.meta.next_cursor == null)
  },
  extraction: {
    items_path: .response.data.posts,
    item_id: .id,
    item_url: .url
  },
  filter: fn(item ~ item.type != 'retweet'),
  transform: fn(item ~ {
    title: item.title | trim,
    url: item.link,
    published_at: item.created_at,
    summary: item.text | slice(0, 200)
  }),
  run_state_update: fn(ctx ~ {
    last_fetched_id: ctx.items | map(i ~ i.id) | max,
    last_run_at: NOW
  })
}
```

**What changes:** The connector config is one coherent Elo program. Shared variables via `let...in`. Lambdas instead of expression strings. Data paths are first-class values, not strings in JSON.

**What stays the same:** The TypeScript runtime still interprets this structure. It still calls each part at the appropriate pipeline stage. WDK still provides durability. The Elo program *describes* the connector — it doesn't *execute* it.

**Assessment:** Modest improvement. You gain composition (`let` bindings), lambdas that the Elo compiler can type-check, and data paths as values. You lose JSON's universality (harder to generate from a UI form builder). Net: probably worth it for power users writing configs by hand, but the JSON approach is better for UI-generated configs. **Could support both** — the UI generates JSON, power users write Elo, both get interpreted by the same runtime.

---

### Level 2: Elo Pipeline Expressions — Describe the Data Flow

Use Elo's pipe operator to express the extract → filter → transform chain as a single composed expression, rather than separate config fields.

```elo
let
  extract = fn(response ~ fetch(response, .data.posts)),
  keep = fn(item ~ item.type != 'retweet' and item.created_at > TODAY - P7D),
  normalize = fn(item ~ {
    title: item.title | trim,
    url: item.link,
    published_at: item.created_at,
    summary: item.text | slice(0, 200)
  })
in
  _.response
    |> extract
    |> filter(keep)
    |> map(normalize)
```

This is genuinely nice. The pipeline reads top-to-bottom: take the response, extract items, filter, transform. Elo's pipe operator was designed for exactly this kind of chaining.

**But notice what's missing:** The fetch. The pagination. The store. The side effects. This expression only works on data that's *already in memory*. It can't make HTTP requests or write to a database. It handles steps 3–5 of the pipeline (extract, filter, transform) but not steps 1–2 (fetch, paginate) or step 6 (store).

**Assessment:** This is Elo doing what Elo is good at — pure data transformation. It's a real improvement over having separate `extraction.items_path`, `filter`, and `transform` config fields. These three steps are naturally a pipeline and Elo can express them as one. **Recommended as an enhancement** to the current config format:

```jsonc
{
  "fetch": { "url": "...", "headers": { ... } },
  "pagination": { ... },
  "pipeline": "_.response |> fetch(_, .data.posts) |> filter(i ~ i.type != 'retweet') |> map(i ~ { title: i.title | trim, url: i.link })",
  "run_state_update": { ... }
}
```

One Elo expression replaces three config fields. The pipeline is one readable chain. The side-effectful parts (fetch, pagination, store) stay in JSON/TypeScript.

---

### Level 3: Elo with Effect Declarations — Describe What, Not How

What if Elo could *declare* side effects without *performing* them? The expression describes the desired workflow; the runtime interprets and executes it durably.

Hypothetical syntax (this does NOT exist in Elo today):

```elo
let
  response = effect('http.get', {
    url: 'https://api.example.com/v1/posts',
    headers: { Authorization: 'Bearer ' + _.secrets.api_key },
    params: { since: _.state.last_fetched_id }
  }),
  items = response.data.posts
    |> filter(i ~ i.type != 'retweet')
    |> map(i ~ {
      title: i.title | trim,
      url: i.link,
      published_at: i.created_at
    }),
  stored = effect('db.store_items', { items: items })
in
  {
    items_count: size(items),
    last_id: items | map(i ~ i.id) | max
  }
```

The `effect()` calls are markers — they don't execute inline. A runtime reads the expression's AST, finds the effect nodes, and executes them as durable WDK steps. The Elo expression becomes a *workflow description* that the engine interprets.

**This is essentially building an effect system into Elo.** Effect systems are powerful (see Haskell's IO monad, algebraic effects in Unison/Koka) but they fundamentally change what a language is.

**Problems:**
1. **Elo can't do this today.** This requires language-level changes (new AST nodes, new semantics). We'd be forking Elo or convincing upstream to add effect primitives.
2. **Sequential dependency.** `items` depends on `response` which depends on the HTTP effect resolving. Elo has no sequencing — `let` bindings are conceptually simultaneous. We'd need to enforce ordering, which fights Elo's functional nature.
3. **Pagination.** Where does the pagination loop go? Elo has no loops. You could model it recursively, but recursive effects are complex to make durable.
4. **SQL compilation breaks.** Effects can't compile to SQL. The "write once, run in JS and SQL" promise — Elo's killer feature for us — would only apply to the pure sub-expressions, not the workflow as a whole.

**Assessment:** Intellectually interesting. Practically, you're building a new language on top of Elo's syntax. The result would be more complex than TypeScript + Elo without being more capable. **Not recommended** unless Elo upstream builds an effect system.

---

### Level 4: Elo as a Full Workflow Language — The Radical Option

Go all the way. Elo gains HTTP primitives, database operations, loops, error handling, and durability annotations. A connector is a self-contained Elo program:

```
-- HYPOTHETICAL — this is NOT real Elo

workflow fetch_posts(source, secrets, state) do
  let response = step "fetch" do
    http.get(source.url, {
      headers: { Authorization: 'Bearer ' + secrets.api_key },
      params: { since: state.last_fetched_id }
    })
  end

  let items = response.data.posts
    |> filter(i ~ i.type != 'retweet')
    |> map(i ~ { title: i.title | trim, url: i.link })

  step "store" do
    db.insert_items(items)
  end

  -- pagination loop
  let cursor = response.meta.next_cursor
  if cursor != null then
    fetch_posts(source, secrets, { last_cursor: cursor })
  end
end
```

**This is no longer Elo.** It's a new DSL that borrows Elo's expression syntax. It has:
- Statements (`step ... do ... end`)
- Side effects (`http.get`, `db.insert_items`)
- Recursion for looping (or explicit loop constructs)
- Durability annotations (`step`, `workflow`)

**Why this is a bad idea:**
1. **You're building a programming language.** That's a multi-year project with its own tooling, debugger, error messages, editor support, security model.
2. **TypeScript already exists.** The WDK + TypeScript combination gives you everything above with a mature ecosystem, IDE support, type safety, and thousands of npm packages.
3. **Elo's portability is gone.** SQL can't express HTTP requests. Ruby/Python compilation is irrelevant for a server-side workflow engine. The multi-target compilation — Elo's core value proposition for us — becomes useless for the workflow parts.
4. **Debugging nightmare.** When a workflow fails at 2am, you want stack traces in a language your team knows, not a custom DSL.
5. **Security surface.** If Elo can make HTTP requests and write to databases, untrusted Elo expressions (from connector configs) become attack vectors.

**Assessment:** Firmly in "this is terrible" territory. Elo's value is being a **constrained** expression language. Removing the constraints removes the value.

---

### Level 5: The Inversion — WDK-Elo Hybrid (Pragmatic Middle Ground)

Instead of putting workflows into Elo, put more Elo into the workflow. Keep WDK as the durable execution engine, but make the TypeScript workflow code thin — just a generic executor that reads an Elo-defined pipeline spec and runs it.

```typescript
async function runConnector(sourceId: string) {
  "use workflow";

  const { source, secrets, state } = await loadContext(sourceId);

  // The Elo program defines the ENTIRE pipeline shape
  const pipeline = compile(source.config.pipeline);

  // But each stage is executed by the TypeScript runtime with durability
  const pages = await paginatedFetch(source, secrets, state);  // "use step" per page

  for (const page of pages) {
    const items = pipeline({ response: page, state, source });  // pure Elo: extract+filter+transform
    await storeItems(source, items);                            // "use step"
    await routeToFeeds(source, items);                          // "use step"
  }

  await updateRunState(source, state, items);                   // "use step"
}
```

And the Elo pipeline expression:

```elo
let
  MinScore = 10,
  OneWeekAgo = TODAY - P7D
in
  _.response
    |> fetch(_, .data.posts)
    |> filter(post ~
        post.type != 'retweet'
        and post.score >= MinScore
        and post.created_at > OneWeekAgo)
    |> map(post ~ {
        title: post.title | trim,
        url: post.link,
        published_at: post.created_at,
        summary: post.text | slice(0, 200),
        tags: if post.score > 100 then ['trending'] else []
      })
```

**What Elo handles:** All pure data logic — extraction, filtering, transformation, validation, normalization. This is everything between "I have a raw HTTP response" and "I have clean items ready to store." It's the connector's *brain*.

**What TypeScript + WDK handles:** Everything with side effects — HTTP requests, DB writes, pagination loops, scheduling, retries, error recovery. This is the connector's *muscles*.

**This is essentially Level 2 refined.** The Elo expression is a composed pipeline that replaces the separate `extraction`, `filter`, and `transform` config fields. The structural config (fetch URL, pagination strategy, run state) stays in JSON or Elo tuples. The durable execution stays in WDK.

---

## Deep Dive: Could Elo Handle Pagination?

Pagination is the hardest part to express in Elo because it's inherently stateful and sequential: fetch page → check for next page → fetch again → repeat. Let's see how far we can push it.

**Current approach (TypeScript):**

```typescript
while (true) {
  const response = await fetchPage(source, cursor, secrets);
  const items = extractAndFilter(source, response);
  await storeItems(items);
  cursor = evalElo(config.pagination.cursor_path, { response });
  if (evalElo(config.pagination.done_when, { response, items })) break;
}
```

**Attempt: Elo-defined pagination as a declarative spec:**

```elo
{
  strategy: 'cursor',
  next: fn(ctx ~ ctx.response.meta.next_cursor),
  done: fn(ctx ~ ctx.response.meta.next_cursor == null or ctx.run.page > 50),
  inject_as: 'cursor'
}
```

This doesn't *execute* the pagination — it *describes* it. The TypeScript runtime reads `strategy: 'cursor'`, calls the `next` function after each page, checks `done`, and injects the result as the query parameter named by `inject_as`.

**Verdict:** Elo can describe pagination rules but can't execute the loop. That's fine — the loop is a handful of lines of TypeScript that never changes. What changes per-connector is *where the cursor is* and *when to stop*. Those are pure expressions and Elo handles them well.

---

## Deep Dive: Could Elo Define Conditional Pipelines?

Some connectors need branching: "if the response is XML, parse it differently" or "if the API returns a 429, back off."

**Elo can handle data-driven branching:**

```elo
let parse = fn(response ~
  if response.content_type == 'application/xml'
    then parseXml(response.body)
    else response.body
) in
  _.response
    |> parse
    |> fetch(_, .items)
    |> filter(i ~ i.status == 'published')
```

**Elo cannot handle operational branching:** "If fetching fails, wait 30 seconds and retry" or "If we've exceeded the rate limit, pause the workflow." These are execution concerns, not data concerns. They belong in the WDK/TypeScript layer.

**The line is clear:** Data-shape decisions → Elo. Execution decisions → WDK.

---

## Deep Dive: SQL Compilation — What Survives?

Elo's JS+SQL dual compilation is its differentiator for us. Feed filters written in Elo run in JS at ingestion time and compile to SQL WHERE clauses at query time. What happens to this if we push Elo further?

**Always SQL-compilable (pure expressions):**
- Comparisons: `_.type == 'podcast'`
- Arithmetic: `_.score > 10`
- Date math: `_.published_at > TODAY - P30D`
- Boolean logic: `_.type == 'article' and _.language == 'en'`
- Null handling: `_.description | 'no description'`
- Range checks: `_.score in 50..100`

**Never SQL-compilable (by Elo's design):**
- Lambdas: `fn(x ~ x * 2)` — no anonymous functions in SQL
- Data schemas: `let T = { name: String } in data | T` — validation is procedural
- Guards: `guard x > 0 in x` — runtime assertions
- `map`/`filter`/`reduce` with lambdas

**Implication:** The more we lean into Elo's functional features (lambdas, schemas, higher-order functions), the more we move away from SQL compilability. For *pipeline expressions* (extract → filter → transform), this is fine — those run in JS at ingestion time. But for *feed filters* (which need to compile to SQL), we should stick to the simple expression subset.

**Recommendation:** Explicitly distinguish two Elo dialects in the system:

| Usage | Elo subset | Target |
|-------|-----------|--------|
| **Feed filters** (query-time) | Simple expressions — no lambdas, no schemas | JS + SQL |
| **Pipeline expressions** (ingestion-time) | Full Elo — lambdas, pipes, schemas, guards | JS only |

This isn't a language fork — it's a documentation/linting convention. "This expression will be compiled to SQL; keep it simple."

---

## What Would This Unlock?

Concrete capabilities we'd gain at each level versus the current JSON-with-strings approach.

### With Level 1 (Elo as config format):

- **Shared variables.** `let api_base = 'https://api.example.com/v1' in { fetch: { url: api_base + '/posts' }, ... }` — no more duplicating URLs across config fields.
- **Composed transforms.** Define a `clean_text` function once and use it in multiple transform fields.
- **Config validation.** Run Elo's type system over the whole config, not just individual expressions.
- **Programmatic config generation.** Generate Elo from a UI, or write it by hand, or mix both.

### With Level 2 (Pipeline expressions):

- **Readable pipelines.** `_.response |> extract(.data) |> filter(keep) |> map(normalize)` reads like a sentence.
- **Single test target.** Test the entire extract→filter→transform chain as one Elo expression against sample data.
- **Portable.** The same pipeline expression could theoretically run in Ruby or Python if you ever build connectors in other languages (unlikely, but the option exists).
- **Composable.** Build pipeline fragments and combine them: `let base_pipeline = ... in base_pipeline |> extra_step`.

### With Level 5 (WDK-Elo hybrid):

All of the above, plus:
- **Thin executor.** The TypeScript runtime becomes a generic "run this Elo pipeline with durability" engine. Adding a new connector means writing an Elo config, not TypeScript code.
- **User-defined connectors.** Power users could write their own connector configs in Elo without touching the codebase.
- **Testability.** The Elo pipeline is pure — give it a mock response, get items back. No mocking HTTP clients or databases.

---

## Limitations and Risks

### Elo is maintained by a small team
`@enspirit/elo` has 21 GitHub stars. It's actively maintained but it's a niche tool. If the maintainer disappears, we own the dependency. Mitigation: Elo is MIT-licensed and the codebase is small enough to fork if needed. The alternative (JEXL, JSONata) has the same risk profile with worse capabilities.

### Debugging Elo is harder than debugging TypeScript
When a connector fails, developers want to step through code in VS Code. Elo expressions are opaque functions after compilation. Mitigation: Keep Elo expressions small and testable. Log the input context and output of each Elo evaluation. The Elo CLI (`elo -e "..." -d '{...}'`) is useful for reproduction.

### Elo-in-JSON is stringly typed
Embedding Elo expressions as strings in JSON means no syntax checking until runtime. Mitigation: A validation step at config save time that parses all Elo expressions. Or move to Level 1 (Elo as config) where the whole thing is one parseable program.

### Two mental models
Developers need to know both TypeScript (for the workflow/runtime) and Elo (for the expressions). This is a tax on onboarding. Mitigation: Elo is deliberately simple — the reference fits on one page. The mental model is "Elo is for data; TypeScript is for everything else."

### Performance
Every Elo expression is compiled at runtime via `compile()`. For hot paths (filtering thousands of items), this could matter. Mitigation: Compile once at config load time, cache the compiled function. Elo compiles to plain JS functions — execution speed is native.

---

## Comparison: This vs. Alternatives

| Approach | Pros | Cons |
|----------|------|------|
| **JSON config + Elo strings** (Level 0) | Simple, UI-friendly, universal | Stringly typed, no composition, verbose |
| **Elo as config** (Level 1) | Composition, type-safe, testable | Harder to generate from UI, unfamiliar syntax for some |
| **Elo pipeline expressions** (Level 2) | Readable, testable, powerful | Mixed config format (some JSON, some Elo) |
| **Full Elo workflows** (Level 4) | One language for everything | Building a language, loses SQL, debugging nightmare |
| **WDK-Elo hybrid** (Level 5) | Best of both, clean separation | Two mental models, Elo dependency |
| **Pure TypeScript** (no Elo) | One language, full IDE support | No SQL compilation, expressions hardcoded per source |
| **JSONata** | Powerful JSON transforms | JS-only, can't push to SQL, custom syntax |

---

## Recommendation

**Do Level 2 now, keep Level 5 in mind, avoid Levels 3–4.**

### Concrete next steps:

1. **Unify extract+filter+transform into a single Elo pipeline expression** per connector. Instead of three separate config fields, write one composed expression that takes a response and returns clean items. This is a natural fit for Elo's pipe operator and is a clear improvement over the current JSON approach.

2. **Keep fetch, pagination, store, and run state in JSON config / TypeScript.** These are structural and side-effectful. They belong outside Elo. Don't fight the language boundary.

3. **Establish the two-dialect convention early.** Feed filters (SQL-compilable) use simple Elo. Pipeline expressions (JS-only) use full Elo. Document the distinction. Consider a linter or compiler flag that validates SQL-safety.

4. **Support both JSON and Elo config formats.** UI-generated connectors produce JSON. Hand-written connectors can use Elo. The runtime normalizes both into the same internal representation.

5. **Don't extend Elo itself.** No custom keywords, no effect system, no forking the language. Use Elo as-is. If we outgrow it, we'll know — and the migration path is "replace Elo expressions with TypeScript functions," which is straightforward.

### The design principle:

> **Elo is the brain, WDK is the body.** Elo decides *what* to do with data. WDK decides *when* and *how reliably* to do it. The boundary is side effects: if it's pure, it's Elo; if it touches the outside world, it's TypeScript + WDK.

This gives us the best of both worlds: Elo's portability and testability for the data logic that changes per connector, and TypeScript's power and ecosystem for the execution infrastructure that's the same across all connectors.

---

## Appendix: What a Connector Config Could Look Like (Level 2)

```jsonc
{
  "name": "HN Front Page",
  "type": "api",

  // Structural — fetch setup (JSON, interpreted by runtime)
  "fetch": {
    "url": "https://hacker-news.firebaseio.com/v0/topstories.json",
    "method": "GET"
  },

  // Structural — pagination rules (JSON, interpreted by runtime)
  "pagination": { "type": "none" },

  // THE PIPELINE — one Elo expression (compiled, executed per page)
  "pipeline": "let MinScore = 10, CutoffDate = TODAY - P7D in _.response |> filter(story ~ story.score >= MinScore and story.time > CutoffDate) |> map(story ~ { title: story.title | trim, url: story.url, score: story.score, published_at: story.time, source_id: String(story.id) })",

  // Structural — run state (JSON with Elo expressions for update)
  "run_state": {
    "carry": ["last_max_id"],
    "update": {
      "last_max_id": "_.items |> map(i ~ Int(i.source_id)) |> max"
    }
  }
}
```

Or the same thing with the pipeline formatted readably (e.g., stored in a `.elo` file or a multi-line string):

```elo
let
  MinScore = 10,
  CutoffDate = TODAY - P7D
in
  _.response
    |> filter(story ~
        story.score >= MinScore
        and story.time > CutoffDate)
    |> map(story ~ {
        title: story.title | trim,
        url: story.url,
        score: story.score,
        published_at: story.time,
        source_id: String(story.id)
      })
```

**Reads well. Tests easily. Stays in its lane.**
