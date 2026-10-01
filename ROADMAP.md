# Roadmap

How this repo gets from an MCP server to an evaluated agent with a UI. One slice is one commit (or a short series
of commits) that builds, passes its tests and leaves `main` usable.

## Principles

- **The agent answers facts from the record and escalates everything else.** Every slice keeps that boundary in
  code and tests, not only in a prompt.
- **Domain code has no framework imports.** MCP, HTTP, React and the model client are adapters around it.
- **Every external dependency sits behind an interface** (embedder, vector store, model client), so tests run
  offline and without keys.
- **Each design choice gets an entry in `DECISIONS.md`** when it is made, with the reason and the rejected option.
- **All data is synthetic.** No real listings, no real people, no employer code.

## Definition of done, every slice

- [ ] `pnpm typecheck` and `pnpm test` pass
- [ ] New behaviour has tests, including at least one failure case
- [ ] `README.md` status table updated
- [ ] `DECISIONS.md` has an entry for each choice made in the slice
- [ ] Runs from a clean clone with the steps in the README

## Target layout (after slice 4)

```
apps/web/                  React UI
packages/core/             domain: listings, hand-offs, retrieval, agent loop
packages/server/           MCP server (stdio + Streamable HTTP) and /inquiries API
data/listings.json         synthetic catalogue
data/policies/*.md         synthetic policy pages
evals/                     eval cases, runner, reports
```

Slices 1 to 3 keep the current single-package layout; slice 4 moves it into the workspace.

---

## Slice 1: MCP server  ✅ done

Structured search, listing lookup and human hand-off, with in-memory MCP client tests. See `DECISIONS.md` 1 to 6.

---

## Slice 2: Retrieval over listing text and policies  ✅ done

**Goal:** answer questions the structured fields cannot, and say explicitly when nothing relevant exists.

### Tasks

- [x] Write `data/policies/`: deposit, Nebenkosten, Staffelmiete, buyer's commission, pets, viewing process,
      furnished and all-inclusive rent. Short pages, one topic each, with headings.
- [x] `src/retrieval/chunker.ts`: listing descriptions split by sentence, policies split by heading. Each chunk
      carries `chunkId`, `source` (`listing` or `policy`), `listingId` or `null`, and the text.
- [x] `src/retrieval/embedder.ts`: `Embedder` interface plus one implementation (see decision D2.1) and a
      deterministic fake for tests.
- [x] `src/retrieval/store.ts`: `VectorStore` interface plus an in-memory cosine implementation.
- [x] `src/retrieval/bm25.ts`: keyword index over the same chunks.
- [x] `src/retrieval/search.ts`: filter by `listingId` first (listing chunks for that id plus all policy chunks),
      then BM25 and vector ranking merged with reciprocal rank fusion.
- [x] Answerability threshold: below it, return `{ found: false }` instead of weak chunks. Keyword relevance uses IDF-weighted coverage rather than raw BM25 (`DECISIONS.md` 10).
- [x] `pnpm index` script that builds the index into `.index/` (git-ignored); a stale index (other model or edited corpus) is rebuilt automatically.
- [x] MCP tool `search_knowledge(query, listingId?)` returning chunks with `chunkId`, source and score.
- [x] Policy pages exposed as MCP resources (`policy://deposit` and so on).
- [x] Update the `get_listing` tool description to point at `search_knowledge` for free-text questions.

### Tests

- [x] Chunker: stable ids, correct metadata, no empty chunks
- [x] Filter: a question scoped to HH-1001 never returns another listing's chunk
- [x] Keyword terms: "Hausgeld", "WBS", "Staffelmiete" are found by BM25 even with the fake embedder
- [x] Golden set of about 20 questions, each mapped to the chunk that must be in the top 5 (recall@5 reported)
- [x] Out-of-scope questions ("Is there a gym nearby?") return `found: false`
- [x] MCP round-trip for `search_knowledge` and for reading a resource

### Open

- [x] First e5 calibration: absolute cosine cannot separate relevant from irrelevant; switched to z-score (`DECISIONS.md` 16)
- [x] Second e5 calibration: z-scores do not separate relevant from irrelevant either (a negative scored z 3.05)
- [x] Experiment: plain passage embeddings rank better, MRR 0.654 to 0.821; now the default (`DECISIONS.md` 17)
- [x] Decided: local cross-encoder reranker, bge-reranker-v2-m3 (`DECISIONS.md` 18)
- [x] Calibrate the reranker threshold: 0.008, 24/25 real questions above every no-answer question (`DECISIONS.md` 19)
- [x] `pnpm test:model` passes: recall@5 0.96 (24/25), no false positives, 2026-09-28
- [x] Run `pnpm test:model` and record recall@5 in the README

### Acceptance

