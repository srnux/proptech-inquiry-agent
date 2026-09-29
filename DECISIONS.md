# Decisions

Short records of choices that shaped the code. Newest last.

## 1. Domain code does not import MCP

The repository and hand-off queue know nothing about the protocol. The server receives them as arguments.
This keeps the domain testable without a transport, and slice 3 can call the same code directly.

## 2. Search is structured only

`search_listings` filters on typed fields. Free-text questions ("is heating included?") go to retrieval
in slice 2. Keeping them apart means a wrong answer can be traced to one layer.

## 3. Summaries leave out the description

Search results stay small, so the model has to call `get_listing` before it quotes details.

## 4. "Pets on request" is kept, but never a yes

Filtering those listings out would hide real options. The summary carries the policy so the agent can say
"on request" instead of promising.

## 5. Escalation reasons are a closed enum

A free-text reason cannot be counted or evaluated. A fixed list can, and slice 4 measures against it.

## 6. Tool errors are returned to the model, not thrown

Unknown ids come back as `isError` with a hint about what to call instead, so the agent can recover inside
the loop.

## 7. Local embeddings by default, behind an interface

`multilingual-e5-small` runs in-process through transformers.js. Anyone can clone and run the repo without a
key, and German and English questions share one vector space. A hosted model can be added as a second
`Embedder`; slice 5 can then compare both on the same golden set.

Rejected for now: a hosted embedding API (better quality, but a key and a sign-up before retrieval works).

## 8. In-memory vector store

Sixty-odd chunks fit in memory, and a cosine loop over them takes microseconds. The `VectorStore` interface
keeps pgvector a drop-in for slice 6, where it earns its place with Docker Compose and the same tests.

## 9. Hybrid search: BM25 plus vectors, merged by reciprocal rank fusion

German domain words (Hausgeld, WBS, Staffelmiete, Nebenkosten) are exact-match terms. A small embedding
model handles them poorly; BM25 handles them perfectly. The vectors cover paraphrase and the other language.
Rank fusion avoids comparing two score scales that have nothing in common.

## 10. Relevance judged on keyword coverage, not raw BM25

Raw BM25 is unbounded and one rare word can dominate it: "Is the flat in a safe area at night?" scored
higher than several real questions because "area" is rare. Coverage, the IDF-weighted share of the question's
terms found in a passage, stays between 0 and 1 and separates the golden set cleanly.

## 11. Thresholds are calibrated per model and stored in a file

A cosine of 0.3 means something different for every model. `scripts/calibrate.ts` prints the signals for the
golden positives and negatives and proposes values; they are copied into `retrieval.thresholds.json` by hand,
so a change is a reviewed diff. The e5 value is provisional until calibrated on a machine that can download
the model.

## 12. Filter before ranking, and the listing's own text first

A question about HH-1001 can never retrieve another listing's text, because other listings are removed before
ranking rather than after. Among what remains, the listing's passages go ahead of general policy: K-4001's
"deposit two months" must win over the policy's "at most three months".

## 13. Chunks carry a context header for indexing only

"Deposit is three months' cold rent" means nothing without knowing which flat. The indexed text is prefixed
with the listing title, id and district; the returned text stays the plain sentence, so citations quote the
source exactly.

Revised by 17: measurement showed the header hurts the embeddings, so only BM25 uses it now.

## 14. The index records what built it

The cached index stores the embedder id and a hash of the corpus. A different model or any edited listing
text forces a rebuild, instead of silently mixing incompatible vectors.

## 15. onnxruntime's install script is not run

Its only job is downloading CUDA binaries from NuGet. The CPU binaries for Windows, macOS and Linux ship in the
npm package, so the script is disabled with `allowBuilds` in `pnpm-workspace.yaml`, next to the esbuild entry
that was already there.

## 16. Vector relevance judged by z-score, not by absolute cosine

The first calibration with e5 on real hardware (2026-09-28) showed that an absolute cosine threshold cannot
work for this model. Every similarity sat between 0.76 and 0.90, relevant or not. "Is there a gym nearby?",
which nothing in the corpus answers, scored 0.832; "Darf ich einen Hund halten?", which the pets policy
answers, scored 0.784. The best threshold the data allowed (0.852) sat above most real answers, so the
vector side contributed nothing, and exactly the German and paraphrased questions, the reason for choosing
e5, came back as unanswerable.

A passage is now judged by how far it stands out from all candidate passages for the same question, in
standard deviations (z-score). An off-topic question scores uniformly high across the corpus; a real
question has one or two passages clearly above the rest. Keyword coverage is unchanged.

