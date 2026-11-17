// 하루 1번 분석 루틴의 '오늘 볼 것' 목록(결정 45). API 키 없음 — 이 목록을 Claude Code 분석 루틴(analyst-daily)이 읽어 봇을 돌린다.
// 입력: data/paper-plan.json(위성) · data/paper-live-public.json(이슈·보유 · 서버가 켜져 있으면 로컬 브리지 status) · data/structure-cards.json · data/dip-cards.json · data/analyst-state.json · 공개 일봉.
// 출력: data/analyst-worklist.json  {asOf, items:[{symbol,name,kind,why,priority}], quarterlyDue, counts}. 계좌번호·주문번호는 다루지 않는다.
// 실행: node scripts/analyst-worklist.mjs [--port 8766]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchHeldMarketSeries } from '../lib/market.js';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), port = Number(args[args.indexOf('--port') + 1]) || 8766;
const read = p => { try { return JSON.parse(readFileSync(join(root, p), 'utf8')); } catch { return null; } };
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const plan = read('data/paper-plan.json'), cards = read('data/structure-cards.json'), dip = read('data/dip-cards.json') || { cards: {} }, state = read('data/analyst-state.json') || { lastRefresh: '2026-11-16', refreshEveryDays: 91 };
let status = read('data/paper-live-public.json');
try { const r = await fetch(`http://127.0.0.1:${port}/api/bridge/paper-live-status`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${port}`, 'X-TeamQuant-Action': 'bridge-local' }, body: '{}', signal: AbortSignal.timeout(8000) }); if (r.ok) { const s = await r.json(); status = { ...status, issues: s.issues, balance: s.balance, sleeve: s.sleeve, benchmark: s.benchmark, live: true }; } } catch { }
const sats = Object.entries(plan?.weights || {}).filter(([, w]) => w.role === 'satellite').map(([k, w]) => ({ symbol: k, name: w.name, market: /^\d{6}$/.test(k) ? 'KR' : 'US' }));
const items = [], add = (s, kind, why, priority = 2) => items.push({ symbol: s.symbol, name: s.name, kind, why, priority });
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const idxCache = {};
async function ret5(sym) { const d = await fetchHeldMarketSeries(sym, '3mo'); const c = (d.candles || []).filter(x => x.close > 0); return c.length > 6 ? { date: c.at(-1).date, r: (c.at(-1).close / c.at(-6).close - 1) * 100 } : null; }
for (const s of sats) {
  // ① 지수 대비 5일 −10%p 이상 하락 → 왜 떨어졔나 카드 필요
  try { const idxSym = s.market === 'US' ? 'SPY' : '069500'; idxCache[idxSym] ||= await ret5(idxSym); const a = await ret5(s.symbol), b = idxCache[idxSym]; if (a && b) { const pp = a.r - b.r; if (pp <= -10) add(s, 'drop', `5일 수익 지수 대비 ${pp.toFixed(1)}%p (${a.date})`, 1); } } catch (e) { add(s, 'data', `시세를 읽지 못함: ${e.message}`, 3); }
  // ② 걸린 이슈(주의·긴급·기록)에 카드가 없거나 카드가 이슈보다 오래됨
  for (const i of (status?.issues || []).filter(x => x.symbol === s.symbol)) { const c = dip.cards?.[s.symbol]; if (!c || (c.asOf || '') < (i.date || '')) add(s, 'issue', `${i.level === 'urgent' ? '긴급' : i.level === 'caution' ? '주의' : '기록'} · ${i.reason || ''}`.slice(0, 160), i.level === 'note' ? 3 : 1); }
  // ③ 하락 매수 카드 기한 만료 임박(7일) 또는 만료
  const c = dip.cards?.[s.symbol]; if (c?.until && daysBetween(today, c.until) <= 7) add(s, 'card-expiry', `검증 카드 기한 ${c.until} (${c.verdict})`, 2);
  // ④ 구조 카드가 90일 넘음(100일에 막힘 · 결정 37)
  const sc = cards?.companies?.[s.symbol]; if (sc?.asOf && daysBetween(sc.asOf, today) >= 90) add(s, 'card-age', `구조 카드 ${sc.asOf} (${daysBetween(sc.asOf, today)}일)`, 2);
}
// ⑤ 분기 재선정: 마지막 재선정 + 91일
const due = new Date(Date.parse(state.lastRefresh) + (state.refreshEveryDays || 91) * 864e5).toISOString().slice(0, 10);
const quarterlyDue = due <= today;
if (quarterlyDue) items.push({ symbol: '*', name: '전체', kind: 'quarterly', why: `분기 재선정 기한 ${due} 지남 — 후보군 전체 재채점 뒤 계획 후보안(사용자 승인 필요)`, priority: 1 });
items.sort((a, b) => a.priority - b.priority);
const out = { asOf: new Date().toISOString(), today, live: Boolean(status?.live), items, quarterlyDue, nextQuarterly: due, counts: { drop: items.filter(i => i.kind === 'drop').length, issue: items.filter(i => i.kind === 'issue').length, total: items.length } };
writeFileSync(join(root, 'data/analyst-worklist.json'), JSON.stringify(out, null, 1));
console.log(`오늘 볼 것 ${items.length}건 (서버 ${out.live ? '연결' : '공개 파일'}) · 다음 분기 재선정 ${due}`);
for (const i of items) console.log(` [${i.priority}] ${i.kind.padEnd(11)} ${i.symbol.padEnd(7)} ${i.name} — ${i.why}`);
