// 모의계좌 실행 엔진(PC 서버 전용): 규칙·계획으로 오늘 할 일을 정하고(evaluate), 할 일마다 매매 전 확인(preTradeCheck)과
// 주문 보호(order-guard)를 통과한 것만 한투 모의계좌에 지정가로 보낸다. 장부는 체크아웃 밖(LOCALAPPDATA/TeamQuant/paper-live)에 남긴다.
// 설계 조건(2026-11-09 방향 메모): ① 재시작해도 주문·체결 보존 ② 같은 신호가 여러 번 와도 중복 제출 없음 ③ 응답이 끊기면 재주문 전에 증권사 목록을 먼저 확인
// ④ 부분 체결·미체결·취소 구분 ⑤ 장이 닫혔거나 시세·잔고를 못 읽으면 보류(fail-closed) ⑥ 전체 정지(킬 스위치) ⑦ 모의 키만(실전 키는 클라이언트가 거부).
import { evaluate, preTradeCheck, normalizeRules, planPctOf } from './core-rules.js';
import { buildEngine } from './core-risk.js';
import { checkOrder, DEFAULT_LIMITS } from './order-guard.js';
import { marketOpen, roundTick } from './kis-orders.js';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const PAPER_LIVE_VERSION = 'L1-2026-11-09';
const PENDING = ['sending', 'sent', 'partial', 'unknown', 'cancel_requested'];
const kstDate = iso => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);
const shiftDays = (ymd, n) => new Date(Date.parse(ymd) + n * 864e5).toISOString().slice(0, 10);