If z-scores do not separate the golden set either, the next step is a multilingual cross-encoder reranker,
which scores query and passage together and gives a calibrated relevance score, at the cost of a larger
model download.

## 17. Embed the plain passage; keep the header for keyword search only

Measured with `pnpm experiment:embed-text` on the golden set, e5, 2026-09-28. Vector side only:

| Variant | Top-1 | Top-5 | MRR | Real question scores above every no-answer question |
|---|---|---|---|---|
| Passage plus listing header (before) | 13/25 | 20/25 | 0.654 | 8/25 |
| Plain passage | 19/25 | 23/25 | 0.821 | 10/25 |

The header made all sentences of one listing look alike to the model, so the title drowned out the sentence.
"Are electricity and internet included in the rent?" moved from rank 12 to 2, "How will the rent increase
over time?" from 8 to 2.

What got worse: German words that only appear in a policy page title. "Wie hoch ist die Kaution?" fell
from 1 to 3, because "Kaution" is in the title "Deposit (Kaution)", not in the section text. BM25 still sees
the header, so keyword search keeps finding it. Two questions dropped out of the vector candidates entirely:
"Can I live in the unit?" (a five-word sentence with no context left) and "Muss ich Provision zahlen, wenn
ich miete?", which ranked 17th before as well and is a cross-lingual miss of the small model.

With 25 questions each one is 4 percent, so the direction is clear but the exact figures are not to be
over-read. The header variant stays available through `EMBED_TEXT=header`.

This fixes ranking, not answerability: a no-answer question ("Is the flat close to a gym?", z 3.05) still
scores above most real ones. That needs a different signal (roadmap slice 2, open items).

## 18. A cross-encoder reranker decides what answers the question

Decisions 16 and 17 showed that embedding scores can say which passage is closest, but not whether any
passage answers the question. A reranker reads the question and one passage together and is trained on
exactly that judgement, so its score (0 to 1) means the same thing for every question.

The search now has two stages:

1. **Collect candidates.** The listing filter, then the top 20 by embedding and the top 20 by keywords.
2. **Judge.** `bge-reranker-v2-m3` scores every candidate. Only passages above one calibrated threshold
   are returned; if none is, the result is `found: false` and the agent hands off.

The reranker reads each passage with its listing or page header. "Not approved for residential use" only
answers "Can I live in the unit?" when the reader knows it is about the office unit in Ehrenfeld.

Chosen: `onnx-community/bge-reranker-v2-m3-ONNX`, quantised, multilingual, Apache-2.0, runs locally through
transformers.js. Cost: a second download of about 570 MB and slower questions, measured by `pnpm index`.
Rejected: letting the agent judge (the escalation rule would be model behaviour, not code) and a hosted
reranker (a key and an account, reversing decision 7).

Without the reranker (`RERANKER=none`, and always with the offline hashing embedder used in tests), the
earlier z-score and keyword-coverage gate still applies.

## 19. Reranker threshold 0.008, and why the margin is thin

First calibration of the reranker on real hardware, 2026-09-28:

- Every question with no answer scored at most **0.003**.
- 24 of 25 real questions scored above that, the lowest at **0.013**. The threshold is the midpoint, 0.008.
- The one miss, "Muss ich Provision zahlen, wenn ich miete?", never reaches the reranker: neither the
  embeddings nor the keywords collect the commission page as a candidate. That is a collection problem,
  not a judging problem.

This is the first signal in the project that separates the two groups at all (compare 16 and 17). But the
gap is narrow in absolute terms, and several clear answers score low: "Can I rent a parking space?" against
"Underground parking space available for 150 EUR per month extra" gets 0.013, while other clear answers get
above 0.9. A likely cause is the int8 quantisation of the reranker; comparing it with the fp16 version (about
1.1 GB) is a cheap experiment if slice 5 shows answers being dropped.

Speed: the golden set (33 questions) took 47 seconds, about 1.4 seconds per question on a laptop CPU.

## 20. Two checks in code on the final answer, one repair turn, then a hand-off

The prompt asks the model to cite and to quote figures. Whether it does is checked in code, on every final
answer, before anything is returned (`src/agent/guards.ts`):

- **Citation guard.** Every `[chunkId]` or `[listingId]` marker must refer to something a tool returned in
  this run. A reply that states prices, areas or percentages but cites nothing also fails.
- **Number guard.** Every price, area and percentage in the reply must appear in a tool result or in the
  inquirer's own message. German and English notation both count ("1.650 €" matches 1650). Arithmetic
  fails on purpose: "1.890 €" as the sum of rent and utilities is a figure no record contains.

