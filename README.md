# proptech-inquiry-agent

An agent that answers and triages inquiries about property listings. It is built on an MCP server, so the
same tools work from Claude Desktop, Claude Code, the MCP Inspector or the agent loop in this repo.

All listing and policy data is synthetic.

## Status

| Slice | What it adds | State |
|---|---|---|
| 1 | MCP server: structured search, listing lookup, hand-off to a human | done |
| 2 | Hybrid retrieval over listing texts and policy pages, local embeddings | done |
| 3 | Agent loop, citation and number guards, `POST /inquiries` (SSE), Streamable HTTP MCP, `pnpm ask` | done, acceptance inquiry and live test passed on `claude-opus-5-5` (Bedrock) |
| 4 | React UI: chat, tool-call trace, live hand-off queue, citation chips; runs without a key on a demo model | done |
| 5 | Eval suite: 49 cases, model judge, thresholds; `pnpm eval` writes a report with a trace per case | done, 46 of 49 cases pass on `claude-opus-5-5` ([report](evals/reports/2026-10-01-after-fixes.md)) |
| 6 | Architecture write-up, CI | planned |
| 7 | pgvector behind the same store interface | optional, not scheduled |

Details, tasks and open decisions per slice are in [ROADMAP.md](ROADMAP.md); the reasons behind each
choice are in [DECISIONS.md](DECISIONS.md).

## Quick start

```bash
corepack enable   # once, provides the pnpm version pinned in package.json
pnpm install
pnpm dev          # API on 127.0.0.1:3000, the inquiry desk on http://localhost:5173
```

Click one of the example inquiries. The conversation fills on the left, every tool call the agent made in
the middle (click a row for its arguments and result), and the tickets for a colleague on the right. Each
citation in a reply is a chip that opens the passage it came from. Follow-ups work ("and the deposit?"): the page
sends the last five exchanges with each inquiry, and "New conversation" starts over (`DECISIONS.md` 31).

Without `ANTHROPIC_API_KEY` (or the Bedrock settings) in `.env`, `pnpm dev` runs a rule-based demo model that
drives the same tools and checks, and the page says so (`DECISIONS.md` 28). The first start downloads the two
retrieval models (about 690 MB); `EMBEDDER=hashing pnpm dev` starts at once with weaker, English-only retrieval.

## The one design rule

The agent answers facts from the record and escalates everything else. Viewings, negotiation, contract and
legal questions, complaints, personal data requests and anything the record does not cover go to
`hand_off_to_human`. The boundary sits in the tool contract, not only in a prompt, so it can be tested.

Retrieval follows the same rule: when no passage is relevant, `search_knowledge` returns `found: false`
instead of the closest weak match, and the tool description tells the model to hand off.

## Tools and resources

| Name | Kind | Purpose |
|---|---|---|
| `search_listings` | tool, read | Hard-criteria search. Returns summaries without description text. |
| `get_listing` | tool, read | One full record: structured fields and description. |
| `search_knowledge` | tool, read | Hybrid search over listing texts and policies. Scoped to one listing when given an id. Returns citable chunk ids, or `found: false`. |
| `hand_off_to_human` | tool, write | Creates a ticket with a fixed reason code. Rejects unknown listing ids. |
| `policy://<slug>` | resource | The policy pages (deposit, utilities, pets, viewings, ...) as markdown. |

## How retrieval works

Two stages, like a librarian who first pulls likely pages off the shelf and then reads them.

1. **Collect.** Listing descriptions are split into sentences and policy pages into sections. A question is
   first limited to one listing plus the general policies, then the closest passages are collected twice:
   by meaning (`multilingual-e5-small` embeddings, local, German and English) and by keywords (BM25).
2. **Judge.** A reranker (`bge-reranker-v2-m3`, local, multilingual) reads the question together with each
   collected passage and scores whether it answers it. Only passages above a threshold calibrated on
   [a golden set](evals/retrieval-golden.json) are returned. If none is, the answer is `found: false`.

Measured on the golden set (26 questions with an answer, 8 without, German and English): the right passage
is in the top 5 for **all 26**, and **none** of the questions without an answer returns anything. The last
miss, a German commission question, was fixed by an eval finding (`DECISIONS.md` 37). About 1.4 seconds per question on a laptop CPU.

Why two stages, with the measurements that led there: `DECISIONS.md` 16 to 19.

## The agent

`pnpm ask "..."` sends one inquiry through the loop in `packages/core/src/agent/`. The agent is an MCP client of this repo's
own server, so it can only do what the tools allow. Each run returns the reply, the citations parsed from it,
the hand-off tickets it created, a trace of every tool call and the token usage.

Two checks run in code on the final answer (`DECISIONS.md` 20): every cited id must have been returned by a
tool in this run, and every price, area and percentage must appear in a tool result. A failed check gets one
repair turn; a second failure, the turn limit, the token budget or a timeout ends in a hand-off ticket
created by the code, not an exception.

```bash
cp .env.example .env            # then put your ANTHROPIC_API_KEY (or the Bedrock settings) in .env (git-ignored)
pnpm ask --trace "Ist die Heizung bei HH-1001 inklusive, und kann ich Samstag besichtigen?"
pnpm serve                            # POST /inquiries (server-sent events) and /mcp on 127.0.0.1:3000
curl -N localhost:3000/inquiries -H "content-type: application/json" -d "{\"inquiry\":\"Is HH-1001 still free?\"}"
```