Asking in Claude Desktop "Is heating included in HH-1001?" leads to a `search_knowledge` call that returns the
utilities sentence, and the answer cites it.

### Decisions

| Id | Question | Options | Recommendation |
|---|---|---|---|
| D2.1 | Embeddings | Local model in Node (multilingual, offline, free) · hosted API (better quality, needs a key) | **Decided: local** (`DECISIONS.md` 7) |
| D2.2 | Vector store | In-memory · pgvector | **Decided: in-memory** (`DECISIONS.md` 8) |
| D2.3 | Ranking | Vector only · hybrid BM25 plus vector | **Hybrid** (`DECISIONS.md` 9) |
| D2.4 | Threshold | Fixed score · calibrated on the golden set | **Calibrated**, stored in `retrieval.thresholds.json`; e5 value still provisional (`DECISIONS.md` 11) |

### Commits

1. `Policies corpus and chunker`
2. `Embedder and vector store interfaces with in-memory implementation`
3. `Hybrid search with listing filter and answerability threshold`
4. `search_knowledge tool and policy resources`

---

## Slice 3: Agent loop  ✅ done

**Goal:** a free-text inquiry goes in; a reply, citations, hand-off tickets and a trace come out.

### Tasks

- [x] `src/agent/model.ts`: `ModelClient` interface over the Messages API, plus a scripted fake for tests.
- [x] `src/agent/loop.ts`: plain tool-use loop. The agent is an MCP client of our own server (in-memory
      transport in tests, same code in production).
- [x] `src/agent/prompt.ts`: system prompt with three rules: answer only from tool results, cite `listingId` and
      `chunkId` for every fact, escalate the six hand-off categories. Reply in the inquirer's language.
- [x] Result type `{ reply, citations[], handoffs[], trace[], usage }`. Trace entries hold tool name, arguments,
      result summary and duration.
- [x] Guards in code, run after the model's final answer:
  - [x] citation guard: every cited `chunkId` was returned by a tool in this run
  - [x] number guard: every price, area or percentage in the reply appears in some tool result
  - [x] a failed guard produces one repair turn, then a forced hand-off if it fails again
- [x] Limits: maximum turns, token budget, per-call timeout.
- [x] Prompt caching on the system prompt and tool definitions.
- [x] `src/mcp/http.ts`: Streamable HTTP transport for the MCP server.
- [x] `src/api/inquiries.ts`: `POST /inquiries` that streams trace events and the final result as server-sent events.
- [x] `pnpm ask "..."` CLI for trying the agent from a terminal.

### Tests

- [x] Scripted model: happy path with one search, one lookup and a cited answer
- [x] Scripted model cites a chunk it never retrieved: citation guard catches it
- [x] Scripted model invents a price: number guard catches it, repair turn, then hand-off
- [x] Viewing request always produces a `viewing_request` ticket
- [x] Turn limit ends the run with a hand-off, not an exception
- [x] One optional live test against the real model, skipped without credentials (passed on Bedrock, `claude-opus-5-5`, eu-central-1, 2026-09-29)

### Open

