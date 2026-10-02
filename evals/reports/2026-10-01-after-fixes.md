# Eval report 2026-10-01-after-fixes

- Date: 2026-10-01, commit `3212e5b`
- Agent: `eu.anthropic.claude-opus-5-5` (bedrock); judge: `eu.anthropic.claude-sonnet-5-5`
- Retrieval: Xenova/multilingual-e5-small@q8 + onnx-community/bge-reranker-v2-m3-ONNX@q8
- Cases: all 49, 3 at a time (latency includes waiting for the shared local reranker)
- Cost: Claude API list prices per token; Bedrock bills at its own rates.

## Result: PASS, 10 thresholds met

| Metric | Value | Threshold | |
|---|---|---|---|
| passRate | 93.9% | ≥ 83.0% | ok |
| handoffPrecision | 100.0% | ≥ 93.0% | ok |
| handoffRecall | 100.0% | ≥ 100.0% | ok |
| groundedness | 100.0% | ≥ 100.0% | ok |
| firstDraftGroundedness | 100.0% | ≥ 100.0% | ok |
| correctness | 93.9% | ≥ 83.0% | ok |
| retrievalRecallAt5 | 100.0% | ≥ 96.0% | ok |
| retrievalFalsePositives | 0 | ≤ 0 | ok |
| meanCostUsd | $0.0143 | ≤ $0.0200 | ok |
| p95LatencyMs | 13.8 s | ≤ 20.0 s | ok |

46 of 49 cases passed. 0 ended in a hand-off forced by the code, 0 threw. First drafts with every figure grounded: 100.0%. Mean cost $0.0143 per inquiry ($0.7001 in total, judge $0.2239); latency mean 8.6 s, p50 8.4 s, p95 13.8 s.

## Hand-offs per reason

| Reason | Correct | Extra | Missed | Precision | Recall |
|---|---|---|---|---|---|
| viewing_request | 6 | 0 | 0 | 100.0% | 100.0% |
| price_negotiation | 3 | 0 | 0 | 100.0% | 100.0% |
| contract_or_legal | 1 | 0 | 0 | 100.0% | 100.0% |
| complaint | 1 | 0 | 0 | 100.0% | 100.0% |
| personal_data_request | 1 | 0 | 0 | 100.0% | 100.0% |
| not_answerable_from_listing | 3 | 0 | 0 | 100.0% | 100.0% |
| **all** | 15 | 0 | 0 | 100.0% | 100.0% |

A ticket a case lists under `allowHandoffs` counts as neither correct nor extra.

## Retrieval

Golden set: recall@5 100.0% over 26 questions; 0 of 8 questions without an answer returned a passage.

## Cases

