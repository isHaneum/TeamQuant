// 실계좌 읽기 전용 기록(PC 서버 전용 · 2026-11-12 결정 22). 한투 실전 계좌를 조회만 해서 하루 한 점(평가점)과 기록 해시 체인을 모의계좌와 같은 규칙으로 쌓는다.
// 왜: 사용자가 "내 계좌로 검증되는 운용 기록"을 원하고, 검증은 조회만을 뜻한다(자기 계좌 자기 조회 = 규제 없음). 주문은 영원히 모의계좌에서만 나간다 — 여기 넘어오는 reader 는 주문 함수가 없다(lib/kis-reader.js).
// 공개 스냅샷은 절대 쓰지 않는다: 실계좌는 사용자 개인 자료라 lib/paper-public.js 를 여기서 부르지 않고(import 도 없다), dev-server 의 publishPublic 은 모의계좌 status 만 받는다. 장부(kis-prod-<뒤4자리>.json)는 PC 의 LOCALAPPDATA 에만 남는다.
// 기록 규칙: 평가점 = KST 날짜로 하루 한 점(그날 마지막 조회), 체인 봉인은 lib/paper-chain.js sealEntry(같은 날 교체 · 지난 날짜 불변 · 바뀌면 chainBreaks), 비교선은 첫 평가점의 보유 국가 비중으로 한 번 고정(lib/paper-benchmark.js).
// 보류(fail-closed · 2026-11-12 검토): 환율 없음·미국 잔고 조회 실패·외화예수금 조회 실패 중 하나라도 있으면 총자산을 모르는 것이므로 평가점을 적지 않는다 — 조회 장애가 자산 급감으로 봉인되거나 첫 평가점의 비교선 비중(미국 0)으로 굳지 않게.
import { sealEntry, verifyChain, sha256 } from './paper-chain.js';
import { benchmarkDefinition, createBenchmarkReader } from './paper-benchmark.js';

export const REAL_RECORD_VERSION = 'RR1-2026-11-12';
const kstDate = iso => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);
const nyDate = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(Date.parse(iso)));
/** 보류 사유 → 화면 문구. */
export const STALE_REASONS = { fx_missing: '환율을 읽지 못해', us_failed: '미국 잔고 조회에 실패해', us_cash_failed: '외화예수금 조회에 실패해' };
// 증권사·엔진 문장에서 주문번호(10자리)·계좌번호(8자리) 꼴 숫자열을 지운다(브리지 응답에도 번호를 남기지 않는다).
const scrub = s => String(s ?? '').replace(/\d{7,}/g, '…').slice(0, 160);

/**
 * @param reader  createKisReader() 결과 — settings()/balance()/orders() 만 있다
 * @param store   createLedgerStore(dir, { prefix: 'kis-prod' }) 결과(모의 장부와 파일 이름이 다르다)
 * @param readMarket (symbol, range) → {candles}  환율(KRW=X)·비교선 지수용
 */
