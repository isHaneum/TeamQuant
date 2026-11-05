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


## 2026-11-02 — Existing-key connection friction

The user already has a working local Toss key. Do not ask for it again or confuse a browser profile with broker authentication. Add a Windows launcher that reuses the recognized loopback service or starts it hidden, then opens the local account view after the existing profile flow. Never terminate an unknown listener or change OS startup/security policy. Key status reports file availability only, not OAuth validity or contents. The same bridge Origin/Host/POST/capability gates remain. Local account-view entry triggers a read and reuses same-profile results for one minute; manual/5-minute refresh remains. Clear, logout and profile-change invalidation must prevent stale data reuse. Remote pairing duration and one-use code are unchanged. Private evaluation/portfolio review documents must not enter deployment archives.

Validation: 80 regression tests pass (5 new status/launcher tests). Synthetic browser QA confirms first-entry automatic query, same-profile one-minute reuse (one read across repeat navigation), and clear removes the displayed holdings. No private key values are read for setup checks, copied into public files or sent to Vercel.


## 2026-11-02 — Read-only broker orders and aggregate executions

User explicitly requested actual order/fill history after reviewing Toss OpenAPI1.2.28. Reuse the existing reader's OAuth token and first brokerage account. GET /api/v1/orders only; no mutations, no browser raw broker order IDs/account references. Normalize hashes, numeric/null fields, order-creation KST boundaries, native-currency costs and aggregate fill details. Include canceled/partial fills without treating an unfilled/canceled order as a trade. Accept unknown status/type codes without inventing semantics. No individual-fill sequence, all-order-type coverage, realized P/L, account TWR or independent compliance claim.

Existing local Host/Origin/POST/remote-pairing guards apply before history callbacks, without requiring a holdings snapshot. Server fetches at most8pages; overlapping identical orders deduplicate, changing rows/cursor cycles/bounds/late failure visibly mark partial coverage. Browser keeps data in memory only, resets on profile/data clear, and exports sanitized JSON on explicit user action. No permanent order history files are generated by this feature. Do not convert aggregate final-fill timestamps into supposedly complete trade CSVs automatically.

Spec: https://openapi.tossinvest.com/openapi-docs/latest/openapi.json . Local endpoint /api/bridge/order-history is a read action transported over POST; upstream orders use GET exclusively. Current cash/holdings/CSV boundaries remain unchanged.

Order responses may be reused briefly in PC server memory (closed30seconds/open5seconds, up to8queries); same-query in-flight reads deduplicate. No automatic order files are persisted. Rate-limit messages honor a numeric Retry-After when provided.

Validation: all90regression tests pass (10new order-history tests). Synthetic browser verifies45-order pagination, excluding unfilled orders while retaining canceled partial fills, per-currency unknown costs, and sanitized JSON download. The existing real account key successfully read a recent3-month closed-order response through its final page; private order records/IDs/amounts were not written to project files or public artifacts. Initial provider rate limiting cleared on a later request; it must remain a visible error, not an empty-success result.


## 2026-11-02 — Goal & Allocation Planner

Build the first complete goal → monthly allocation → approval → paper execution → persisted next-plan loop as separate deterministic modules. Existing holdings, read-only order history, CSV performance, technical-rule backtests and paper workspaces remain intact. Personal goal drafts live only in private PC storage; no user goals, holdings or credentials in public source, deployment or QA artifacts.

Goal projections distinguish future end-of-month contributions, paid-in capital and assumed growth; explicit contribution start supports a future start date. Required return is a mathematical condition, not evidence it is attainable. ETF target weights, cost/risk limits, reference prices, virtual cash and FX require user confirmation. Two buy-only scenarios use new funds, preserve existing cash and frozen unsupported holdings, and expose remaining deviation after lot/cost rounding. Do not present a heuristic as a global integer optimum.

2026-11-02 — 개인용 자산 홈은 PC 브리지의 토스 보유주식 스냅샷을 탭 메모리에서만 받아 요약한다. 이 경로는 현금·총자산·외부 입출금·완전한 평가 이력을 받지 않으므로, 화면은 보유주식 평가액/보유원가 기준 손익만 표시하고 계좌 수익률·손익 기여도는 미확인으로 표기한다. 로그인 체험 프로필과 PC 브리지 권한은 계속 독립적이다. 장치 지속 재인증, 다중 사용자 인증 및 원격 자동 연결은 구현하지 않으며 기존 1회 코드, Origin/Host 검사와 만료 정책을 변경하지 않는다.

Server approval freezes settings/quotes and recalculated plan hash. Execution rechecks the current revision, month and constraints, records one monthly contribution atomically, and is idempotent for an already executed approval. Settings changes invalidate approval. A future contribution start, stale reference, unresolved cash/position-limit breach or incorrect targets blocks approval. Private per-ledger file locks prevent simultaneous writes. This is PC-authorized storage, not multi-user financial authentication, encrypted storage or tamper-proof auditing.

