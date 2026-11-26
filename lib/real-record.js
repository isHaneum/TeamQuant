// 실계좌 읽기 전용 기록(PC 서버 전용 · 2026-11-12 결정 22). 한투 실전 계좌를 조회만 해서 하루 한 점(평가점)과 기록 해시 체인을 모의계좌와 같은 규칙으로 쌓는다.
// 왜: 사용자가 "내 계좌로 검증되는 운용 기록"을 원하고, 검증은 조회만을 뜻한다(자기 계좌 자기 조회 = 규제 없음). 주문은 영원히 모의계좌에서만 나간다 — 여기 넘어오는 reader 는 주문 함수가 없다(lib/kis-reader.js).
// 공개 스냅샷은 절대 쓰지 않는다: 실계좌는 사용자 개인 자료라 lib/paper-public.js 를 여기서 부르지 않고(import 도 없다), dev-server 의 publishPublic 은 모의계좌 status 만 받는다. 장부(kis-prod-<뒤4자리>.json)는 PC 의 LOCALAPPDATA 에만 남는다.
// 기록 규칙: 평가점 = KST 날짜로 하루 한 점(그날 마지막 조회), 체인 봉인은 lib/paper-chain.js sealEntry(같은 날 교체 · 지난 날짜 불변 · 바뀌면 chainBreaks), 비교선은 첫 평가점의 보유 국가 비중으로 한 번 고정(lib/paper-benchmark.js).
// 보류(fail-closed · 2026-11-12 검토 · 2026-11-26 원화 현금 추가): 환율 없음·미국 잔고 조회 실패·원화 현금 조회 실패·외화예수금 조회 실패 중 하나라도 있으면 총자산을 모르는 것이므로 평가점을 적지 않는다 — 조회 장애가 자산 급감으로 봉인되거나 첫 평가점의 비교선 비중(미국 0)으로 굳지 않게.
// 현금을 아는 기록(2026-11-26 · RR2 · 토스 TR2 리더가 cashKnown:true 를 줄 때): 평가점마다 현금(cashKrw 원화분 · cashUsd 달러 금액)과 보유(수량 · 원화 1주 가격 · 평균 매입가 · 통화)를 남기고 바로 전 평가점과 비교한다.
//   (1) 추정 입출금(추정 · flowKrw) = 오늘 총자산 − [전 보유 수량 × 오늘 가격 + 전 원화 현금 + 전 달러 현금 × 오늘 환율] − 매매 효과.
//       매매 효과 = Σ 그 구간 체결(산 것 +, 판 것 −) × 수량 × (오늘 가격 − 체결 평균가) − 수수료·세금. 다 판 종목의 '오늘 가격'은 그 구간 매도 평균가(판 돈이 그대로 현금이 됨), 체결 기록이 없으면 전 가격.
//       가격 변화·달러 현금의 환율 변화·매매로 설명되지 않는 나머지가 입금(+)·출금(−)이다. |나머지| < FLOW_FLOOR_KRW(1,000원)는 입출금이 아니라 손익으로 둔다(반올림·작은 이자·배당).
//       오차 원인: 이 기록은 입출금·배당 내역을 읽지 않는다(토스 Open API 1.2.28 문서에는 거래내역 GET /api/v1/transactions — 입출금·환전·배당·이자·수수료 — 이 있으나 아직 쓰지 않음 · 2026-11-26 검토) → 1,000원 넘는 배당·이자·환전 스프레드·(토스가 안 준) 수수료는 입출금으로 섞여 손익에서 빠진다 ·
//       미체결 매수 주문이 잡아 둔 금액은 그 평가점에서 현금에서 빠져 출금처럼 보였다가 주문이 끝난 다음 평가점에서 입금으로 되돌아온다(합은 0) · 보유·현금 조회 사이(1초 안팎)의 체결도 같은 식으로 하루 어긋난다 ·
//       놓친 체결은 수량 변화를 오늘 가격으로 보므로 오차가 '체결가 − 오늘 가격'만큼 · 타사 입고·출고는 입출금으로 잡힌다(맞는 뜻) · 주식 분할·병합은 정수배 수량 + 평가액 연속일 때만 알아본다(splits) ·
//       처음 본 뒤 다른 날 늘어난 일부 체결 수량은 그날 구간에서 빠진다(실현손익이 그만큼 otherKrw 로 감).
//   (2) 시간가중 지수(index) = 전 지수 × (오늘 총자산 − 추정 입출금) ÷ 전 총자산 — 입출금은 그날 끝에 들어온 것으로 본다. 비교선(paper-benchmark compare)은 이 지수 비율을 쓰므로 입금·현금 이동(매도 대금)이 수익·손실로 잡히지 않는다.
//   (3) 실현손익(realizedKrw) = 그 구간 매도 체결 수량 × (체결 평균가 − 전 평가점의 평균 매입가) × 그날 평가점 환율(미국). 수수료·세금 전 금액. 세금 기준(결제일 · 산 날 환율 원가)과 다르다.
//   현금을 모르던 옛 평가점(TR1 · cash 0)은 고치지 않는다(지난 기록 불변). 원금·손익은 현금이 처음 들어간 평가점부터 세고(그 전 숫자는 지어내지 않는다), 그 경계 하루는 보유 기준 지수(옛 방식)로 잇는다.
//   한투 리더(cashKnown 없음)는 예전 그대로(지수·원금 없음 · 총자산 비율 비교).
import { sealEntry, verifyChain, sha256 } from './paper-chain.js';
import { benchmarkDefinition, createBenchmarkReader } from './paper-benchmark.js';

