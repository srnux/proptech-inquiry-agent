# proptech-inquiry-agent

An agent that answers and triages inquiries about property listings. It is built on an MCP server, so the
same tools work from Claude Desktop, Claude Code, the MCP Inspector or the agent loop in this repo.

All listing and policy data is synthetic.

## Status

| Slice | What it adds | State |
|---|---|---|
| 1 | MCP server: structured search, listing lookup, hand-off to a human | done |
| 2 | Hybrid retrieval over listing texts and policy pages, local embeddings | done |
| 3 | Agent loop, citation and number guards, `POST /inquiries` (SSE), Streamable HTTP MCP, `pnpm ask` | built, not yet run on the real model |
| 4 | React UI: chat, tool-call trace, hand-off queue | planned |
| 5 | Eval suite: correct answers, correct escalations, no invented facts | planned |
| 6 | Architecture write-up, pgvector, CI | planned |

Details, tasks and open decisions per slice are in [ROADMAP.md](ROADMAP.md); the reasons behind each
choice are in [DECISIONS.md](DECISIONS.md).

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

Measured on the golden set (25 questions with an answer, 8 without, German and English): the right passage
is in the top 5 for **24 of 25**, and **none** of the questions without an answer returns anything. The one
miss is listed in `DECISIONS.md` 19. About 1.4 seconds per question on a laptop CPU.

Why two stages, with the measurements that led there: `DECISIONS.md` 16 to 19.

## The agent

`pnpm ask "..."` sends one inquiry through the loop in `src/agent/`. The agent is an MCP client of this repo's
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
`test/agent-live.test.ts` runs against the real model when credentials are set in the environment.

## Run it

```bash
corepack enable   # once, provides the pnpm version pinned in package.json
pnpm install
pnpm test         # offline, no model download
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
waiting for it. Then add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "proptech-inquiry": { "command": "node", "args": ["/path/to/proptech-inquiry-agent/dist/mcp/stdio.js"] }
  }
}
```

## Layout

```
data/listings.json         synthetic catalogue, validated with zod at load
data/policies/*.md         synthetic policy pages, one topic each
evals/retrieval-golden.json  questions with the chunks that must be found, plus questions with no answer
retrieval.thresholds.json  relevance thresholds per embedding model
src/domain/                listing model, repository, hand-off queue (no MCP imports)
src/retrieval/             chunker, BM25, embedders, vector store, reranker, search
src/mcp/                   tool and resource definitions, stdio and Streamable HTTP entry points
src/agent/                 model interface, tool-use loop, guards, prompt, `pnpm ask`
src/api/                   HTTP server: /inquiries (SSE) and /mcp
scripts/                   index, calibrate, experiments
test/                      unit tests, retrieval tests, in-memory MCP client tests
```

## License

MIT
