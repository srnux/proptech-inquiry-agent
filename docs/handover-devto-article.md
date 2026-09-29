# Handover: revise the dev.to article

## Goal

Revise `docs/devto-article.md` so that a dev.to visitor who has never seen this repository understands what it
is, why it is interesting, and how to run it. The body is already a thorough, accurate tour. The work is a new
title and front matter plus a handful of targeted additions. Do not rewrite the article.

## Context

- Repository: https://github.com/srnux/proptech-inquiry-agent (branch `slice-4-react-ui`).
- The project is a TypeScript agent that answers property inquiries from synthetic records via MCP tools,
  hands off what it cannot answer (viewings, negotiation, legal, unknowns) to a human ticket queue, and runs
  citation and number checks on every draft before the user sees it. A React web app shows the chat, the
  tool-call trace and the hand-off queue. It runs without an API key on a rule-based demo model.
- `docs/devto-article.md` has uncommitted edits in the working tree. Build on the current file, not on `HEAD`.
- Sources of truth for facts: `README.md`, `DECISIONS.md` (numbered decisions), `ROADMAP.md`, and the code.
  If the article and the code disagree, the code wins; mention any such discrepancy in your summary.
- Keep the article's existing voice: plain, precise, short paragraphs, ASCII diagrams, and explicit statements
  of what each check does *not* cover. No marketing language, no emojis.

## Tasks

### 1. Replace the front matter

Current title ("Building a Property Inquiry Desk with React, MCP, and Local Search") reads like a tutorial,
uses the project's internal term "desk" and never says "agent" or "RAG". The chosen title keeps the stack
but names the project an agent and the retrieval hybrid RAG (BM25 keyword search plus local embeddings,
then a reranker). "Hybrid" rather than "local" avoids implying the whole system runs offline.

Replace lines 1–6 with:

```yaml
---
title: "A Property Inquiry Agent with React, MCP, and Hybrid RAG"
published: false
description: "A TypeScript agent that answers property questions from cited records, hands viewings and unknowns to a person, and rejects drafts with invented figures. Runs locally without an API key."
tags: ai, typescript, mcp, rag
---
```

Keep `published: false`. dev.to allows at most four tags.

### 2. Link the repository

The article never links the repo. Add the GitHub URL:

- in the intro paragraph that introduces `proptech-inquiry-agent` (currently around line 16), and
- at the start of the section "Try the current implementation".

### 3. Set expectations early

Readers only learn in the last section that this is work in progress. Add one or two sentences to the intro
(around line 18) saying the project is built in slices, slices 1–4 are done (MCP server, hybrid retrieval,
agent loop with answer checks, web app), and an evaluation suite is next. See the status table in `README.md`.

### 4. Document conversation history (latest feature, missing from the article)

Commit `8b45f4d` added follow-up support. Read `DECISIONS.md` decision 31 and
`packages/core/src/agent/conversation.ts`, `packages/core/src/agent/loop.ts`,
`packages/server/src/api/inquiries.ts` before writing. Facts to convey:

- `POST /inquiries` accepts an optional `history`: up to five earlier `{inquiry, reply}` pairs, oldest first.
  More than five is a 400; the client decides what to drop.
- The web app sends the answered exchanges on screen; "New conversation" clears them. The server stores
  nothing between requests.
- History is context, not evidence. Earlier replies go to the model as plain text without their tool results,
  and the guards count only the current run's tool results. A follow-up that repeats a citation or figure from
  an earlier reply must look it up again or fail the check. Figures the inquirer stated in earlier turns count
  as the inquirer's own.
- Rejected alternatives worth one sentence: replaying earlier tool results, server-side sessions, model
  summaries of earlier turns.

Placement: a short subsection (e.g. "Follow-up questions") after "What happens behind the interface", or
after "Check the answer before returning it", since the key point is how it interacts with the guards. Also
update the `POST /inquiries` JSON example in "Try the current implementation" or add a second example showing
`history`. Verify the exact request field names against `inquiries.ts`.

Also mention in the UI section that follow-ups such as "and the deposit?" work.

### 5. Align the setup steps with the README

The README quick start runs `corepack enable` before `pnpm install`; the article does not. Add it to the
bash block in "Try the current implementation" with the same comment as the README. Cross-check the other
commands (`pnpm dev`, `pnpm ask`, `pnpm serve`, `pnpm test`, `pnpm test:e2e`, `pnpm calibrate`,
`pnpm inspect`) against the root `package.json` scripts.

### 6. Screenshot placeholder

Below the three-pane ASCII diagram (around lines 24–36), add an HTML comment placeholder for a screenshot
of the web app, e.g. `<!-- TODO: screenshot of the web app with the viewing example answered -->`. Do not
generate or embed an image. Keep the ASCII diagram.

## Out of scope

- Do not change code, `README.md`, `DECISIONS.md` or anything under `apps/` or `packages/`.
- Do not restructure or shorten existing sections beyond what the tasks above require.
- Do not publish, commit or push.

## Done when

- Front matter matches task 1.
- Repo URL appears at least twice.
- Conversation history is explained and every claim about it matches decision 31 and the code.
- Setup commands match `README.md` and `package.json`.
- The article still reads end to end without contradictions, e.g. the "What remains to be proven" section
  still matches `ROADMAP.md`.
- Reply with a short summary of the changes and any discrepancies you found between the article and the code.
