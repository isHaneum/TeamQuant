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
