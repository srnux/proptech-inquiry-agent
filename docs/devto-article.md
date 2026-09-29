---
title: "Building a Property Inquiry Agent with MCP, Local Search, and Answer Checks"
published: false
description: "From local hybrid search to a working TypeScript agent: MCP tools, citation checks, one repair attempt, and human hand-offs."
tags: ai, typescript, mcp, programming
---

A property assistant gets a question:

> “I’m looking for a flat in Hamburg under €2,000. I have a dog. Is heating included, and can I view it on Saturday?”

That sounds like one request. It actually contains several jobs: filter properties, check a pet policy, find the heating details, and arrange a viewing.

Some of those jobs have answers in the records. Others need a person.

That distinction is the starting point for `proptech-inquiry-agent`: a TypeScript project that gives an AI assistant tools to search property records, retrieve supporting passages, and create human hand-off tickets.

The project now includes its own conversation loop, answer checks, command-line interface, and HTTP API. The web interface is still planned. All property and policy data is synthetic.

## From a toolbox to a working agent

The first two development slices built the tools and retrieval system. An application such as Claude Desktop could use them to answer questions. Slice 3 adds the code that manages an inquiry from start to finish, so a desktop assistant is now optional.

```text
Customer inquiry
       |
       v
CLI or HTTP API
       |
       v
Agent loop <--------------------> Remote Claude model
       |                         Anthropic API or Bedrock
       |
       +── MCP tools ──> Property records + local retrieval
       |             └─> Temporary hand-off queue
       |
       v
Check the draft answer
       |
       v
Reply + citations + tickets + tool trace + token usage
```

MCP, the Model Context Protocol, is the connection that lets an assistant discover and call tools. The built-in agent uses an MCP client connected to this repository's server in the same process. It goes through the same tool interface as an external assistant, without an extra HTTP round trip.

The server exposes four tools:

| Tool | Job |
| --- | --- |
| `search_listings` | Find properties matching explicit requirements. |
| `get_listing` | Return one complete property record. |
| `search_knowledge` | Retrieve passages from descriptions and policies. |
| `hand_off_to_human` | Create a ticket with a specific reason. |

External assistants can still use the server through standard input and output, or through the new Streamable HTTP endpoint at `/mcp`. General policy pages are also available as MCP resources.

## What the agent loop actually does

The loop is ordinary TypeScript. It asks the model what to do next, executes any requested tools, and sends the results back. It repeats until the model produces a draft answer or the run reaches a limit.

```text
Inquiry + instructions + available tools
                   |
                   v
              Call the model <----------------+
                   |                          |
             What came back?                  |
              /           \                   |
             v             v                  |
       Tool requests    Draft answer          |
             |             |                  |
             v             v                  |
       Execute via MCP  Run answer checks     |
             |                                |
             +── Send tool results back ──────+
```

The system prompt asks the model to answer from tool results, cite its facts, preserve qualifications such as “on request,” and hand off the parts it cannot resolve. The model can answer the heating question and create a viewing ticket in the same run.

The model adapter supports the Anthropic API and Amazon Bedrock. The loop itself depends on a small `ModelClient` interface, so tests can substitute a scripted model. Model and effort settings are configurable; the adapter also requests prompt caching and records cache token usage.

Each run returns a structured result:

```text
reply       The final text
citations   Source markers parsed from that text
handoffs    Tickets created during this inquiry
trace       Tool names, arguments, summaries, and durations
usage       Input, output, and cache token counts
outcome     Answered, or forced hand-off with a cause
```

An `answered` outcome can still include a viewing ticket. It means the loop accepted the final reply, not that every part of the inquiry was resolved automatically.

## Use ordinary code for ordinary filters

“Hamburg, under €2,000, at least three rooms” does not require semantic search.

The catalogue is a JSON file. Each property has typed fields for its city, price, room count, floor area, features, availability, and pet policy. Zod validates the data when it loads.

`search_listings` checks those fields directly and sorts matching properties by price.

