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
