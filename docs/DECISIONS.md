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
