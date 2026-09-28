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
