# proptech-inquiry-agent

An agent that answers and triages inquiries about property listings. It is built on an MCP server, so the
same tools work from Claude Desktop, Claude Code, the MCP Inspector or the agent loop in this repo.

All listing data is synthetic.

## Status

| Slice | What it adds | State |
|---|---|---|
| 1 | MCP server: structured search, listing lookup, hand-off to a human | done |
| 2 | Retrieval over listing text and a policy FAQ, exposed as an MCP tool | next |
| 3 | Agent loop that answers inquiries using the tools | planned |
| 4 | Eval suite: correct answers, correct escalations, no invented facts | planned |
| 5 | Architecture write-up | planned |

## The one design rule

The agent answers facts from the record and escalates everything else. Viewings, negotiation, contract and
legal questions, complaints, personal data requests and anything the record does not cover go to
`hand_off_to_human`. The boundary sits in the tool contract, not only in a prompt, so it can be tested.

## Tools

| Tool | Kind | Purpose |
|---|---|---|
| `search_listings` | read | Hard-criteria search. Returns summaries without description text. |
| `get_listing` | read | One full record. The model is told to answer only from its fields. |
| `hand_off_to_human` | write | Creates a ticket with a fixed reason code. Rejects unknown listing ids. |

## Worked example

One inquiry that uses all three tools: search on hard criteria, answer a detail from the record, and hand
off the part the agent may not handle.

> I have a small dog and want a flat in Hamburg under 2,000 € a month. Is heating included, and can I view
> it on Saturday?

**1. Search.** The dog and the budget are hard criteria.

```json
search_listings { "city": "Hamburg", "offerType": "rent", "propertyType": "apartment", "maxPrice": 2000, "hasPet": true }
```

This returns HH-1001 (Eimsbüttel, 1,650 EUR cold, pets `on-request`). HH-1002 is left out because it allows no pets.

**2. Look up the detail.** Heating is not a structured field, so the agent opens the full record.

```json
get_listing { "id": "HH-1001" }
```

The description says utilities are 240 EUR per month with heating included, which makes 1,890 EUR in total.
It also says "pets on request, small dogs usually fine".

**3. Hand off the viewing.** Booking a viewing is on the escalation list, so the agent does not agree to a date.

```json
hand_off_to_human {
  "reason": "viewing_request",
  "listingId": "HH-1001",
  "summary": "Wants a Saturday viewing of HH-1001. Has a small dog; pets are on request, so the landlord needs to confirm.",
  "contactEmail": null
}
```

**Expected answer**

- HH-1001 fits the budget: 1,650 EUR cold plus 240 EUR utilities, 1,890 EUR in total.
- Heating is included in the utilities.
- Pets are on request. The listing says small dogs are usually fine, but that is not a yes.
- The Saturday request has gone to the letting team, and they will confirm the time. The agent asks for an
  email address if it does not have one.

**The agent must not**

- say the dog is allowed,
- confirm or suggest a viewing slot,
- quote a heating figure that is not in the record.

## Run it

```bash
npm install
npm test          # unit tests plus MCP client round-trip tests
npm run inspect   # open the MCP Inspector against the server
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "proptech-inquiry": { "command": "npx", "args": ["tsx", "/path/to/proptech-inquiry-agent/src/mcp/stdio.ts"] }
  }
}
```

## Layout

```
data/listings.json     synthetic catalogue, validated with zod at load
src/domain/            listing model, repository, hand-off queue (no MCP imports)
src/mcp/server.ts      tool definitions; takes its dependencies as arguments
src/mcp/stdio.ts       stdio entry point
test/                  repository tests and in-memory MCP client tests
```

## License

MIT