A failed check sends the model one repair message that names the problem (the draft was never shown to the
inquirer). If the second answer fails too, the code creates a `not_answerable_from_listing` ticket itself and
returns a fixed reply in German and English. The same ending applies to the turn limit, the token budget, a
model timeout, a cut-off reply and a refusal. A run never ends in an exception because of model behaviour.

Rejected: rejecting outright (one slip loses an answer that a small correction fixes) and repairing more than
once (a second failure is a signal, not noise; three tries spend tokens on the same mistake).

What the guards do not catch: a wrong claim that cites a real chunk and uses only real numbers, and a viewing
the model forgets to hand off. The first is what slice 5's correctness judge is for. The second cannot be
detected without classifying the inquiry, which would be a second model call deciding the boundary; slice 5
measures the hand-off recall instead.

## 21. A plain loop behind a `ModelClient` interface, with a scripted fake

The loop (`src/agent/loop.ts`) is about 100 lines: call the model, run its tool calls over MCP, repeat until
it answers. It owns the limits (8 model calls, 80,000 tokens, 60 s per model call, 30 s per tool call; all
overridable) and builds the trace.

The model sits behind `ModelClient`, with its own small message types, so the loop imports nothing from the
Anthropic SDK. `ScriptedModel` plays back a fixed script, which is how every loop behaviour (guards, limits,
timeouts) is tested offline, deterministically and without a key.

Rejected: the SDK's tool runner (the loop's guards and limits are the point; hiding the loop hides them),
the Claude Agent SDK (a coding-agent harness, more than this needs) and an agent framework (one more
abstraction to explain, nothing gained for four tools).

## 22. The system prompt is fixed text, and citations are inline markers

The prompt has no date, id or per-request content, so it stays the start of the cached prefix. It states the
three rules and the six hand-off reasons (the list is generated from `HandoffReason`, so it cannot drift).

Citations are inline markers, `[HH-1001#s5]`, `[policy:pets#pets-on-request]`, `[HH-1001]`, taken directly
from the ids the tools return. They can be parsed with one regular expression, checked against the run's tool
results and rendered as chips in slice 4. Rejected: a structured final answer through a submit tool (forced
tool choice is not available on the default model, and it would split a short reply into fields).

## 23. Default model `claude-opus-5-5`, configurable

`ANTHROPIC_MODEL` overrides it, `ANTHROPIC_EFFORT` sets the effort (default `medium`). Chosen because tool
selection and refusing to guess are the hard parts of this task, and the guards make a cheaper model
recoverable but not free: each failed guard costs a repair turn. Slice 5 should run the eval on
`claude-sonnet-5-5` too; if it holds the thresholds, the default changes and this entry records why.

Details that follow from the model: thinking is always on, so thinking blocks are kept and sent back
unchanged, and `max_tokens` is 8,000 because thinking counts against it. Server-side refusal fallback is on
(`fallbacks: "default"`); a refusal that survives it ends in the forced hand-off above.

## 24. Two ways in: in-process for the agent, stateless Streamable HTTP for everyone else

The agent talks to our server through an in-memory MCP transport (`src/agent/connect.ts`), one pair per
inquiry. It is the same client code an external process would run; only the wire differs. `/mcp` serves
external MCP clients over Streamable HTTP, and both doors share one listing repository, knowledge base and
hand-off queue, so a ticket created by the agent is visible to any client.

`/mcp` is stateless: every request gets a fresh server and transport, so there are no sessions to expire or
leak. The cost is that server-initiated messages are unavailable, and this server sends none.

Rejected for `/inquiries`: connecting to our own `/mcp` over loopback (a port and a failure mode for no
behavioural difference). There is no authentication; the server binds to 127.0.0.1 by default.

## 25. The same adapter on Amazon Bedrock

`MODEL_PROVIDER=bedrock` swaps the client, not the adapter: `AnthropicBedrock` from `@anthropic-ai/bedrock-sdk`
serves the same `beta.messages` API through bedrock-runtime, authenticated by `AWS_BEARER_TOKEN_BEDROCK` (a
Bedrock API key) or the normal AWS credential chain, in `AWS_REGION`. Chosen because a Claude API key was not
available and an AWS account was; the loop, guards, effort and caching do not change (a cache read on the
second request was observed in eu-central-1).

The model id is the region's inference profile, `eu.anthropic.claude-opus-5-5` in eu-central-1: current models
are not invocable on demand by their bare id, and the `eu.` profile keeps requests inside the EU. Regions
outside the EU and US get the `global.` profile.

