# Decisions

## 2026-10-30 — Task A: observation model and local store

- Implement only holdings observation persistence. The current API flow has no cash, external flows or past fills; no actual account return can be calculated from it.
- Use small server-only modules (`history-model`, `history-store`, `history-recorder`) and two optional reader hooks. Avoid broad edits to the large application/dashboard modules.
- Default to OS user data outside the checkout/OneDrive project and reject configured storage inside the application root. No Vercel history API. This is plaintext local storage, not encrypted storage or multi-user server authentication.
- Preserve first-account connector behavior. Partition by PC-salted broker/client/account identity; never serialize API keys or account numbers.
- Treat read failures as separate no-valuation observations. Keep successful holdings available if disk storage fails and show an explicit save failure.
- Future CSV/TWR/XIRR/monthly analysis and My Performance UI are deferred. This commit supplies their data foundation only.
- Add an always-short `AGENTS.md` and a feature map; avoid rereading the historical worklog for routine changes. Token savings have not been measured.

## Existing boundaries retained

Live orders excluded. User profiles are browser-local. Real account reads use each PC's broker bridge. Three-month strategy comparison is a counterfactual using current selections. News search is not an implemented LLM investment decision or a past-news backtest.

### Validation
Targeted history/broker/bridge tests and the full 58-test regression pass with synthetic fixtures. Tested restart persistence, concurrent duplicates, account partitioning, corrupted records, cloud/public-root guards and non-blocking recording failure. No real holdings were fetched for these tests.


## 2026-10-30 — User-authorized follow-up

Implemented common CSV import, private immutable datasets with recoverable archive/restore, investment P/L versus deposits, strict flow-boundary TWR, annualized XIRR, observation-based MDD, monthly observed periods, moving-average trade P/L and same-currency benchmark comparison. New UI remains modular; app.js changes only by adding one import.

Do not use the broker market tape as personal transactions. The public /orders endpoint excludes some order types and does not supply a complete equity/external-flow ledger. Start with common CSVs; do not claim native exports or automatic full-account performance. CSV source/coverage is user-confirmed and not independently reconciled with the broker. Recorded decision match is not algorithmic backverification.

A prototype calculation should fail visibly with missing data or ambiguous XIRR roots. Real account data is not used for QA. Test/demo fixtures remain explicitly synthetic. No broker order creation or editing is added.

### Follow-up validation
All 75 regression tests pass, including 17 performance tests. Checked hand-calculated flow-linked TWR, Excel's published XIRR example, zero-equity/full-withdrawal intervals, timezone grouping, missing coverage, trade costs, benchmark freshness, restart persistence, cloud guards and recoverable archive/restore. Browser QA used only synthetic CSVs: import, insufficient-coverage state, preview, local save/reload, archive/restore and public index comparison. The DEMO's 13.4375% TWR and 130,000 KRW P/L are example arithmetic, never the user's returns. Public market requests contain only the benchmark symbol/range; account CSVs are processed in browser memory and optionally saved to the paired PC. Archive files and active files remain plaintext on that PC. No production multi-user authentication or independent strategy replay is claimed.
