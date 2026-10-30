# Code map

Start here; read only the relevant row's files. Most UI modules contain their own markup.

| Work | Files |
|---|---|
| CSV parsing / returns / trade basis | `lib/performance-import.js`, `lib/performance-math.js`, `test/performance.test.js` |
| Private dataset persistence | `lib/performance-store.js`; API dispatch in `lib/local-bridge.js` |
| My Performance UI / benchmark | `performance-ui.js`, `performance-view-ui.js`, `lib/performance-benchmark.js` |
| Local history / Task A | `lib/history-model.js`, `lib/history-store.js`, `lib/history-recorder.js`, `test/history.test.js` |
| Broker read + observation hook | `lib/toss.js` (`createTossReader`), `dev-server.mjs` (recorder wiring) |
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
- Tests: `node --test test/history.test.js test/toss.test.js test/local-bridge.test.js`; performance: `node --test test/performance.test.js`; regression: `npm test`.
- `downloads/TeamQuant-PC.zip` is a generated source-only artifact, not a source of truth. Rebuild it from an explicit source allowlist when PC-server code changes; never include runtime history or credentials.