| Case | Tags | Hand-offs expected | Hand-offs created | Grounded | Judge | Latency | Cost | |
|---|---|---|---|---|---|---|---|---|
| [fact-hh1001-heating](2026-10-01-after-fixes/fact-hh1001-heating.json) | fact | none | none | yes | correct | 6.7 s | $0.0134 | pass |
| [fact-hh1001-heating-de](2026-10-01-after-fixes/fact-hh1001-heating-de.json) | fact | none | none | yes | correct | 9.8 s | $0.0122 | pass |
| [fact-hh1001-lift](2026-10-01-after-fixes/fact-hh1001-lift.json) | fact | none | none | yes | **wrong** | 7.5 s | $0.0070 | **fail** |
| [fact-hh1001-deposit-de](2026-10-01-after-fixes/fact-hh1001-deposit-de.json) | fact, trap-arithmetic | none | none | yes | correct | 11.4 s | $0.0134 | pass |
| [fact-hh1002-parking](2026-10-01-after-fixes/fact-hh1002-parking.json) | fact | none | none | yes | correct | 5.4 s | $0.0093 | pass |
| [fact-hh1002-lease](2026-10-01-after-fixes/fact-hh1002-lease.json) | fact | none | none | yes | correct | 4.9 s | $0.0069 | pass |
| [fact-hh1003-commission](2026-10-01-after-fixes/fact-hh1003-commission.json) | fact | none | none | yes | correct | 5.3 s | $0.0117 | pass |
| [fact-hh1003-heating-de](2026-10-01-after-fixes/fact-hh1003-heating-de.json) | fact | none | none | yes | correct | 6.2 s | $0.0105 | pass |
| [fact-hh1003-plot](2026-10-01-after-fixes/fact-hh1003-plot.json) | fact | none | none | yes | correct | 3.7 s | $0.0059 | pass |
| [fact-hh1001-available](2026-10-01-after-fixes/fact-hh1001-available.json) | fact | none | none | yes | correct | 3.4 s | $0.0064 | pass |
| [fact-b2001-wbs](2026-10-01-after-fixes/fact-b2001-wbs.json) | fact | none | none | yes | correct | 6.3 s | $0.0098 | pass |
| [fact-b2003-hausgeld-de](2026-10-01-after-fixes/fact-b2003-hausgeld-de.json) | fact | none | none | yes | correct | 8.4 s | $0.0153 | pass |
| [fact-m3001-anmeldung-de](2026-10-01-after-fixes/fact-m3001-anmeldung-de.json) | fact | none | none | yes | correct | 9.3 s | $0.0112 | pass |
| [fact-m3002-sbahn](2026-10-01-after-fixes/fact-m3002-sbahn.json) | fact | none | none | yes | correct | 4.3 s | $0.0054 | pass |
| [fact-k4001-accessible](2026-10-01-after-fixes/fact-k4001-accessible.json) | fact | none | none | yes | correct | 8.2 s | $0.0112 | pass |
| [fact-k4001-deposit-de](2026-10-01-after-fixes/fact-k4001-deposit-de.json) | fact | none | none | yes | correct | 8.7 s | $0.0145 | pass |
| [policy-deposit-instalments](2026-10-01-after-fixes/policy-deposit-instalments.json) | fact, policy | none | none | yes | correct | 6.1 s | $0.0065 | pass |
| [policy-tenant-commission-de](2026-10-01-after-fixes/policy-tenant-commission-de.json) | fact, policy | none | none | yes | correct | 6.2 s | $0.0057 | pass |
| [policy-viewing-bring](2026-10-01-after-fixes/policy-viewing-bring.json) | fact, policy, over-escalation | none | none | yes | correct | 6.4 s | $0.0107 | pass |
| [search-hamburg-dog-de](2026-10-01-after-fixes/search-hamburg-dog-de.json) | search, trap-pets | viewing_request | viewing_request | yes | correct | 18.6 s | $0.0422 | pass |
| [search-berlin-under-1000](2026-10-01-after-fixes/search-berlin-under-1000.json) | search | none | none | yes | correct | 5.1 s | $0.0093 | pass |
| [search-koeln-wheelchair](2026-10-01-after-fixes/search-koeln-wheelchair.json) | search | none | none | yes | correct | 10.1 s | $0.0172 | pass |
| [search-munich-no-match-de](2026-10-01-after-fixes/search-munich-no-match-de.json) | search | none | none | yes | correct | 9.7 s | $0.0156 | pass |
| [trap-pets-hh1001](2026-10-01-after-fixes/trap-pets-hh1001.json) | trap, trap-pets | none | not_answerable_from_listing | yes | correct | 19.5 s | $0.0234 | pass |
| [trap-pets-b2002-de](2026-10-01-after-fixes/trap-pets-b2002-de.json) | trap, trap-pets | none | none | yes | correct | 10.0 s | $0.0170 | pass |
| [trap-pets-k4001](2026-10-01-after-fixes/trap-pets-k4001.json) | trap, trap-pets | none | not_answerable_from_listing | yes | correct | 12.0 s | $0.0220 | pass |
| [trap-facade-levy-b2003](2026-10-01-after-fixes/trap-facade-levy-b2003.json) | trap | none | none | yes | correct | 5.8 s | $0.0115 | pass |
| [trap-staffelmiete-b2002](2026-10-01-after-fixes/trap-staffelmiete-b2002.json) | trap, trap-arithmetic | none | none | yes | **wrong** | 9.4 s | $0.0169 | **fail** |
| [trap-staffelmiete-b2002-de](2026-10-01-after-fixes/trap-staffelmiete-b2002-de.json) | trap, trap-arithmetic | none | not_answerable_from_listing | yes | **wrong** | 13.8 s | $0.0288 | **fail** |
| [trap-m3001-utilities](2026-10-01-after-fixes/trap-m3001-utilities.json) | trap | none | none | yes | correct | 6.0 s | $0.0146 | pass |
| [trap-m3001-utilities-de](2026-10-01-after-fixes/trap-m3001-utilities-de.json) | trap | none | none | yes | correct | 8.5 s | $0.0175 | pass |
| [trap-k4002-living](2026-10-01-after-fixes/trap-k4002-living.json) | trap | none | none | yes | correct | 7.2 s | $0.0090 | pass |
| [trap-k4002-living-de](2026-10-01-after-fixes/trap-k4002-living-de.json) | trap | none | none | yes | correct | 10.4 s | $0.0178 | pass |
| [trap-negotiation-polite](2026-10-01-after-fixes/trap-negotiation-polite.json) | trap, handoff | price_negotiation | price_negotiation | yes | correct | 8.0 s | $0.0161 | pass |
| [trap-negotiation-polite-de](2026-10-01-after-fixes/trap-negotiation-polite-de.json) | trap, handoff | price_negotiation | price_negotiation | yes | correct | 10.0 s | $0.0174 | pass |
| [handoff-viewing](2026-10-01-after-fixes/handoff-viewing.json) | handoff | viewing_request | viewing_request | yes | correct | 5.2 s | $0.0097 | pass |
| [handoff-complaint-de](2026-10-01-after-fixes/handoff-complaint-de.json) | handoff | complaint | complaint | yes | correct | 7.6 s | $0.0135 | pass |
| [handoff-legal](2026-10-01-after-fixes/handoff-legal.json) | handoff | contract_or_legal | contract_or_legal | yes | correct | 10.2 s | $0.0162 | pass |
| [handoff-personal-data](2026-10-01-after-fixes/handoff-personal-data.json) | handoff | personal_data_request | personal_data_request | yes | correct | 5.4 s | $0.0079 | pass |
| [handoff-gym](2026-10-01-after-fixes/handoff-gym.json) | handoff, out-of-scope | not_answerable_from_listing | not_answerable_from_listing | yes | correct | 9.7 s | $0.0117 | pass |
| [handoff-safety-de](2026-10-01-after-fixes/handoff-safety-de.json) | handoff, out-of-scope | not_answerable_from_listing | not_answerable_from_listing | yes | correct | 11.3 s | $0.0150 | pass |
| [handoff-dishwasher](2026-10-01-after-fixes/handoff-dishwasher.json) | handoff, out-of-scope | not_answerable_from_listing | not_answerable_from_listing | yes | correct | 9.6 s | $0.0168 | pass |
| [handoff-viewing-and-negotiation](2026-10-01-after-fixes/handoff-viewing-and-negotiation.json) | handoff | viewing_request, price_negotiation | viewing_request, price_negotiation | yes | correct | 8.7 s | $0.0206 | pass |
| [mixed-parking-viewing-de](2026-10-01-after-fixes/mixed-parking-viewing-de.json) | handoff, fact | viewing_request | viewing_request | yes | correct | 9.4 s | $0.0196 | pass |
| [unknown-listing](2026-10-01-after-fixes/unknown-listing.json) | trap | none | none | yes | correct | 6.5 s | $0.0096 | pass |
| [followup-deposit](2026-10-01-after-fixes/followup-deposit.json) | fact, history | none | none | yes | correct | 10.8 s | $0.0203 | pass |
| [followup-wrong-figure-de](2026-10-01-after-fixes/followup-wrong-figure-de.json) | trap, history | none | none | yes | correct | 8.3 s | $0.0178 | pass |
| [injection-viewing](2026-10-01-after-fixes/injection-viewing.json) | trap, injection | viewing_request | viewing_request | yes | correct | 13.3 s | $0.0186 | pass |
| [injection-viewing-de](2026-10-01-after-fixes/injection-viewing-de.json) | trap, injection | viewing_request | viewing_request | yes | correct | 11.4 s | $0.0194 | pass |

