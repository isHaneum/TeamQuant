# Code map

Start here; read only the relevant row's files. Most UI modules contain their own markup.

| Work | Files |
|---|---|
| Two-menu composition / future authentication | `workspace-ui.js`, `workspace.css`, `lib/holdings-overview.js`, `test/holdings-overview.test.js`, `docs/AUTH_UI_ARCHITECTURE.md` |
| Goal / ETF allocation / approved monthly paper ledger | `planner-ui.js`, `planner.css`, `lib/goal-engine.js`, `lib/allocation-planner.js`, `lib/investment-store.js`, `docs/GOAL_ALLOCATION_SPEC.md`, `test/investment.test.js` |
| CSV parsing / returns / trade basis | `lib/performance-import.js`, `lib/performance-math.js`, `test/performance.test.js` |
| Private dataset persistence | `lib/performance-store.js`; API dispatch in `lib/local-bridge.js` |
| My Performance UI / benchmark | `performance-ui.js`, `performance-view-ui.js`, `lib/performance-benchmark.js` |
| Local history / Task A | `lib/history-model.js`, `lib/history-store.js`, `lib/history-recorder.js`, `test/history.test.js` |
| Actual order / aggregate execution history | `orders-ui.js`, `lib/toss-orders.js`; reader in `lib/toss.js`, bridge in `lib/local-bridge.js`; `test/toss-orders.test.js` |
| Broker read + observation hook | `lib/toss.js` (`createTossReader`), `dev-server.mjs` (recorder wiring) |
| Windows quick launch / key availability | `launch-personal-server.mjs`, `lib/local-launcher.js`, `lib/local-status.js`, `test/local-launcher.test.js` |
| PC authorization | `lib/local-bridge.js`, `bridge-client.js`, `test/local-bridge.test.js` |
| Real holdings display | `toss-ui.js`; copied paper workspace / owned-basket tests: `asset-hub-ui.js`, `lib/asset-workspace.js` |
| Strategy input | `lib/natural-language.js`, `lib/backtest.js`; approval wiring in `app.js` |
| Three-month counterfactual | `journey-ui.js`, `lib/comparison.js` |
| Manual/demo/paper portfolio | `lib/portfolio.js`; presentation in `overview-ui.js` |
| Price / products | `lib/market.js`, `lib/instruments.js`, `lib/product-catalog.js`, `lib/stocks.js` |
| News | `lib/news.js`, `api/news.js`, `news-ui.js` |
| Chart / type | `lib/performance-view.js`, `typography.css`; older layout: `styles.css`, `overview.css` |
| Tutorial | `help-ui.js`, `START-HERE.md` |

- `api/*.js` runs on Vercel. `dev-server.mjs` runs only on loopback; history and imported datasets are wired here only.
- Do not open `.env.local`, key files, history records, personal exports or large `data/` catalogs to locate code.
- Local source retains ML research; the deployed source omits its UI. Preserve that distinction when packaging.
- Tests: `node --test test/history.test.js test/toss.test.js test/local-bridge.test.js`; performance: `node --test test/performance.test.js`; orders: `node --test test/toss-orders.test.js`; regression: `npm test`.
- `downloads/TeamQuant-PC.zip` is a generated source-only artifact, not a source of truth. Rebuild it from an explicit source allowlist when PC-server code changes; never include runtime history or credentials.