The model is `claude-opus-5-5` by default; `ANTHROPIC_MODEL` and `ANTHROPIC_EFFORT` change it
(`DECISIONS.md` 23). To run on Amazon Bedrock instead, set `MODEL_PROVIDER=bedrock`, `AWS_REGION` and
`AWS_BEARER_TOKEN_BEDROCK` (`DECISIONS.md` 25). Tests use a scripted model and need no key;
`packages/server/test/agent-live.test.ts` runs against the real model when credentials are set in the environment.

## Evals

`pnpm eval` runs the 49 cases in [evals/cases.jsonl](evals/cases.jsonl) through the real agent loop: fact and
policy questions, searches, every hand-off reason, follow-ups, the traps (pets "on request" is not a yes, the
facade levy is not final, Staffelmiete is 3% a year, the Munich rent is all-inclusive, the Köln unit is not for
living in, polite haggling is still a negotiation) and a listing whose text tells the agent to confirm viewings.
Code checks the hand-offs, the listings and every figure; a different model (`claude-sonnet-5-5`) grades the facts
against [a written rubric](evals/rubric.md). The report lands in `evals/reports/<date>.md`, and every case in it
links to the full trace of its run (`DECISIONS.md` 32 to 38).

| Metric | First run | After the fixes | Threshold |
|---|---|---|---|
| Cases passed | 41 / 49 | 46 / 49 | 90% |
| Hand-off precision / recall | 93.8% / 100% | 100% / 100% | 93% / 100% |
| Replies with every figure grounded (final / first draft) | 100% / 100% | 100% / 100% | 100% / 100% |
| Correct, by the judge | 83.7% | 93.9% | 90% |
| Golden-set recall@5, false positives | 96%, 0 | 100%, 0 | 100%, 0 |
| Cost, latency per inquiry | $0.016, 9.2 s (p95 14.7 s) | $0.014, 8.6 s (p95 13.8 s) | $0.02, p95 20 s |

Both runs are [committed](evals/reports/), `claude-opus-5-5` on Bedrock. The first run found three problems, each
fixed in its own commit: the judge counted hand-off wording as unsupported claims, the commission policy was
invisible to German questions (`DECISIONS.md` 37), and follow-ups "corrected" earlier replies that were right
(`DECISIONS.md` 38). Of the three cases still failing, two are borderline inferences the judge flags ("so you
would have to use the stairs") and one is real: the agent offers to add an email address to a ticket, which no
tool can do.

```bash
pnpm eval                 # all cases; needs credentials for the agent and the judge; exits 1 below a threshold
pnpm eval --subset        # the 12 cases meant for every pull request, about 90 s and $0.25
pnpm eval --case handoff-viewing --case trap-pets-hh1001
MODEL_PROVIDER=demo EMBEDDER=hashing pnpm eval --no-judge   # offline: demo model, no judge
```

## Run it

```bash
corepack enable   # once, provides the pnpm version pinned in package.json
pnpm install
pnpm test         # offline, no model download
pnpm test:e2e     # Playwright against the demo model; once before: pnpm --filter @proptech/web exec playwright install chromium
pnpm index        # first run downloads both models (about 120 MB and 570 MB) into .models/, builds .index/
pnpm calibrate    # prints the scores of every golden question and proposes thresholds
pnpm test:model   # golden set against the real models
pnpm inspect      # MCP Inspector against the server
```

`EMBEDDER=hashing` (PowerShell: `$env:EMBEDDER = "hashing"`) switches to a deterministic offline embedder
without a reranker: no download, English only, weaker. The test suite uses it. `RERANKER=none` keeps e5 but
drops the reranker.

After changing the model or the corpus, run `pnpm calibrate`. It prints the relevance signals for every
golden question and proposes thresholds for `retrieval.thresholds.json`.

### Claude Desktop

Run `pnpm build` and `pnpm index` once, so the server does not download the models while Claude Desktop is
waiting for it. Then add to `claude_desktop_config.json` (`--conditions=built` makes the server load the
compiled core package instead of its TypeScript source, `DECISIONS.md` 26):

```json
{
  "mcpServers": {
    "proptech-inquiry": { "command": "node", "args": ["--conditions=built", "/path/to/proptech-inquiry-agent/packages/server/dist/mcp/stdio.js"] }
  }
}
```

## Layout

A pnpm workspace. `packages/core` has no MCP, HTTP or model-provider imports; `packages/server` wraps it.
All scripts run from the repository root.

```
data/listings.json              synthetic catalogue, validated with zod at load
data/policies/*.md              synthetic policy pages, one topic each
evals/retrieval-golden.json     questions with the chunks that must be found, plus questions with no answer
evals/cases.jsonl               agent eval cases; rubric.md for the judge, thresholds.json, run.ts (`pnpm eval`)
evals/reports/                  one committed report per full run, with a trace file per case
evals/fixtures/                 test-only listings (the prompt-injection case), never served by the app
retrieval.thresholds.json       relevance thresholds per embedding model
packages/core/src/domain/       listing model, repository, hand-off queue
packages/core/src/retrieval/    chunker, BM25, embedders, vector store, reranker, search
packages/core/src/agent/        model interface, tool-use loop, guards, prompt
packages/core/scripts/          index, calibrate, experiments
packages/server/src/mcp/        tool and resource definitions, stdio and Streamable HTTP entry points
packages/server/src/agent/      Claude API and Bedrock adapter, in-process MCP client, `pnpm ask`
packages/server/src/api/        HTTP server: /inquiries (SSE), /mcp, and /handoffs, /sources for the web app
packages/*/test/                unit tests, retrieval tests, in-memory MCP client tests
apps/web/                       the inquiry desk: Vite, React, one stylesheet; Playwright tests in e2e/
```

## License

MIT