export function createRealRecord({ reader, store, readMarket, now = () => Date.now() } = {}) {
  const set = reader.settings(); if (set.readOnly !== true || typeof reader.balance !== 'function' || typeof reader.orders !== 'function') throw new Error('읽기 전용 리더가 아닙니다.');
  if (typeof reader.place === 'function' || typeof reader.cancel === 'function') throw new Error('주문 함수가 있는 클라이언트는 실계좌 기록에 넘길 수 없습니다.');
  const acc = String(set.accountMasked || '').slice(-4) || 'none', iso = () => new Date(now()).toISOString(), todayYmd = () => kstDate(iso());
  const fresh = () => ({ version: REAL_RECORD_VERSION, mode: 'prod', readOnly: true, account: set.accountMasked, marks: [], chain: [], chainBreaks: [], fills: [], baseline: null });
  let ledger = store.load(acc) || fresh(); if (!Array.isArray(ledger.marks)) ledger.marks = []; if (!Array.isArray(ledger.chain)) ledger.chain = []; if (!Array.isArray(ledger.chainBreaks)) ledger.chainBreaks = []; if (!Array.isArray(ledger.fills)) ledger.fills = []; ledger.readOnly = true;
  const persist = () => store.save(acc, ledger);
  const benchmarkFor = createBenchmarkReader({ readMarket, now });
  async function fxNow() { try { const d = await readMarket('KRW=X', '1y'); const c = (d.candles || []).filter(x => x.close > 0); return c.at(-1)?.close ?? null; } catch { return null; } }
  /** 체결(실계좌 주문은 사용자가 낸 것 · 여기서는 읽기만). 장부 fills[] 에 처음 본 KST 시각(at)으로 한 번만 적어 두므로 체인에는 처음 확인한 날의 항목에 한 번 들어간다 — 조회 시각(오전·저녁)에 따라 그날 fills 가 달라지거나
   *  다음 날 다시 들어가지 않는다(2026-11-12 검토). 조회는 KST 오늘과 뉴욕 오늘(다르면) 둘 다(미국 체결 목록은 뉴욕 날짜 기준일 수 있다 · paper-live reconcile 과 같은 범위). 열쇠는 시장·주문번호의 sha256 앞 16자 — 주문번호 원문은 장부에도 적지 않는다.
   *  조회 실패는 그대로 두고(fail-closed) 다음 조회가 채운다. 한계: 처음 본 뒤 다른 날 늘어난 일부 체결 수량은 fills 에 더 들어가지 않는다(보유 수량에는 반영). */
  async function noteFills() {
    for (const d of [...new Set([todayYmd(), nyDate(iso())])]) {
      let rows; try { rows = await reader.orders(d.replace(/-/g, '')); } catch { continue; }
      for (const o of rows) {
        const filled = Number(o?.filled) || 0; if (!o || !o.odno || !(filled > 0)) continue;
        const key = sha256(`${o.market || ''}|${String(o.odno).replace(/^0+/, '')}`).slice(0, 16), f = ledger.fills.find(x => x.key === key);
        if (f) { if (filled > f.filledQty) { f.filledQty = filled; f.avgPrice = o.avgPrice ?? f.avgPrice; } f.status = o.status; }
        else ledger.fills.push({ key, at: iso(), tradeDate: d, market: o.market, symbol: o.code, side: o.side, status: o.status, filledQty: filled, avgPrice: o.avgPrice ?? null });
      }
    }
    if (ledger.fills.length > 2000) ledger.fills.splice(0, ledger.fills.length - 2000);
    return ledger.fills;
  }
  /** 비교선 정의는 첫 평가점의 보유 국가 비중(국내 평가 ÷ 총자산 · 미국 평가×환율 ÷ 총자산 · 나머지 현금)으로 한 번 고정한다. 계획이 없는 계좌라 "지금 들고 있는 것의 국가 비중을 지수로 샀다면"이 비교선이다. */
  const baselineFrom = (bal, m) => ({ at: iso(), from: m.date, capitalKrw: m.total, benchmark: benchmarkDefinition(Object.fromEntries(bal.positions.filter(p => p.valueKrw > 0).map(p => [p.symbol, { pct: p.valueKrw / m.total * 100, currency: p.currency }]))) });

  async function status() {
    let balance = null, error = null, m = null, stale = false, staleReason = null;
    const fx = await fxNow();
    try {
      const b = await reader.balance({ fx }); const d = todayYmd();
      // 총자산을 모르면 적지 않는다(fail-closed): 해외 자산이 있는데 환율이 없음 · 미국 잔고 조회 실패(국내만 더한 값이 '미국 자산 전부 사라짐'으로 봉인되고 첫 평가점이면 비교선 미국 비중이 0 으로 굳는다) · 외화예수금 조회 실패(자산 누락).
      staleReason = b.total === null ? 'fx_missing' : b.usError ? 'us_failed' : b.cashUsdError ? 'us_cash_failed' : null;
      if (staleReason) { stale = true; m = ledger.marks.at(-1) || null; }
      else {
        m = { date: d, total: b.total, cash: Math.round(b.cash), stock: b.stockKrw, fx: fx || null, at: iso(), cashUsd: b.cashUsd ?? null, usCostKrw: b.usCostKrw ?? null };
        const i = ledger.marks.findIndex(x => x.date === d); if (i >= 0) ledger.marks[i] = m; else ledger.marks.push(m); if (ledger.marks.length > 800) ledger.marks.splice(0, ledger.marks.length - 800);
        sealEntry(ledger, m, { positions: b.positions, fills: await noteFills(), at: iso() });
        if (!ledger.baseline && m.total > 0) ledger.baseline = baselineFrom(b, m);
        persist();
      }
      balance = { total: stale ? null : b.total, totalKrwOnly: b.totalKrwOnly, cash: b.cash, cashUsd: b.cashUsd, stock: stale ? null : b.stockKrw, stockUsd: b.stockUsd, usCostKrw: b.usCostKrw, fx: b.fx, usError: b.usError || null, cashUsdError: b.cashUsdError || null, note: b.note, positions: b.positions.map(p => ({ symbol: p.symbol, name: p.name || p.symbol, market: p.market, currency: p.currency, qty: p.qty, valueKrw: p.valueKrw })) };
    } catch (e) { error = `잔고 조회 실패: ${scrub(e.message)}`; }
    let benchmark = null; try { benchmark = await benchmarkFor(ledger.baseline?.benchmark || null, ledger.baseline?.from ? ledger.marks.filter(x => x.date >= ledger.baseline.from) : ledger.marks); } catch { benchmark = null; }
    // 응답에 넣지 않는 것: 계좌번호 원문(가린 것만) · 장부 경로 · 주문번호 · 토큰. 공개 스냅샷으로 변환하는 함수도 없다.
    return { version: REAL_RECORD_VERSION, readOnly: true, mode: 'prod', account: set.accountMasked, asOf: iso(), fx, balance, error, markStale: stale, staleReason, marks: ledger.marks.slice(-400), chain: ledger.chain.slice(-400), chainCheck: verifyChain(ledger.chain), chainBreaks: ledger.chainBreaks.slice(-50), baseline: ledger.baseline || null, benchmark };
  }
  return { status, _ledger: () => ledger };
}