```text
City: Hamburg       ──┐
Price: ≤ €2,000      ──┼──> Field filters ──> Matching properties
Customer has a dog  ──┘
```

One deliberate detail: properties marked “pets on request” remain in the results. Excluding them would hide possible options. Their status remains visible so the assistant can explain that permission is still needed.

For example, the synthetic property `HH-1001` has a monthly price of €1,650 and pets allowed “on request.” That is a possible match, not approval for the customer's dog.

## Search the text when the fields are not enough

The heating question needs a different approach. The answer appears inside the description:

> “Utilities (Nebenkosten) are an additional 240 EUR per month, heating included.”

The retrieval system splits property descriptions into sentences and policy pages into sections. These small passages are called chunks. Each carries its source and an identifier for citations.

Search then happens in two stages:

```text
              “Is heating included in HH-1001?”
                              |
                              v
               Restrict the searchable material
               to HH-1001 + general policies
                              |
                  +-----------+-----------+
                  |                       |
                  v                       v
             Keyword search          Meaning search
                 BM25                Local embeddings
                  |                       |
                  +-----------+-----------+
                              |
                              v
                    Candidate passages
                              |
                              v
                 Local reranker scores each
                 question-and-passage pair
                              |
                              v
                   Relevance threshold
                     /             \
                    v               v
           Evidence + source ID   found: false
```

Keyword search helps with distinctive terms such as *Nebenkosten* and *Staffelmiete*. Meaning search helps with paraphrases and questions in German or English.

For meaning search, `multilingual-e5-small` converts text into numerical representations called embeddings. Similar representations help identify related passages.

The system collects up to 20 candidates from each search method and removes duplicates. A second model, `bge-reranker-v2-m3`, scores each candidate together with the question. Only passages above the configured threshold are returned.

Both models run locally through Transformers.js after their initial downloads. The conversational assistant is separate; local retrieval does not mean the whole conversation runs offline.

## The nearest passage may still be useless

The most useful finding in this project came from asking questions the data could not answer.

An embedding search can find the closest passage even when every passage is irrelevant. The system therefore needs a way to return “nothing suitable found.”

The project's recorded experiments show why this was difficult. An unanswerable gym question received an embedding similarity score of 0.832, while an answerable German pet question scored 0.784. A simple similarity cutoff could not reliably separate them.

A second attempt measured how much a passage stood out from the other candidates. That also failed on some unanswered questions.

Adding the reranker gave the project a better signal for deciding which passages to return. Its score is still a model output, not a guaranteed probability that an answer is correct. The threshold needs evaluation against the actual corpus.

Another experiment changed what went into the embeddings:

```text
Before:  Property title + location + passage  ──> Embedding
After:   Passage alone                      ──> Embedding
```

On the recorded 25 answerable questions, the expected passage appeared in the top five vector results for 20 questions with headers and 23 without them. Headers remain useful for keyword search and for the reranker, which reads each passage with its context.

This is a small experiment, but it changed the implementation: adding context was helpful in some parts of the search pipeline and harmful in another.

## Keep one property's facts separate from another's

When a question includes a listing ID, the code excludes other properties **before ranking**.

```text
Question about HH-1001
          |
          +── HH-1001 description       Included
          +── General agency policies  Included
          +── Other property records   Excluded
```

Among passages that pass the relevance threshold, the property's own passages come before general policies. A property's specific deposit amount should take precedence over a general explanation of deposits.

This is a boundary enforced by code. It does not depend on the assistant remembering to ignore another property's heating bill.

## A ticket is not a completed viewing booking

The hand-off tool supports six reasons:

- Viewing requests
- Price negotiations
- Contract or legal questions
- Complaints
- Personal data requests
- Questions the records cannot answer

A ticket includes its reason, a summary, an optional property ID and contact email, a timestamp, and a generated ID. The tool rejects unknown property IDs.

