# TeamQuant development

- Read `docs/PROJECT_MAP.md` first, then only the spec and code needed for the task. Use `rg -n` and bounded reads. Do not routinely load the full app, generated bundles, historical worklogs or data files.
- Keep edits within the requested stage. Current performance work stops at Task A in `docs/PERFORMANCE_TRACKING_SPEC.md`. No broad refactor of `app.js`/`overview-ui.js`.
- Real account observations, counterfactual backtests and future scenarios are different datasets. Never manufacture account returns from today's holdings or infer cash as zero. TWR/XIRR require the relevant historical valuations and external cash flows.
- Financial data stays on the user's PC. Do not read or print credential files, account numbers, personal snapshots or exported private JSON while investigating code. Use synthetic fixtures for tests.
- Never commit/deploy `.env.local`, `.key` files, `.identity-salt` or history records. Keep persistence outside the checkout and outside Vercel. Packages must use an explicit source allowlist.
- No real orders. Do not alter teammates' files or Notion text outside the user's requested scope.
- Add meaningful tests for financial data models/persistence. Run targeted tests, then one appropriate regression suite; do not repeatedly print long successful logs. Do not add tests just to mirror low-impact cosmetic changes.
- Summarize files, behavior, tests and remaining work. Record decisions in `docs/DECISIONS.md`. Do not claim a measured token reduction without measurement.

This project uses a browser-local profile and a PC broker bridge; it is not server-side multi-user financial authentication.