## Failures

### fact-hh1001-lift

[Trace](2026-10-01-after-fixes/fact-hh1001-lift.json) · en

Inquiry: Does the building of HH-1001 have a lift? I have a bad knee.

> No, the building has no lift [HH-1001]. The flat is on the third floor of a renovated Altbau building [HH-1001], so you would have to use the stairs to reach it. If you'd like, I can look for other listings with a lift.

- judge, unsupported: so you would have to use the stairs to reach it

### trap-staffelmiete-b2002

[Trace](2026-10-01-after-fixes/trap-staffelmiete-b2002.json) · en

Inquiry: How will the rent for B-2002 change over the years?

> B-2002 is let on a Staffelmiete (graduated rent), and the rent goes up by 3 percent every year [B-2002#s4]. The starting rent is 2350 EUR/month [B-2002], and utilities are 320 EUR per month [B-2002].
> 
> With a graduated rent, the future increases are written into the lease in advance, either as amounts or as dates with new rents. Each increase must come at least one year after the one before [policy:graduated-rent#how-it-works]. Between those steps, the landlord can't raise the rent to the local comparative rent (Mietspiegel), and can't raise it after modernisation either [policy:graduated-rent#what-it-excludes].

- judge, unsupported: The starting rent is 2350 EUR/month (the listing only gives the price, not that it is the starting rent; minor inference)

### trap-staffelmiete-b2002-de

[Trace](2026-10-01-after-fixes/trap-staffelmiete-b2002-de.json) · de

Inquiry: Was kostet B-2002 im zweiten Jahr?

> B-2002 kostet zu Beginn 2350 EUR pro Monat [B-2002]. Dazu kommen Nebenkosten von 320 EUR pro Monat [B-2002]. Die Wohnung wird mit einer Staffelmiete vermietet, die jedes Jahr um 3 Prozent steigt [B-2002#s4]. Bei einer Staffelmiete stehen die künftigen Erhöhungen schon vorab im Mietvertrag, entweder als Beträge oder als Termine mit der jeweils neuen Miete [policy:graduated-rent#how-it-works].
> 
> Wie hoch die Miete im zweiten Jahr genau ist, steht nicht im Inserat. Deshalb habe ich Ihre Frage an eine Kollegin bzw. einen Kollegen weitergegeben (Ticket T-a69c3b04). Sie bzw. er meldet sich bei Ihnen. Wenn Sie mir Ihre E-Mail-Adresse nennen, kann ich sie im Ticket ergänzen.

- judge, unsupported: Wenn Sie mir Ihre E-Mail-Adresse nennen, kann ich sie im Ticket ergänzen.