```text
“Can I view it Saturday?”
           |
           v
hand_off_to_human
reason: viewing_request
           |
           v
Ticket stored in memory
           |
           v
Human follow-up still required
```

Today, this is an in-memory queue. It does not send an email or reserve a calendar slot, and tickets disappear when the process stops.

## Check the answer before returning it

Slice 3 adds checks in `src/agent/guards.ts`. The loop runs them on a draft before returning it to the caller.

| Check | What the code looks for |
| --- | --- |
| Citation | Recognized citation markers must refer to listing or passage IDs returned by a tool during this run. |
| Number | Detected prices, areas, and percentages must match a number in a successful tool result or the original inquiry. |
| Missing evidence | A reply containing those figures must include at least one recognized citation. |
| Empty reply | The answer must contain text. |

For example, `[HH-1001#s5]` is accepted only if that passage ID appeared in the run's tool results. A newly invented price should fail the number check. German and English number formats are handled, so `1.650 €` can match `1650` in the record.

If a check fails, the user does not receive that draft. The model gets feedback and one repair opportunity, which may include more tool calls.

```text
                  Draft answer
                       |
                       v
                  Run checks
                  /        \
               Pass        Fail
                |            |
                v            v
          Return reply   Explain the violations
                             |
                             v
                       One repair attempt
                             |
                             v
                         Check again
                         /        \
                      Pass        Fail
                       |            |
                       v            v
                 Return reply   Code calls hand-off tool
                                and returns a fixed reply
```

The defaults also limit an inquiry to eight model calls, with an 80,000-token budget checked between calls, a 60-second model-call timeout, and a 30-second tool-call timeout. The loop initiates a hand-off when it reaches its turn or token limit, the model times out, or a final response is refused or truncated. Tool failures are returned to the model as errors it can react to; unrelated provider failures can still surface as errors.

These checks have a precise scope. They check whether recognized IDs and numbers appeared in the evidence, not whether each sentence correctly interprets that evidence. A real number attached to the wrong property can still pass. A reply without numerical claims can also omit citations without this guard catching it.

The prompt forbids arithmetic, but the number check only tests whether a value already appears somewhere in the allowed material. It cannot determine how the model arrived at that value. Likewise, the guards do not classify the inquiry to catch every forgotten viewing hand-off. Those are cases for the broader evaluation suite.

These answer checks belong to the built-in agent loop. An external assistant calling `/mcp` directly gets the tools and their validation, but does not automatically run its final answer through these guards.

## What the evaluation tells us

The repository records this retrieval result from September 28, 2026:

| Check | Recorded result |
| --- | --- |
| Expected passage among the first five results | 24 of 25 answerable questions |
| Unanswerable questions returning passages | 0 of 8 |
| Average time over the 33-question set | About 1.4 seconds per question on a laptop CPU |

The missed question asks in German whether a tenant must pay commission. The relevant passage never reaches the reranker because neither candidate search collects it.

That failure tells us where to investigate: candidate collection. A reranker cannot rescue a passage it never receives.

These numbers measure retrieval on a small development set also used for calibration. They are not an independent benchmark, a measure of final-answer accuracy, or proof that the assistant never invents facts.

Ordinary tests run with a deterministic substitute for the embedding model, without model downloads. A separate `pnpm test:model` command checks retrieval with the real models.

Slice 3 adds scripted-model tests for the loop, including invented citations, unsupported figures, repair behavior, and run limits. These make failure paths reproducible without paying for model calls.

The roadmap also records a successful real-model acceptance run on Amazon Bedrock on September 29, 2026. The German version of the opening inquiry produced a German reply, selected `HH-1001`, kept pets “on request,” cited `HH-1001#s5` for heating, and created one `viewing_request` ticket. The recorded run used four tool calls across three model turns.

The optional live agent test is recorded as passing too. That test uses a real conversational model with the offline retrieval substitute; it is separate from the real-retrieval model test. The recorded acceptance run is evidence that the workflow has been exercised, not a broad measure of its reliability.