Bedrock has no server-side `fallbacks`, so the request omits it and the client's `betaRefusalFallbackMiddleware`
retries a refusal on Opus 4.8 instead. bedrock-runtime rejects the `fallback-credit` beta the middleware sends by
default, so it is turned off and a retry pays full price.

Rejected: the Mantle client (`AnthropicBedrockMantle`), which returned 404 for Opus 5.5 and Opus 4.8 in
eu-central-1 and eu-west-1 on 2026-09-29 and served Opus 5.5 only in us-east-1; worth re-checking, since it
would bring the fallback credit back. The Converse API was rejected too (a different request shape, so a
second adapter).

## 26. A pnpm workspace whose packages run from source; the build is opt-in by an export condition

Slice 4 needs a second consumer of the agent's types (the web app), so the single package became three:
`packages/core` (domain, retrieval, agent loop, with no MCP server, HTTP or provider SDK), `packages/server`
(MCP server, `/inquiries`, the Claude API and Bedrock adapter, the CLI) and `apps/web`. The data, thresholds,
index and model cache stay at the repository root, and core finds them from its own file location
(`root.ts`), so every script works from any working directory.

`@proptech/core` exports its TypeScript source by default, so `tsx`, Vitest, `tsc` and Vite use it with no
build step and no per-tool configuration. The compiled output is behind a custom condition:
`"built": "./dist/index.js"`. Only the Claude Desktop entry point needs it, and its config passes
`node --conditions=built`. Node 24 strips types but does not rewrite the `.js` import specifiers the source uses,
so running the source directly with plain `node` is not an option.

Rejected: the reverse (dist by default, a `source` condition for development), which puts the condition into the
`tsx` scripts, Vitest, `tsc` and Vite instead of one config file; bundling the server with esbuild, which breaks
pnpm's strict dependency layout (the bundle would need core's dependencies declared by the server); TypeScript
project references, more configuration for a build almost nobody runs. The `bin` entry went away with the move:
the package is private and was never installed.

## 27. The reply appears after the guards; what streams is the work

The chat pane streams the run, not the text: each tool call shows up in the trace pane as it finishes, and the
reply bubble says what the agent is doing ("Searching listing texts and policies") until the answer arrives.
The reply itself appears whole, once the citation and number guards have passed it (`DECISIONS.md` 20).

Token streaming was rejected because the guards judge the finished draft: a streamed draft that fails them has
already been read, including the invented price the number guard exists to stop. Streaming it and then
retracting it would show the inquirer exactly what the design keeps from them. The cost is a few seconds of
waiting on the real model, which the live steps fill.

## 28. A rule-based demo model, so the UI runs without a key

`DemoModel` (`packages/core/src/agent/demo.ts`) implements `ModelClient` with rules instead of a model. It
calls the real tools over MCP, quotes retrieved passages verbatim and cites their chunk ids, and hands off
viewings and unanswerable questions, so its replies pass through the same loop and guards as the real model's
(the tests assert they pass). It understands the four example inquiries and little else, and the UI labels it
"Demo model, no API key".

`MODEL_PROVIDER=demo` selects it anywhere (`pnpm serve`, `pnpm ask`). `pnpm dev` selects it on its own when no
credentials are set, so a clean clone gets a working desk from `pnpm install && pnpm dev`; `pnpm serve` still
refuses to start without credentials. The Playwright test runs on it with the hashing embedder: no key, no
network, no model download.

Rejected: requiring a key for the demo (the acceptance for this slice is a clean clone), replaying recorded
real-model runs (they break whenever a tool result changes, and they would pass the guards by construction
rather than by checking), and `ScriptedModel` with fixed scripts (it cannot adapt to what retrieval returns
with a different embedder).

## 29. The web app: plain CSS, React state, a live queue over server-sent events

D4.1: one stylesheet with custom properties for the palette and both colour schemes, no Tailwind and no CSS
modules. The app is five components; class names do not collide at that size, and a reader sees the whole visual
system in one file. D4.2: React state in `App.tsx`, no store library, for the same reason.

The hand-off queue is `GET /handoffs`, a server-sent event stream: a snapshot of every ticket, then each new one.
It reads the shared queue (`HandoffQueue.subscribe`), so a ticket created by an external MCP client on `/mcp`
shows up too, not only those from this page's own inquiries. Citation chips fetch `GET /sources/:id`, which
resolves a chunk id or listing id to the passage and the document around it. Trace entries now carry the full
tool result next to the one-line summary, for the expandable rows.

In development Vite forwards the API routes to the server, so there is no CORS to configure and the server
still binds to 127.0.0.1 only. The web app imports types from `@proptech/core` and one value module,
`@proptech/core/examples`, which has no imports, so none of core's Node code reaches the browser bundle.