export function ledgerDir(env = process.env) { return env.TEAMQUANT_PAPER_DIR || join(env.LOCALAPPDATA || env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'TeamQuant', 'paper-live'); }
/** 계좌별 JSON 장부. 임시 파일에 쓴 뒤 바꿔치기해 중간에 꺼져도 깨지지 않는다. */
export function createLedgerStore(dir) {
  mkdirSync(dir, { recursive: true });
  const file = acc => join(dir, `kis-vps-${acc}.json`);
  return {
    path: file,
    load(acc) { try { return JSON.parse(readFileSync(file(acc), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } },
    save(acc, ledger) { const tmp = file(acc) + '.tmp'; writeFileSync(tmp, JSON.stringify({ ...ledger, updatedAt: new Date().toISOString() })); renameSync(tmp, file(acc)); }
  };
}

/**
 * @param client  createKisClient() 결과(모의 전용)
 * @param store   createLedgerStore() 결과
 * @param readMarket (symbol, range) → {candles:[{date,open,close}]}  (lib/market.js fetchHeldMarketSeries)
 * @param limits  order-guard 한도 덮어쓰기(선택)
 */
export function createPaperLive({ client, store, readMarket, now = () => Date.now(), limits = {} } = {}) {
  const acc = String(client.settings().accountMasked || '').slice(-4) || 'none';
  const L = { ...DEFAULT_LIMITS, ...limits, allowLive: false };
  const iso = () => new Date(now()).toISOString(), todayYmd = () => kstDate(iso());
  const fresh = () => ({ version: PAPER_LIVE_VERSION, mode: 'vps', account: client.settings().accountMasked, killSwitch: false, orders: [], runs: [] });
  let ledger = store.load(acc) || fresh();
  const persist = () => store.save(acc, ledger);
  const openToday = sym => ledger.orders.find(o => o.symbol === sym && PENDING.includes(o.status) && kstDate(o.at) === todayYmd());

  /** 증권사 주문 목록과 장부를 맞춘다. 주문번호가 없는 'sending/unknown' 건은 종목·방향·수량·가격으로 찾아 번호를 붙인다(재주문 전 필수). */
  async function reconcile() {
    const mine = ledger.orders.filter(o => PENDING.includes(o.status) && kstDate(o.at) === todayYmd());
    if (!mine.length) return { checked: 0, updated: 0 };
    const broker = await client.orders(); let updated = 0;
    for (const o of mine) {
      let b = o.odno ? broker.find(x => x.odno === o.odno) : null;
      if (!b && !o.odno) { b = broker.find(x => x.code === o.symbol && x.side === o.side && x.qty === o.qty && Math.abs((x.price || 0) - o.price) < 0.5 && !ledger.orders.some(y => y.odno && y.odno === x.odno)); if (b) { o.odno = b.odno; o.orgno = b.orgno; o.note = '재조회로 주문번호를 확인했습니다.'; } }
      if (b) { o.filledQty = b.filled; o.remaining = b.remaining; o.avgPrice = b.avgPrice; o.status = b.status === 'open' ? (o.status === 'cancel_requested' ? 'cancel_requested' : 'sent') : b.status; o.checkedAt = iso(); updated++; }
      else if (['sending', 'unknown'].includes(o.status) && now() - Date.parse(o.at) > 10 * 60e3) { o.status = 'not_found'; o.note = '증권사 주문 목록에 없음(10분 경과). 접수되지 않은 것으로 봅니다.'; updated++; }
    }
    persist(); return { checked: mine.length, updated };
  }

  /** 잔고·시세로 오늘 할 일을 정한다. plan 은 {코드: pct | {pct,name}}; 국내 6자리 코드만 쓴다. */
  async function decide({ rules, plan }) {
    const R = normalizeRules(rules || {}).rules, bal = await client.balance();
    const positions = bal.positions.map(p => ({ symbol: p.symbol, name: p.name, currency: 'KRW', valueKrw: p.valueKrw, qty: p.qty }));
    const P = {}, skipped = [];
    for (const [k, v] of Object.entries(plan || {})) { const code = String(k).split('.')[0], pct = planPctOf(v); if (/^\d{6}$/.test(code) && Number.isFinite(pct) && pct > 0) P[code] = { pct, name: v?.name || positions.find(p => p.symbol === code)?.name || code, currency: 'KRW' }; else if (!/^\d{6}$/.test(code)) skipped.push(k); }
    const syms = [...new Set([...positions.map(p => p.symbol), ...Object.keys(P)])], cs = {}, meta = {}, noData = [];
    for (const s of syms) { try { const d = await readMarket(s, '2y'); cs[s] = (d.candles || []).filter(c => c.close > 0).map(c => ({ date: c.date, open: c.open, close: c.close })); } catch { cs[s] = []; } if (cs[s].length < 30) noData.push(s); meta[s] = { name: positions.find(p => p.symbol === s)?.name || P[s]?.name || s, currency: 'KRW', market: 'KR' }; }
    const today = todayYmd(), engine = buildEngine(cs, meta, [], { from: shiftDays(today, -400) });
    const risk = Object.fromEntries(syms.map(s => [s, engine.riskAt(s, today)])), portVar = h => engine.portVarAt(h, today);
    const trades30 = ledger.orders.filter(o => ['filled', 'partial'].includes(o.status) && now() - Date.parse(o.at) < 30 * 864e5).length + ledger.orders.filter(o => PENDING.includes(o.status)).length;
    const e = evaluate({ positions, cashKrw: bal.cash, rules: R, plan: P, risk, portVar, trades30 });
    return { rules: R, plan: P, skipped, noData, bal, positions, e, risk, portVar, trades30 };
  }

  /** 보내지 않고 할 일마다 통과/차단 이유를 돌려준다. */
  async function preview({ rules, plan } = {}) {
    const mk = marketOpen(new Date(now())), d = await decide({ rules, plan });
    try { await reconcile(); } catch (e) { /* 재조회 실패는 아래에서 미확인 주문으로 막힌다 */ }
    const items = []; let settling = d.bal.cash; const view = d.positions.map(p => ({ ...p }));
    for (const a of d.e.actions) {
      const side = a.kind === 'reduce' ? 'SELL' : 'BUY';
      const item = { symbol: a.symbol, name: a.name, side, amountKrw: Math.round(a.amountKrw), why: (a.why || [])[0] || (side === 'SELL' ? '계획 비중보다 많음' : '계획 비중보다 적음'), qty: null, price: null, ok: false, blocks: [], warnings: [] };
      items.push(item);
      if (ledger.killSwitch) item.blocks.push('전체 정지(킬 스위치)가 켜져 있습니다.');
      if (!mk.open) item.blocks.push(mk.reason);
      const pend = openToday(a.symbol); if (pend) item.blocks.push(`${a.name}에 끝나지 않은 주문이 있습니다(${pend.status}${pend.odno ? ' · ' + pend.odno : ''}).`);
      let px; try { px = await client.price(a.symbol); } catch (e) { item.blocks.push(`현재가를 받지 못해 주문하지 않습니다 (${e.message})`); continue; }
      item.price = roundTick(px.price, side); item.lastPrice = px.price;
      const held = d.positions.find(p => p.symbol === a.symbol);
      let qty = Math.floor(item.amountKrw / item.price); if (side === 'SELL') qty = Math.min(qty, held?.qty || 0);
      if (!(qty > 0)) { item.blocks.push(side === 'SELL' ? '팔 수량이 없습니다.' : '1주 미만이라 주문하지 않습니다.'); continue; }
      item.qty = qty; item.amountKrw = qty * item.price;
      const order = { symbol: a.symbol, name: a.name, currency: 'KRW', side, amountKrw: item.amountKrw };
      const chk = preTradeCheck({ positions: view, cashKrw: settling, rules: d.rules, plan: d.plan, portVar: d.portVar, trades30: d.trades30 + items.filter(i => i.ok).length }, order, d.risk[a.symbol]);
      if (chk.error) item.blocks.push(chk.error); else for (const f of chk.failed) item.blocks.push(`${f.label}: ${f.detail}`);
      item.unknownChecks = (chk.unknown || []).map(u => u.label);
      const g = checkOrder({ symbol: a.symbol, side, qty, limitPrice: item.price, currency: 'KRW', at: iso(), mode: 'paper' }, {
        limits: L, equityKrw: d.e.total, positions: d.positions.map(p => ({ symbol: p.symbol, qty: p.qty, valueKrw: p.valueKrw })), killSwitch: ledger.killSwitch, lastPrice: px.price, halted: px.halted,
        limitUp: px.upper > 0 && px.price >= px.upper, limitDown: px.lower > 0 && px.price <= px.lower, marketOpenAt: mk.openAt,
        todayOrders: ledger.orders.filter(o => kstDate(o.at) === todayYmd() && !['rejected', 'not_found', 'cancelled'].includes(o.status)).map(o => ({ key: o.key, amountKrw: o.amountKrw, at: o.at }))
      });
      item.key = g.key; item.blocks.push(...g.blocks); item.warnings.push(...g.warnings);
      if (side === 'BUY') { try { const bp = await client.buyingPower(a.symbol, item.price); if (bp.cashQty !== null && bp.cashQty < qty) item.blocks.push(`주문 가능 수량 ${bp.cashQty}주 < ${qty}주 (예수금 기준)`); } catch (e) { item.blocks.push(`주문 가능 수량을 확인하지 못해 주문하지 않습니다 (${e.message})`); } }
      item.ok = item.blocks.length === 0;
      if (item.ok) { settling += side === 'SELL' ? item.amountKrw : -item.amountKrw; const vp = view.find(p => p.symbol === a.symbol); if (vp) vp.valueKrw = Math.max(0, vp.valueKrw + (side === 'SELL' ? -item.amountKrw : item.amountKrw)); else view.push({ symbol: a.symbol, name: a.name, currency: 'KRW', valueKrw: item.amountKrw }); }
    }
    return { version: PAPER_LIVE_VERSION, at: iso(), account: client.settings().accountMasked, market: mk, killSwitch: ledger.killSwitch, limits: L,
      balance: { cash: d.bal.cash, total: d.bal.total, stock: d.bal.stock, positions: d.positions }, evaluation: { urgent: d.e.urgent, okCount: d.e.okCount, known: d.e.known, checks: d.e.checks, actions: d.e.actions.length, total: d.e.total },
      items, skipped: d.skipped, noData: d.noData, trades30: d.trades30 };
  }

  /** 통과한 주문만 순서대로 보낸다. 보내기 전에 장부에 'sending' 으로 먼저 적고, 응답을 못 받으면 'unknown' 으로 남겨 다음 재조회가 번호를 찾게 한다. */
  async function run({ rules, plan, dryRun = false } = {}) {
    const pv = await preview({ rules, plan });
    if (dryRun) return { ...pv, dryRun: true, sent: [] };
    if (ledger.killSwitch || !pv.market.open) return { ...pv, sent: [], note: ledger.killSwitch ? '킬 스위치가 켜져 있어 보내지 않았습니다.' : pv.market.reason };
    const sent = [];
    for (const it of pv.items.filter(i => i.ok)) {
      if (openToday(it.symbol)) continue; // 같은 실행 안에서 두 번 나가지 않게
      const rec = { key: it.key, at: iso(), symbol: it.symbol, name: it.name, side: it.side, qty: it.qty, price: it.price, amountKrw: it.amountKrw, why: it.why, status: 'sending', odno: null, orgno: '', filledQty: 0, remaining: it.qty };
      ledger.orders.push(rec); persist();
      try { const r = await client.place({ code: it.symbol, side: it.side, qty: it.qty, price: it.price }); rec.odno = r.odno; rec.orgno = r.orgno; rec.status = r.odno ? 'sent' : 'unknown'; rec.brokerMsg = r.msg || ''; }
      catch (e) { rec.status = e.code === 'network' ? 'unknown' : 'rejected'; rec.error = e.message; }
      persist(); sent.push(rec);
    }
    ledger.runs.push({ at: iso(), actions: pv.items.length, sent: sent.filter(r => r.status === 'sent').length, rejected: sent.filter(r => r.status === 'rejected').length, unknown: sent.filter(r => r.status === 'unknown').length, blocked: pv.items.filter(i => !i.ok).length });
    if (ledger.runs.length > 200) ledger.runs.splice(0, ledger.runs.length - 200);
    persist();
    try { await reconcile(); } catch { /* 다음 status 에서 다시 맞춘다 */ }
    return { ...pv, dryRun: false, sent: sent.map(r => ({ ...r })) };
  }

  async function cancelOpen() {
    try { await reconcile(); } catch { }
    const open = ledger.orders.filter(o => ['sent', 'partial'].includes(o.status) && o.odno && (o.remaining ?? o.qty) > 0), out = [];
    for (const o of open) { try { await client.cancel({ odno: o.odno, orgno: o.orgno }); o.status = 'cancel_requested'; o.cancelAt = iso(); out.push({ odno: o.odno, ok: true }); } catch (e) { out.push({ odno: o.odno, ok: false, error: e.message }); } }
    persist(); try { await reconcile(); } catch { }
    return out;
  }
  async function kill(on) { ledger.killSwitch = Boolean(on); ledger.killAt = iso(); persist(); const cancelled = on ? await cancelOpen() : []; return { killSwitch: ledger.killSwitch, cancelled }; }

  async function status() {
    let recon = null, balance = null, error = null;
    try { recon = await reconcile(); } catch (e) { error = `재조회 실패: ${e.message}`; }
    try { const b = await client.balance(); balance = { cash: b.cash, total: b.total, stock: b.stock, positions: b.positions }; } catch (e) { error = error || `잔고 조회 실패: ${e.message}`; }
    const today = ledger.orders.filter(o => kstDate(o.at) === todayYmd());
    return { version: PAPER_LIVE_VERSION, mode: 'vps', account: client.settings().accountMasked, market: marketOpen(new Date(now())), killSwitch: ledger.killSwitch, limits: L, balance, error, reconciled: recon,
      ordersToday: today, recentOrders: ledger.orders.slice(-20), runs: ledger.runs.slice(-5), ledgerPath: store.path(acc) };
  }
  return { preview, run, status, kill, cancelOpen, reconcile, _ledger: () => ledger };
}