export const REAL_RECORD_VERSION = 'RR2-2026-11-26';
const kstDate = iso => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);
const nyDate = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(Date.parse(iso)));
const shiftDay = (ymd, n) => new Date(Date.parse(ymd) + n * 864e5).toISOString().slice(0, 10);
const r2 = v => Math.round(v * 100) / 100;
/** 보류 사유 → 화면 문구. */
export const STALE_REASONS = { fx_missing: '환율을 읽지 못해', us_failed: '미국 잔고 조회에 실패해', cash_failed: '원화 현금 조회에 실패해', us_cash_failed: '외화예수금 조회에 실패해' };
/** 이보다 작은 설명 안 되는 변화는 입출금이 아니라 손익으로 둔다(원). */
export const FLOW_FLOOR_KRW = 1000;
export const PRINCIPAL_NOTE = '추정: 현금이 처음 기록된 평가점(since)의 현금 + 보유 매입금액(미국은 그날 환율)에서 시작해, 그 뒤 날마다 총자산 변화 중 가격·환율·매매로 설명되지 않는 부분을 입출금으로 더합니다. 이 기록은 토스 거래내역(입출금)을 아직 읽지 않아 그 전 입출금은 세지 않았고, 그 전에 실현한 이익·환차익은 시작 원금에 들어 있습니다. 1,000원 넘는 배당·이자도 입금으로 잡힐 수 있습니다.';
export const RETURNS_NOTE = '총손익 = 지금 총자산 − 원금 = 실현손익 + 평가손익 + 그 밖(환율·수수료·배당·이자·추정 오차). 실현손익 = 매도 수량 × (체결 평균가 − 전 평가점의 평균 매입가), 그날 환율로 원화 환산. 월·연은 기록이 매도를 확인한 날(KST) 기준이고 세금(결제일·산 날 환율 원가)과 다릅니다.';
export const CASH_TRACKING_NOTE = '현금은 from 날짜의 평가점부터 들어갑니다. 그 전 평가점의 시간가중 수익률은 보유 주식만으로 잰 값이라, 판 돈이 현금으로 있던 날은 계좌 전체보다 크게 움직였습니다.';
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
  const acc = set.ledgerKey || String(set.accountMasked || '').slice(-4) || 'none', iso = () => new Date(now()).toISOString(), todayYmd = () => kstDate(iso());
  const fresh = () => ({ version: REAL_RECORD_VERSION, mode: set.mode || 'prod', readOnly: true, account: set.accountMasked, marks: [], chain: [], chainBreaks: [], fills: [], baseline: null });
  let ledger = store.load(acc) || fresh(); if (!Array.isArray(ledger.marks)) ledger.marks = []; if (!Array.isArray(ledger.chain)) ledger.chain = []; if (!Array.isArray(ledger.chainBreaks)) ledger.chainBreaks = []; if (!Array.isArray(ledger.fills)) ledger.fills = []; ledger.readOnly = true;
  const persist = () => store.save(acc, ledger);
  const benchmarkFor = createBenchmarkReader({ readMarket, now });
  async function fxNow() { try { const d = await readMarket('KRW=X', '1y'); const c = (d.candles || []).filter(x => x.close > 0); return c.at(-1)?.close ?? null; } catch { return null; } }
  /** 체결(실계좌 주문은 사용자가 낸 것 · 여기서는 읽기만). 장부 fills[] 에 처음 본 KST 시각(at)으로 한 번만 적어 두므로 체인에는 처음 확인한 날의 항목에 한 번 들어간다 — 조회 시각(오전·저녁)에 따라 그날 fills 가 달라지거나
   *  다음 날 다시 들어가지 않는다(2026-11-12 검토). 조회는 KST 오늘과 뉴욕 오늘(다르면) 둘 다(미국 체결 목록은 뉴욕 날짜 기준일 수 있다 · paper-live reconcile 과 같은 범위). 열쇠는 시장·주문번호의 sha256 앞 16자 — 주문번호 원문은 장부에도 적지 않는다.
   *  조회 실패는 그대로 두고(fail-closed) 다음 조회가 채운다. 한계: 처음 본 뒤 다른 날 늘어난 일부 체결 수량은 fills 에 더 들어가지 않는다(보유 수량에는 반영).
   *  2026-11-26: 전 평가점과 오늘 사이에 평가점 없는 날이 있으면(PC 꺼짐) 그 날짜들도 조회한다(오늘에 가까운 7일까지 · 끝난 날짜는 이 프로세스에서 한 번만) — 그날 매도의 실현손익이 빠지지 않게.
   *  fee(수수료 + 세금 · 주문 통화)는 리더가 주면 적는다(체인 payload 에는 넣지 않음). */
  const checkedDays = new Set();
  async function noteFills() {
    const today = todayYmd(), last = ledger.marks.reduce((a, x) => (x.date < today && (!a || x.date > a) ? x.date : a), null), gap = [];
    if (last) for (let x = shiftDay(today, -1), n = 0; x > last && n < 7; x = shiftDay(x, -1), n++) if (!checkedDays.has(x)) gap.push(x);
    for (const d of [...new Set([...gap.reverse(), today, nyDate(iso())])]) {
      let rows; try { rows = await reader.orders(d.replace(/-/g, '')); } catch { continue; }
      if (gap.includes(d) && d < shiftDay(today, -1)) checkedDays.add(d); // 어제는 미국 장이 KST 새벽까지 이어져 다시 볼 수 있게 둔다
      for (const o of rows) {
        const filled = Number(o?.filled) || 0; if (!o || !o.odno || !(filled > 0)) continue;
        const key = sha256(`${o.market || ''}|${String(o.odno).replace(/^0+/, '')}`).slice(0, 16), f = ledger.fills.find(x => x.key === key), fee = typeof o.fee === 'number' && Number.isFinite(o.fee) && o.fee >= 0 ? o.fee : null;
        if (f) { if (filled > f.filledQty) { f.filledQty = filled; f.avgPrice = o.avgPrice ?? f.avgPrice; if (fee !== null) f.fee = fee; } f.status = o.status; }
        else ledger.fills.push({ key, at: iso(), tradeDate: d, market: o.market, symbol: o.code, side: o.side, status: o.status, filledQty: filled, avgPrice: o.avgPrice ?? null, ...(fee !== null ? { fee } : {}) });
      }
    }
    if (ledger.fills.length > 2000) ledger.fills.splice(0, ledger.fills.length - 2000);
    return ledger.fills;
  }
  /** 비교선 정의는 첫 평가점의 보유 국가 비중(국내 평가 ÷ 총자산 · 미국 평가×환율 ÷ 총자산 · 나머지 현금)으로 한 번 고정한다. 계획이 없는 계좌라 "지금 들고 있는 것의 국가 비중을 지수로 샀다면"이 비교선이다. */
  const baselineFrom = (bal, m) => ({ at: iso(), from: m.date, capitalKrw: m.total, benchmark: benchmarkDefinition(Object.fromEntries(bal.positions.filter(p => p.valueKrw > 0).map(p => [p.symbol, { pct: p.valueKrw / m.total * 100, currency: p.currency }]))) });

  /** 시간가중 지수·추정 입출금·실현손익(토스 리더 · 맨 위 (1)~(3)). 한투 리더(cashKnown 없음)는 {} — 예전처럼 총자산 비율로 비교한다.
   *  현금을 모르는 평가점(cashKnown:false · 옛 TR1)이나 그 다음 날은 보유 기준 지수(옛 방식): 지수_오늘 = 지수_전 × Σ(전 수량 × 오늘 가격) ÷ Σ(전 수량 × 전 가격) · 입출금·실현손익은 세지 않는다.
   *  보유 {종목: [수량, 원화 1주 가격, 평균 매입가(그 통화) | null, 통화]}·지수·입출금은 장부에만 두고 체인 payload 에는 넣지 않는다(봉인 형식 유지 · 보유 수량·총자산·현금은 이미 봉인된다). */
  const fxFor = (cur, fx) => (cur === 'USD' || cur === 'US' ? fx : 1);
  const holdingsOf = b => Object.fromEntries(b.positions.filter(p => p.qty > 0 && p.valueKrw > 0).map(p => [p.symbol, [p.qty, p.valueKrw / p.qty, Number.isFinite(p.avgCost) ? p.avgCost : null, p.currency === 'USD' ? 'USD' : 'KRW']]));
  /** 평가손익(원) = Σ(평가 − 수량 × 평균 매입가 × 오늘 환율). 미국은 달러 가격 손익을 오늘 환율로 바꾼 값(산 날 이후 환차익은 returns.otherKrw 로). 평균 매입가가 없는 종목은 0. */
  const unrealizedOf = b => Math.round(b.positions.reduce((a, p) => a + (p.qty > 0 && p.valueKrw != null && Number.isFinite(p.avgCost) ? p.valueKrw - p.qty * p.avgCost * fxFor(p.currency, b.fx) : 0), 0));
  const idx = (prev, r) => Math.round(prev.index * (r > 0 && Number.isFinite(r) ? r : 1) * 1e8) / 1e8;
  function derive(b, d, fills) {
    if (b.cashKnown !== false && b.cashKnown !== true) return {};
    const holdings = holdingsOf(b), withCash = b.cashKnown === true;
    const own = withCash ? { cashKnown: true, cashKrw: Math.round(b.cashKrw), unrealizedKrw: unrealizedOf(b) } : {};
    const prev = [...ledger.marks].reverse().find(x => x.date < d && x.index > 0 && x.holdings);
    if (!prev) return { index: 1, holdings, ...own };
    const fx = b.fx || prev.fx || null, fs = fills.filter(f => f && f.at && Number(f.filledQty) > 0 && kstDate(f.at) > prev.date && kstDate(f.at) <= d); // 그 구간 체결 = 처음 확인한 KST 날짜가 (전 평가점, 오늘] 인 것(체인과 같은 날짜 규칙)
    const krwPx = f => f.avgPrice * fxFor(f.market, fx), vwap = (s, side, px) => { const xs = fs.filter(f => f.symbol === s && f.side === side && f.avgPrice > 0), q = xs.reduce((a, f) => a + f.filledQty, 0); return q > 0 ? xs.reduce((a, f) => a + f.filledQty * px(f), 0) / q : null; };
    const pxNow = s => holdings[s]?.[1] ?? vwap(s, 'SELL', krwPx) ?? prev.holdings[s]?.[1] ?? null; // 오늘 1주 가격(원): 보유 → 다 판 종목은 그 구간 매도 평균가 → 체결 기록이 없으면 전 가격
    // 주식 분할·병합: 그 종목 체결이 없는데 수량이 정수배(2배 이상 · 1/2 이하)로 바뀌고 평가액은 30% 안에서 이어지면 분할로 보고 전 수량에 그 배수를 곱한다(입금·손실로 잡지 않게). 그 밖의 수량 변화는 위 (1)대로.
    const splits = [], ratio = s => { const a = prev.holdings[s], h = holdings[s]; if (!a || !h || !(a[0] > 0) || fs.some(f => f.symbol === s)) return 1; const k = h[0] / a[0], n = k >= 1 ? k : 1 / k; if (!(Math.round(n) >= 2 && Math.abs(n - Math.round(n)) < 1e-6 && Math.abs((h[0] * h[1]) / (a[0] * a[1]) - 1) < 0.3)) return 1; splits.push(s); return k; };
    let up = 0, down = 0; for (const [s, h] of Object.entries(prev.holdings)) { up += h[0] * ratio(s) * (pxNow(s) ?? h[1]); down += h[0] * h[1]; }
    const holdOnly = () => ({ index: idx(prev, down > 0 ? up / down : 1), holdings, ...own, ...(splits.length ? { splits } : {}) });
    if (!withCash || prev.cashKnown !== true) return holdOnly();
    const costOf = s => prev.holdings[s]?.[2] ?? holdings[s]?.[2] ?? vwap(s, 'BUY', f => f.avgPrice); // 전 평가점의 평균 매입가 → (없으면) 오늘 → 그 구간에 산 평균가
    let trade = 0, realized = 0, unknown = 0;
    for (const f of fs) {
      const P = f.avgPrice > 0 ? krwPx(f) : null, p = pxNow(f.symbol);
      if (P !== null) trade += (f.side === 'BUY' ? 1 : -1) * f.filledQty * ((p ?? P) - P);
      trade -= (Number(f.fee) || 0) * fxFor(f.market, fx);
      if (f.side === 'SELL') { const c = costOf(f.symbol); if (P === null || c === null || c === undefined) unknown++; else realized += f.filledQty * (f.avgPrice - c) * fxFor(f.market, fx); }
    }
    const expected = up + (Number(prev.cashKrw) || 0) + (Number(prev.cashUsd) || 0) * (fx || 0) + trade, raw = b.total - expected;
    if (!Number.isFinite(raw) || ((Number(prev.cashUsd) || 0) > 0 && !(fx > 0))) return holdOnly();
    const flowKrw = Math.abs(raw) < FLOW_FLOOR_KRW ? 0 : Math.round(raw);
    return { index: idx(prev, prev.total > 0 ? (b.total - flowKrw) / prev.total : 1), holdings, ...own, flowKrw, realizedKrw: Math.round(realized), ...(unknown ? { realizedUnknown: unknown } : {}), ...(splits.length ? { splits } : {}) };
  }
  /** 원금·손익(추정). 현금을 아는 평가점이 이어진 마지막 구간의 첫 평가점(m0)부터 센다 — 그 전 평가점은 현금을 몰라 원금을 만들지 않는다.
   *  시작 원금 = m0 총자산 − m0 평가손익(= 그날 현금 + 보유 매입금액 · 미국은 그날 환율). 원금 = 시작 원금 + 그 뒤 추정 입출금 합.
   *  총손익 = 마지막 평가점 총자산 − 원금 = 실현손익(m0 뒤 매도) + 평가손익(마지막 평가점) + otherKrw. 수익률 = 총손익 ÷ 원금. twrPct = m0 부터의 시간가중(입출금 뺌).
   *  한계: 평가점은 최근 800일만 남으므로 그보다 오래되면 시작점이 뒤로 밀린다. */
  function performance(marks) {
    let k = marks.length; while (k > 0 && marks[k - 1].cashKnown === true) k--;
    const run = marks.slice(k), hasIndex = marks.some(x => x.index > 0);
    const base = ledger.baseline?.from ? marks.find(x => x.date === ledger.baseline.from) : null;
    const cashTracking = hasIndex ? { from: run[0]?.date ?? null, holdingsOnlyMarks: (ledger.baseline?.from ? marks.filter(x => x.date >= ledger.baseline.from) : marks).filter(x => x.index > 0 && x.cashKnown !== true).length, baselineWithCash: base ? base.cashKnown === true : null, note: CASH_TRACKING_NOTE } : null;
    if (!run.length) return { principal: null, returns: null, cashTracking };
    const m0 = run[0], last = run.at(-1), later = run.slice(1), startKrw = Math.round(m0.total - (Number(m0.unrealizedKrw) || 0));
    const flowsKrw = later.reduce((a, m) => a + (Number(m.flowKrw) || 0), 0), krw = startKrw + flowsKrw;
    const realizedByMonth = {}, realizedByYear = {}; let realizedKrw = 0, realizedUnknownSells = 0;
    for (const m of later) { const v = Number(m.realizedKrw) || 0; realizedUnknownSells += Number(m.realizedUnknown) || 0; if (!v) continue; realizedKrw += v; realizedByMonth[m.date.slice(0, 7)] = (realizedByMonth[m.date.slice(0, 7)] || 0) + v; realizedByYear[m.date.slice(0, 4)] = (realizedByYear[m.date.slice(0, 4)] || 0) + v; }
    const unrealizedKrw = Number(last.unrealizedKrw) || 0, totalPnlKrw = last.total - krw;
    return {
      principal: { krw, method: 'estimated', since: m0.date, asOf: last.date, startKrw, flowsKrw, flows: later.filter(m => m.flowKrw).map(m => ({ date: m.date, krw: m.flowKrw })).slice(-60), note: PRINCIPAL_NOTE },
      returns: { totalPnlKrw, returnPct: krw > 0 ? r2(totalPnlKrw / krw * 100) : null, realizedKrw, realizedByMonth, realizedByYear, unrealizedKrw, otherKrw: totalPnlKrw - realizedKrw - unrealizedKrw, twrPct: m0.index > 0 && last.index > 0 ? r2((last.index / m0.index - 1) * 100) : null, realizedUnknownSells, since: m0.date, asOf: last.date, note: RETURNS_NOTE },
      cashTracking,
    };
  }

  async function status() {
    let balance = null, error = null, m = null, stale = false, staleReason = null;
    const fx = await fxNow();
    try {
      const b = await reader.balance({ fx }); const d = todayYmd();
      // 총자산을 모르면 적지 않는다(fail-closed): 해외 자산이 있는데 환율이 없음 · 미국 잔고 조회 실패(국내만 더한 값이 '미국 자산 전부 사라짐'으로 봉인되고 첫 평가점이면 비교선 미국 비중이 0 으로 굳는다) · 원화 현금·외화예수금 조회 실패(자산 누락).
      staleReason = b.total === null ? 'fx_missing' : b.usError ? 'us_failed' : b.cashKrwError ? 'cash_failed' : b.cashUsdError ? 'us_cash_failed' : null;
      if (staleReason) { stale = true; m = ledger.marks.at(-1) || null; }
      else {
        const fills = await noteFills(); // 평가점 계산 전에 — 이번 조회에서 처음 본 체결도 오늘 구간의 매매 효과·실현손익에 들어가게
        m = { date: d, total: b.total, cash: Math.round(b.cash), stock: b.stockKrw, fx: b.fx || fx || null, at: iso(), cashUsd: b.cashUsd ?? null, usCostKrw: b.usCostKrw ?? null, ...derive(b, d, fills) };
        const i = ledger.marks.findIndex(x => x.date === d); if (i >= 0) ledger.marks[i] = m; else ledger.marks.push(m); if (ledger.marks.length > 800) ledger.marks.splice(0, ledger.marks.length - 800);
        sealEntry(ledger, m, { positions: b.positions, fills, at: iso() });
        if (!ledger.baseline && m.total > 0) ledger.baseline = baselineFrom(b, m);
        persist();
      }
      balance = { total: stale ? null : b.total, totalKrwOnly: b.totalKrwOnly, cash: b.cash, cashKrw: b.cashKrw ?? null, cashUsd: b.cashUsd, stock: stale ? null : b.stockKrw, stockUsd: b.stockUsd, usCostKrw: b.usCostKrw, fx: b.fx, usError: b.usError || null, cashKrwError: b.cashKrwError || null, cashUsdError: b.cashUsdError || null, note: b.note, cashKnown: b.cashKnown !== false, positions: b.positions.map(p => ({ symbol: p.symbol, name: p.name || p.symbol, market: p.market, currency: p.currency, qty: p.qty, valueKrw: p.valueKrw })) };
    } catch (e) { error = `잔고 조회 실패: ${scrub(e.message)}`; }
    let benchmark = null; try { benchmark = await benchmarkFor(ledger.baseline?.benchmark || null, ledger.baseline?.from ? ledger.marks.filter(x => x.date >= ledger.baseline.from) : ledger.marks); } catch { benchmark = null; }
    const perf = performance(ledger.marks);
    // 응답에 넣지 않는 것: 계좌번호 원문(가린 것만) · 장부 경로 · 주문번호 · 토큰. 공개 스냅샷으로 변환하는 함수도 없다.
    return { version: REAL_RECORD_VERSION, readOnly: true, mode: set.mode || 'prod', source: set.source || 'kis', label: set.label || '한투', account: set.accountMasked, asOf: iso(), fx, balance, error, markStale: stale, staleReason, marks: ledger.marks.slice(-400), chain: ledger.chain.slice(-400), chainCheck: verifyChain(ledger.chain), chainBreaks: ledger.chainBreaks.slice(-50), baseline: ledger.baseline || null, benchmark, principal: perf.principal, returns: perf.returns, cashTracking: perf.cashTracking };
  }
  /** 기준일 재설정(2026-11-23): 지난 기준선은 baselineHistory 에 남기고 baseline 을 비워, 다음 정상 평가점이 새 기준선(그날 보유 국가 비중 · 총자산)이 된다. 수익률·비교선·운용 일수는 그 날부터 센다.
   *  평가점·해시 체인은 그대로(지난 날짜 불변). 쓰는 작업이라 브리지는 이 PC 화면에서만 받는다. */
  function resetBaseline({ note = '' } = {}) {
    const prev = ledger.baseline || null;
    ledger.baselineHistory = [...(ledger.baselineHistory || []), { ...(prev || { from: null }), until: todayYmd(), resetAt: iso(), note: String(note || '').slice(0, 200) }].slice(-20);
    ledger.baseline = null; persist();
    return { reset: true, previousFrom: prev?.from ?? null, note: String(note || '').slice(0, 200), nextBaselineAt: '다음 정상 평가점(25분 안)' };
  }
  return { status, resetBaseline, _ledger: () => ledger };
}