## Two HTTP endpoints with different jobs

The HTTP server exposes both the agent and its underlying tools:

```text
Application sends an inquiry
           |
           v
    POST /inquiries
           |
           v
    Runs the agent loop
           |
           +── trace events: completed tool calls
           +── guard events: checks that failed
           +── result event: final reply and metadata

External MCP client
           |
           v
          /mcp
           |
           v
    Calls the tools directly
```

`/inquiries` uses server-sent events (SSE): one HTTP response carries a sequence of named events. It streams progress while tools run, then sends the completed answer. It does not currently stream the answer token by token.

The two routes share the underlying listing repository, knowledge base, and in-memory hand-off queue. The server binds to `127.0.0.1:3000` by default and currently has no authentication. The planned React interface will build on this API.

## Finding your way around the code

```text
data/             Synthetic properties and policy pages
src/domain/       Data definitions, filtering, ticket queue
src/retrieval/    Chunking, keyword search, models, ranking
src/mcp/          Tools, stdio, and Streamable HTTP transport
src/agent/        Model adapter, loop, answer checks, CLI
src/api/          HTTP server and inquiry event stream
test/             Tool, agent, guard, API, and retrieval tests
evals/            Retrieval questions and expected passages
scripts/          Index building and threshold calibration
```

If you open `dist/mcp/server.js`, you are looking at compiled JavaScript. The source to edit is `src/mcp/server.ts`. The adjacent `.js.map` file connects the generated JavaScript back to TypeScript for debugging.

The domain code has no MCP imports. The server receives the listing repository, knowledge base, and ticket queue as dependencies. That keeps the business rules testable without starting a desktop application.

The vector store is currently in memory, with embeddings cached on disk. For this small corpus, a separate database would add setup without solving an immediate problem.

## Try the current implementation

With Node.js 20 or newer and pnpm available, run these commands from the repository:

```bash
pnpm install
pnpm test
pnpm index
```

The first indexing run downloads the two retrieval models—approximately 120 MB and 570 MB—and prepares the local index. `pnpm inspect` lets you call the tools directly without involving a conversational model.

To use the agent, copy `.env.example` to `.env` and fill in credentials for your chosen provider. For the default Anthropic adapter, set `ANTHROPIC_API_KEY`. For Bedrock, set `MODEL_PROVIDER=bedrock`, an AWS region, and the relevant credentials. The CLI and HTTP server load `.env` automatically.

Then ask a question and show the tool trace:

```bash
pnpm ask --trace "Is heating included in HH-1001, and can I view it on Saturday?"
```

Use `--json` to get the full structured result. To expose the HTTP endpoints, run:

```bash
pnpm serve
```

Send `POST /inquiries` a JSON body such as:

```json
{"inquiry": "Is heating included in HH-1001, and can I view it on Saturday?"}
```

Agent runs call a remote model and use provider credentials. The scripted tests need neither. The optional live test runs when its credential conditions are met in the process environment; the test itself does not load `.env`.

After changing the corpus or model, `pnpm calibrate` reports scores and proposes thresholds. Those values are reviewed and copied into `retrieval.thresholds.json`; calibration does not automatically update that file.

## What comes next

```text
Built now                         Planned next
------------------------------    -------------------------------
MCP tools + local retrieval        React chat interface
Agent loop + CLI                   Visual tool trace and citations
Citation and number checks         Visible hand-off queue
One repair attempt, then hand-off  Broader end-to-end evaluations
HTTP inquiry event stream         Database integration and CI
Scripted tests + recorded live run
```

The next stage is making the working flow visible in a browser: a chat pane, an expandable tool trace, source citations, and a hand-off queue. Broader evaluations will then measure answer correctness and missed escalations across more inquiries.

The useful lesson so far is that retrieval, answer generation, and answer checking need separate tests. A search result can be relevant but misquoted. A citation can exist but support a different claim. The agent now makes those stages explicit, records what happened, and gives failed answer checks a defined path to a human.