Defer full performance attribution, historical plan-adherence claims, AI decision synthesis and real trading until their input coverage and execution boundaries are implemented. UI clearly labels the separate monthly paper ledger and synthetic memory-only DEMO. See GOAL_ALLOCATION_SPEC.md for calculation/persistence boundaries and tests.

Validation: 103 regression tests pass (13 new tests, including 200 deterministic lot/currency/cost scenarios). Synthetic browser QA verifies no-ETF goal calculation, two allocation scenarios, separate approval and execution, persistent PC reload and duplicate-month prevention. The test portfolio is synthetic, not a private account.

## 2026-11-02 — Authentication architecture and navigation stage 1

See AUTH_UI_ARCHITECTURE.md for six requested design deliverables and official provider sources/unknowns. workspace-ui composes existing views into My Assets and Strategy Lab, moves profile/logout/PC connection/FAQ into Settings, and preserves node IDs, listeners and all storage keys. Only one shared bridge form is displayed; older forms remain hidden to preserve handlers. No financial authorization is derived from the demo PIN. Existing bridge guards and expiry are unchanged; BFF/IdP/MFA/user-owned database/device pairing are future work, not implemented capabilities. Regression:103 pass. Synthetic browser checks main menus, strategy navigation, settings forms, demo planner and performance views.


## 2026-11-02 — Personal asset home release review
BAZE execution finished local work; parent review corrected native USD amounts displayed as KRW, removed invented zero cash from broker input, deferred whole-account concentration/cash rules, prevented broker news from entering browser persistence or public news requests, and cleared home observations on disconnect. Dedicated holdings-overview pure adapter retains unknown cash/returns/FX. Actual acquisition FX returns are not inferred. Home has PC goal/paper-plan summary and native-currency observed holdings history with explicit scope. Existing single-owner bridge and ephemeral remote pairing stay unchanged. No MFA, multi-user finance authorization, perpetual device pairing or real orders are claimed. 105 regression tests pass, including two new FX/unknown-data tests. Deployment uses the explicit source package with no keys, private intent, financial records or BAZE task logs.

## 2026-11-02 Remembered personal browser
- Explicit first pairing code registers a P-256 public key on the private PC for 30 days. The non-extractable private CryptoKey lives in browser IndexedDB; bearer sessions remain memory-only and last one hour.
- Fresh one-use 60-second challenges authorize reconnect, including after PC restart. Origin, device and profile are bound; revoke blocks existing sessions. PC settings can revoke all browsers.
- Optional profile retention saves only profile name and expiry. It is not financial authentication. Logout revokes the short session; explicit connection removal revokes remembered trust.
- Same-origin script/XSS and compromised device remain risks. This is a single-owner PC bridge, not multi-user account isolation, MFA or cloud authentication. Browser storage deletion requires pairing again. PC must remain running.
- No brokerage keys or financial snapshots are persisted in the browser by this feature. No cross-site cookie dependence, cloud custody or trading permission added.

## 2026-11-02 Account-first connected workspace
- Asset home now waits for an actual account snapshot; no demo, default paper cash or silent fallback. Successful empty holdings are distinct from failure. Real cash/account returns remain unknown when not provided.
- Reused private owned-basket comparison and paper panels in Strategy Lab, preserving their IDs, live snapshot and approved strategy. Legacy independent research/paper controls remain collapsed. No real positions are written to browser storage by this integration.
- Strategy version changes clear prior checks/comparisons; paper copies remain distinct and require an explicit copy operation. Profile retention can be enabled in Settings for the current browser profile.


## 2026-11-04 — Investor flow and review follow-up
- Won remains the internal money/storage unit. Visible capital/contribution fields use manwon adapters; existing saved plans and approved strategy definitions are preserved.
- Holdings and owned-basket comparisons have a combined KRW view. Historical comparisons use an explicitly fixed current FX assumption; no historical FX return claim. Exports retain that FX and combined series. Virtual FX transfers are recorded in the paper ledger; per-currency returns after transfers are not presented as investment returns.
- Purchase basis/current value are displayed from the broker response. Closed-order fee/tax fields are fetched automatically; missing amounts stay unknown. Future costs use general brokerage fee + slippage assumptions, excluding taxes, FX and personal promotions. They are not actual paid costs.
- Five-year OHLC retrieval (provider permitting), daily/weekly/monthly aggregation, range/zoom and average purchase line added. Missing OHLC is rejected, not fabricated.
- Approved rules drive next-action explanations and link to paper review. Failed/loading connection or saved observations cannot generate new present-tense strategy judgments.
- Authenticated PC history is a fallback when the brokerage read fails. Only an unambiguous single-account history is selected, original time and FX retained. Same-tab authorized data survives transient failures; private data is never written to browser storage or Vercel. Cold start with PC OFF is NOT supported; safe offline storage remains future scope.
- Goals/history remain visible on the pending home. Loaded plan summaries survive transient refresh failure. Duplicate context cards reduced; Lab has a four-step path and optional news/research tools.
- Remaining: formal identity/MFA, full cash-flow account performance, canonical actual-plan reconciliation, cold-start offline cache and real orders are not implemented. These require separate data/auth boundaries; paper books are not silently merged into actual holdings.
- Validation: 117 automated tests passed, using synthetic data only. Earlier UI checks covered manwon→won conversion, 5-year weekly chart zoom, cost display and rule evaluation; final release UI checks tracked separately.