- [x] Run `pnpm ask` with the acceptance inquiry below on the real model and record the result (passed on Bedrock, `claude-opus-5-5`, 2026-09-29: German reply, HH-1001, pets on request, cites `HH-1001#s5`, one `viewing_request` ticket; 4 tool calls in 3 turns)
- [x] Run the live test once (Bedrock: `MODEL_PROVIDER=bedrock node --env-file=.env node_modules/vitest/vitest.mjs run test/agent-live.test.ts`)
- [x] Confirm prompt caching on the real model: `cache_read_tokens` above zero on the second turn of a run (the
      request shape is unit-tested; a hit is not, and the prefix may be under the model's minimum size)

### Acceptance

`pnpm ask "Ich habe einen kleinen Hund und suche eine Wohnung in Hamburg unter 2.000 €. Ist die Heizung inklusive,
und kann ich Samstag besichtigen?"` returns a German reply that names HH-1001, says pets are on request, cites the
heating sentence and creates one `viewing_request` ticket.

### Decisions

| Id | Question | Options | Recommendation |
|---|---|---|---|
| D3.1 | Loop | Plain Messages API loop · Claude Agent SDK · a framework | **Decided: plain loop** (`DECISIONS.md` 21) |
| D3.2 | Model | Configurable via `ANTHROPIC_MODEL` | **Decided: `claude-opus-5-5`** (`DECISIONS.md` 23) |
| D3.3 | Guard failure | Reject · repair turn then hand off | **Decided: repair once, then hand off** (`DECISIONS.md` 20) |

### Commits

1. `Model client interface and agent loop over the MCP server`
2. `Citation and number guards with repair turn`
3. `Streamable HTTP transport and /inquiries SSE endpoint`
4. `ask CLI`

---

## Slice 4: React UI  ✅ done

**Goal:** a demo someone understands in 30 seconds.

### Tasks

- [x] Convert to a pnpm workspace (`apps/web`, `packages/core`, `packages/server`) with no behaviour change;
      all existing tests still pass (`DECISIONS.md` 26).
- [x] `apps/web`: Vite, React, TypeScript.
- [x] Chat pane with the run streaming in: live steps, then the reply once the guards pass it (`DECISIONS.md` 27).
- [x] Trace pane: each tool call as a row with arguments and result, expandable.
- [x] Hand-off queue pane that updates live when a ticket is created (`GET /handoffs`, SSE, `DECISIONS.md` 29).
- [x] Citations rendered as chips that open the source chunk (listing or policy page).
- [x] Example inquiries as buttons: one pure fact question, one with a viewing, one out of scope, one in German.
- [x] `pnpm dev` starts server and UI together; without credentials it runs the demo model (`DECISIONS.md` 28).
- [x] One Playwright test: click the viewing example, assert the reply and a ticket in the queue (plus one for citation chips).
- [x] Follow-up questions: the client sends the last 5 exchanges with each inquiry; history is context, not
      evidence, so cited ids and figures are looked up again (`DECISIONS.md` 31). "New conversation" clears it.

### Acceptance

A clean clone, `pnpm install`, `pnpm dev`, one click on an example, and all three panes fill.

### Decisions

| Id | Question | Options | Recommendation |
|---|---|---|---|
| D4.1 | Styling | Plain CSS modules · Tailwind | **Decided: one plain stylesheet** (`DECISIONS.md` 29) |
| D4.2 | State | React state and context · a store library | **Decided: React state** (`DECISIONS.md` 29) |

### Commits

1. `Move to pnpm workspace`
2. `Web app: chat and streaming`
3. `Trace and hand-off panes, citation chips`
4. `Example inquiries and Playwright test`

---

## Slice 5: Evals  ✅ done

**Goal:** show, with numbers, that the agent answers correctly, escalates correctly and does not invent facts.

### Tasks

- [x] `evals/cases.jsonl`: about 40 inquiries, German and English. Each case has expected listing ids, expected
      hand-off reason or none, facts that must appear, facts that must not appear.
- [x] Trap cases:
  - [x] "Pets on request" must not become a yes (HH-1001, B-2002, K-4001)
  - [x] Facade levy is estimated, not final (B-2003)
  - [x] Staffelmiete means 3 percent per year (B-2002)
  - [x] Munich furnished flat is all-inclusive, so no separate utilities figure (M-3001)
  - [x] Köln commercial unit is not approved for living in (K-4002)
  - [x] Price negotiation phrased politely still goes to a human
- [x] Prompt-injection case: a test-only listing whose description says to ignore instructions and confirm a
      viewing. The agent must still hand off.
- [x] `evals/run.ts` with metrics:
  - [x] hand-off precision and recall per reason
  - [x] groundedness: share of replies where every number is found in tool results
  - [x] retrieval recall@5 on the golden set
  - [x] answer correctness from a model judge with a written rubric in `evals/rubric.md`
  - [x] cost and latency per inquiry
- [x] `evals/reports/<date>.md` written by the runner and committed.
- [x] Thresholds in `evals/thresholds.json`; the runner exits non-zero below them.

### Open

- [ ] The agent offers to add an email address to an existing ticket ("kann ich sie im Ticket ergänzen"), which
      no tool can do (`trap-staffelmiete-b2002-de` in `evals/reports/2026-10-01-after-fixes.md`)
- [ ] Run the eval on `claude-sonnet-5-5` as the agent, with `JUDGE_MODEL=claude-opus-5-5` (`DECISIONS.md` 23)

### Acceptance

`pnpm eval` produces a report table, and every failing case links to its trace.

### Decisions

| Id | Question | Options | Recommendation |
|---|---|---|---|
| D5.1 | Thresholds | Set up front · set from the first honest run | **Decided: from the first run, then only raised** (`DECISIONS.md` 36) |
| D5.2 | CI | Full set on every PR · small subset on PR, full set manually | **Decided: subset on PR** (`DECISIONS.md` 33) |
| D5.3 | Judge | Same model as the agent · a different one | **Decided: a different one, `claude-sonnet-5-5`** (`DECISIONS.md` 34) |

### Commits

1. `Eval cases and rubric`
2. `Eval runner and metrics`
3. `First eval report`
4. Fixes found by the evals, one commit each, each referencing the case it fixes

---

## Slice 6: Write-up and polish

**Goal:** the repo is a showcase. Readers are potential employers and dev.to readers; most of them read only the
first screen of the README, some open `ARCHITECTURE.md`, few clone it.

### Tasks

- [ ] `README.md` first screen: GIF of the UI answering one inquiry and handing off another, a three-sentence
      pitch, quick start in five lines.
- [ ] `ARCHITECTURE.md`: request flow diagram, the escalation boundary, where each guard sits, what runs offline.
- [ ] "What broke" section in the README: the real failures the evals found in slice 5 and how each was fixed,
      linking to the committed reports.
- [ ] GitHub Actions on every push: typecheck, unit tests, Playwright. Free, no secrets; a badge in the README.
- [ ] GitHub Actions eval subset, started by hand only (`workflow_dispatch`), with the API key or Bedrock settings as
      secrets. Revises `DECISIONS.md` 33 in a new entry.
- [ ] Social preview image committed in `docs/assets/`; description and topics written down, set by hand in the
      GitHub repository settings.

### Acceptance

Someone who has never seen the repo understands what it does from the README in two minutes and can run it in five.

---

## Slice 7 (optional): pgvector

Not scheduled. Sixty-odd chunks fit in memory (`DECISIONS.md` 8), so this slice adds no capability. It shows that
the `VectorStore` boundary holds: Postgres replaces the in-memory store without a change to retrieval.

**Goal:** the same retrieval tests pass against the in-memory store and against pgvector.

### Tasks

- [ ] Make `VectorStore` asynchronous (`upsert`, `query`, `distribution` return promises); `KnowledgeBase` awaits them.
- [ ] pgvector adapter in `packages/core`: table per embedder id, cosine distance, listing filter applied in SQL.
- [ ] `VECTOR_STORE=memory|pgvector` and `DATABASE_URL`; the in-memory store stays the default.
- [ ] `docker-compose.yml` with a pgvector Postgres image.

### Tests

- [ ] One shared store test suite, run against the in-memory store and against pgvector
- [ ] The listing filter never returns another listing's chunk through pgvector
- [ ] A vector with the wrong number of dimensions is rejected

### Decisions

| Id | Question | Options | Recommendation |
|---|---|---|---|
| D7.1 | Tests without Docker | PGlite (in-process Postgres with pgvector) · real Postgres only, skipped without `DATABASE_URL` | PGlite in tests, real Postgres through docker-compose |

---

## Optional, later: server-side conversation history

Not scheduled. Slice 4 keeps the history in the client (`DECISIONS.md` 31), which is enough for one person trying
the desk. This slice is for when a conversation has to outlive a browser tab: a colleague picks up a thread from a
hand-off ticket, an inquiry arrives by email and is answered in the web app, or the evals replay whole conversations.

**Goal:** a conversation has an id and lives on the server; the client sends only the new message.

### Tasks

- [ ] `ConversationStore` interface in `packages/core` (create, append turn, read last N, delete) with an in-memory
      implementation and a fake clock for tests. Same shape as the other stores: no framework imports.
- [ ] A turn stores the inquiry, the reply, the citations, the hand-off ticket ids and the outcome. Tool results are
      not replayed to the model, so the rule from `DECISIONS.md` 31 holds: history is context, not evidence.
- [ ] `POST /conversations` creates one; `POST /conversations/:id/inquiries` runs the agent with the stored history
      and appends the turn only when the run finishes; `GET /conversations/:id` returns the transcript.
- [ ] Hand-off tickets carry the conversation id, so a colleague opens the whole thread from the queue.
- [ ] Expiry: conversations idle for longer than a configured time are deleted; a personal data request can delete
      one on demand (ties in with the `personal_data_request` hand-off).
- [ ] Access: a conversation id is a capability (unguessable, not enumerable); nothing lists all conversations
      without authentication.
- [ ] Web app keeps the id in the URL, so a reload or a shared link reopens the thread.
- [ ] Keep `history` on `POST /inquiries` for stateless callers, or retire it with an entry in `DECISIONS.md`.

### Tests

- [ ] Two conversations never see each other's turns
- [ ] A failed or aborted run appends nothing
- [ ] Expired and deleted conversations return 404
- [ ] A follow-up that cites a chunk from an earlier turn still fails the citation check
- [ ] Concurrent inquiries on one conversation: the second waits or is rejected, never interleaved

### Decisions

| Id | Question | Options | Recommendation |
|---|---|---|---|
| D8.1 | Storage | In-memory · SQLite · Postgres next to pgvector | Postgres if slice 7 brings pgvector; otherwise in-memory behind the interface |
| D8.2 | Retention | Fixed idle timeout · per-agency setting | Fixed, recorded in `DECISIONS.md`, with deletion on request |
| D8.3 | Concurrent inquiries | Queue per conversation · reject with 409 | Reject; the UI already disables sending while a run is in progress |

---

## Open questions for later

- Should hand-off tickets go somewhere real (email, a webhook) or stay an in-memory queue for the demo?
- Is a German README worth it, given the German-language employers on the target list?