## 2026-11-04 — Three correctness fixes after review
- P0 confirmed: summary history-list deliberately omits positions; prior fallback incorrectly consumed it. Production wiring now shares createHistoryReaders with an HTTP integration test. Authenticated last-observation returns only one normalized saved snapshot. The history summary remains redacted. Multiple accounts cause a null result rather than guessing; original observation time, unknown cash and stale provenance are preserved. No new order/data-upload capability.
- P1 combined performance: every market and strategy series is rebased at the common start to the original capital allocation weights, carrying only already-known valuations across holidays. Returns/MDD start at that common baseline. This excludes P/L and initial costs incurred up to that observation; native reports retain their original-period figures. Zero baselines, unsorted/invalid values and fewer than two common dates block aggregation. Export includes baseline values and weights.
- P1 planner: default costs now belong to the planner, not investor-ui initialization. Product currency drives new unsaved draft assumptions; empty drafts use book currency. KRW uses the existing general KRX reference and USD the existing US reference, with slippage separated. NXT, personal exemptions, tax and FX are not inferred. Mixed-currency purchases require an explicit aggregate assumption because the existing engine accepts one rate. Book-loaded/approved or manually edited rates (including zero) are protected. No saved ledger/approval migration.
- Tests: 10 targeted cases passed; full regression 122 passed. Tests use temporary synthetic history files and real HTTP responses from the same adapter as dev-server, plus mismatch dates/holiday/MDD and cost-preservation cases. No broker keys or actual account data accessed.

## 2026-11-05 — CAP-04 out-of-sample split and tuning ledger (Notion: 표본 외 구간 분리 및 튜닝 이력)
- The old "평가 구간 수익률" re-ran the last 30% as a fresh backtest while "전체 수익률" still contained that segment; there was no trial history. New `lib/oos-validation.js`: tuning segment = candles before the split only; test segment uses earlier prices for indicator warmup only and starts capital at the split date. Splits require ascending unique dates and ≥20 test trading days. User picks 60/70/80% tuning ratio.
- Trial ledger (per browser profile, `oosLedger` in existing strategy state) is append-only and never truncated, because dropping old rows could falsely restore "independent". Each entry stores strategy version, snapshot, costs, both windows, both returns and parameter changes vs the previous trial on that symbol.
- Independence (conservative, per symbol): not independent if an overlapping test window was already evaluated with a different strategy version, or if the test window overlaps any earlier tuning window. Identical re-runs inherit the original verdict. Earlier entries are not rewritten; the verdict is the one valid at record time.
- Limits: browser-local profile storage, not a server audit log; still counterfactual backtests on chosen symbols (selection bias remains); no multiple-testing correction beyond showing trial counts.
- Tests: 7 new synthetic cases; full regression 129 passed. Headless Chrome on isolated port 8773 with public market data verified independent → reproduction → "독립 검증 아님" and the history table. The first QA run inherited `.env.local` and auto-read the owner's holdings on the home screen (count only appeared in a deleted scratch screenshot; nothing logged). Future QA must set `TOSS_KEY_FILE` to a non-existent path (process env wins over `.env.local`).
## 2026-11-05 — Holdings report home, trading-habit check and DCA review
- User problem: holdings swing daily, the user does not know why and trades on gut feel. Goal resembles a broker "AI signal" (why it moved, synthesised), not a news list. No LLM key exists, so the report is a deterministic evidence engine; an LLM can later only rephrase these structured facts.
- `lib/market-brief.js`: last-day move split into market share (beta vs KOSPI/KOSDAQ/S&P 500 over ≤120 aligned days, clamped 0–3, unreliable below 40 days) and own share. Company disclosures (≤3 days) and title-matched news clusters become cause candidates only when their direction matches the own move; neutral items are medium/low, opposite-direction items are labelled and sorted last and never used in the headline. "No identified cause" is stated explicitly. Moves under 0.6× the 60-day median absolute move are called normal-range to discourage reactive trades.
- `lib/dart.js` + `/api/dart`: OpenDART list.json (60 days, classified by title) and fnlttSinglAcnt latest periodic report; `thstrm_amount` is the reported quarter (3 months), `*_add_amount` cumulative. Server-only (reads data/stocks.json corp codes); 10-minute memory cache.
- `lib/trading-habits.js`: from read-only CLOSED order history (90 days) in browser memory only — trades/week, buys after ≥7% 5-day rise, sells after ≤−7% fall, FIFO holding days within the window (earlier lots excluded), re-buys within 10 days, 20-day after-sale return, fees. Flags carry a suggested personal rule. No storage or upload.
- `lib/dca-advisor.js`: per holding keep / watch / cap / review from earnings growth, single-name weight (35%), volatility (55%), fund share (core target 50%). Price decline alone never triggers replacement. Explicit "not a recommendation" caveat.
- `brief-ui.js`/`brief.css`: mounted lazily into `#overview` (it is created after login); previous home panels are preserved inside "자산 상세 · 원칙 · 기록". Animations: staggered fade-up, shimmer skeletons, count-up, bar growth, line draw, expandable cards; reduced-motion respected.
- QA: headless Chrome on port 8774 with a synthetic snapshot of public tickers, `TOSS_KEY_FILE` pointed to a missing file and `LOCALAPPDATA` set to a temporary folder (the earlier QA server had read the owner's saved plan from the shared user-data folder). Real public prices/news/DART were used; 0 runtime errors, no 390px overflow. Tests: 11 new; full regression 140.

## 2026-11-05 (2) Home redesign: account-first dashboard and flat menu
User feedback: causes were vague ("market flow"), the right half of desktop was unused, the menu was a two-level tree, and the first screen should show principal vs. current value with a monthly chart; trading should be graded, not habit-profiled.
- `lib/asset-timeline.js`: month-end stock holdings are rebuilt by rolling actual fills (1-year order history) back from current quantities, valued with that day's close and USD/KRW close. "넣은 돈" = current cost basis adjusted by later net buys/sells, so (value - principal) is continuous across trades. Months outside the fetched order range, with missing prices, or with negative reconstructed quantities (splits/transfers) are left empty, never filled. Cash is excluded.
- `lib/trade-review.js`: each fill older than 3 days is graded against the same-day market index (KOSPI/KOSDAQ/S&P 500). Buy edge = stock return since fill - index return; sell edge = index return - stock return since sale. Amount-weighted grade with a +/-2%p band. Dividends and FX drift are excluded.
- `lib/market-reasons.js`: market-close news ("코스피 마감", "뉴욕증시 마감") filtered to index headlines from the last 48h; reasons are theme words that actually appear in titles/summaries (politics/elections, rates, tariffs, FX, semis/AI, ...). No LLM; nothing is inferred beyond the article text.
- `brief-ui.js` rewritten: KPIs (value, principal, P/L, today), monthly bar+line chart with hover/focus readout, market reasons, trade report card on the left; sticky holdings list with one-line reason and DCA verdict on the right (stacks on mobile); per-stock analysis moved into a modal. Habit profiling removed from home (`lib/trading-habits.js` kept). Old home panels collapsed at the bottom.
- `workspace-ui.js`: one menu row (홈 / 보유 종목·거래 / 전략 테스트 / 시장 뉴스 / 더보기). Original nav buttons stay in a hidden container so every existing handler and `[data-view]` target is preserved; lab step bar unchanged.
- QA: headless Chrome, port 8774, synthetic holdings and synthetic fills (order-history request intercepted via CDP, prices from public candles). 0 runtime errors, no 390px overflow. Tests: 8 new; full regression 148.

## 2026-11-05 (3) One-screen strategy test
User feedback: the 4-step Strategy Lab did not explain what to do, strategy settings were scattered, and there was too much text.
- New default "전략 테스트" view (`lab-ui.js`, `lab.css`): choose one of four plain-language presets (trend 20/60, fast trend 5/20, RSI dip 30/70, 20/10-day breakout) or write a sentence (examples provided; parsed by the existing natural-language parser), pick a held stock or search, pick 3/6/12 months, run. Optional loss limit for presets.
- `lib/strategy-lab.js` wraps the existing `runBacktest` (fees and slippage 0.1% each, next-day open fills, 2-year history for indicator warm-up) and always compares with buy-and-hold over the same window plus the market index. Verdict uses a +/-2%p band; drawdown is shown as a negative number (the engine reports magnitude).
- "보유 종목 전체에 적용" runs the same rule on every holding and lists strategy vs. hold.
- The original approval/validation/paper-trading pages are unchanged and reachable from 더보기 → "원칙 승인·모의 운용 (고급)". More-menu items are only created when their view exists (the deployed build has no model research view).
- QA: headless Chrome with synthetic holdings and public prices; 0 runtime errors, no 390px overflow. Tests: 4 new.
