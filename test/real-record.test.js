// 실계좌 읽기 전용 기록(결정 22): 평가점·해시 체인이 모의계좌와 같은 규칙으로 쌓이고, 비교선 비중은 첫 평가점의 보유 국가 비중에서 나오며, 응답에 계좌번호·장부 경로·주문번호가 없고 공개 스냅샷을 만들지 않는다.
// 2026-11-12 검토: 미국 잔고·외화예수금 조회 실패는 보류(평가점 없음) · 체결은 처음 본 날 한 번만(조회 시각과 무관 · 뉴욕 날짜도 조회). 네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRealRecord } from '../lib/real-record.js';
import { createLedgerStore } from '../lib/paper-live.js';
import { verifyChain } from '../lib/paper-chain.js';

function candles(n = 520, start = 100, seed = 7) { const out = []; let t = Date.parse('2024-11-01'), p = start, s = seed; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; while (out.length < n) { const d = new Date(t); if (d.getUTCDay() && d.getUTCDay() !== 6) { p *= 1 + 0.0004 + (r() - 0.5) * 0.02; out.push({ date: d.toISOString().slice(0, 10), open: p, close: p }); } t += 864e5; } return out; }
const readMarket = async s => ({ candles: candles(520, s === 'KRW=X' ? 1330 : /^\d{6}$/.test(s) ? 70000 : 100, s.length + 3).map(c => s === 'KRW=X' ? { ...c, close: 1330, open: 1330 } : c) });
const KR_VALUE = 11_730_000, US_VALUE = 10_085.64, COST_KRW = 13_409_913;
function fakeReader({ cash = 20_000_000, cashUsd = 0, orders = [] } = {}) {
  const st = { cash, cashUsd, calls: 0, usError: null, cashUsdError: null, orderDates: [] };
  const reader = {
    settings: () => ({ mode: 'prod', readOnly: true, accountMasked: '****5678' }),
    async balance({ fx = null } = {}) { st.calls++; const rate = fx > 0 ? fx : null;
      // 미국 조회 실패(usError)면 실제 리더처럼 미국 다리가 0 인 국내만의 값을 돌려준다(kis-reader.balance 와 같은 모양)
      if (st.usError) return { cash: st.cash, cashRaw: st.cash, stock: KR_VALUE, totalKrwOnly: st.cash + KR_VALUE, stockUsd: 0, cashUsd: null, usCostKrw: null, fx: rate, total: st.cash + KR_VALUE, stockKrw: KR_VALUE, usError: st.usError, cashUsdError: null, note: 'n', positions: [{ symbol: '069500', name: 'KODEX 200', market: 'KR', currency: 'KRW', qty: 138, valueKrw: KR_VALUE }], asOf: 'x' };
      const usd = US_VALUE + st.cashUsd;
      return { cash: st.cash, cashRaw: st.cash, stock: KR_VALUE, totalKrwOnly: st.cash + KR_VALUE, stockUsd: US_VALUE, cashUsd: st.cashUsd, usCostKrw: COST_KRW, fx: rate, total: usd > 0 && !rate ? null : Math.round(st.cash + KR_VALUE + usd * (rate || 0)), stockKrw: rate ? Math.round(KR_VALUE + US_VALUE * rate) : null, usError: null, cashUsdError: st.cashUsdError, note: 'n',
        positions: [{ symbol: '069500', name: 'KODEX 200', market: 'KR', currency: 'KRW', qty: 138, valueKrw: KR_VALUE }, { symbol: 'SPY', name: 'SPDR S&P500', market: 'US', currency: 'USD', qty: 7, value: US_VALUE, valueKrw: rate ? Math.round(US_VALUE * rate) : null }], asOf: 'x' }; },
    async orders(d) { st.orderDates.push(d); return orders.map(o => ({ ...o })); }
  };
  return { reader, st };
}
const tmp = () => mkdtempSync(join(tmpdir(), 'tq-real-'));
const T0 = Date.parse('2026-11-12T04:00:00Z'); // KST 13:00 목요일

test('기록: 하루 한 점 · 같은 날 교체 · 다음 날 전날 해시에 연결 · 재시작 보존 · 비교선 비중은 첫 평가점의 보유 국가 비중 · 장부 파일은 kis-prod-<뒤4자리>.json', async () => {
  let t = T0; const dir = tmp(), store = createLedgerStore(dir, { prefix: 'kis-prod' }); const { reader, st } = fakeReader({ orders: [{ market: 'KR', odno: '0000012345', code: '069500', side: 'BUY', qty: 8, filled: 8, remaining: 0, price: 85000, avgPrice: 84900, status: 'filled' }] });
  let rec = createRealRecord({ reader, store, readMarket, now: () => t });
  let s = await rec.status();
  const total = Math.round(20_000_000 + KR_VALUE + US_VALUE * 1330);
  assert.equal(s.readOnly, true); assert.equal(s.mode, 'prod'); assert.equal(s.account, '****5678'); assert.equal(s.error, null); assert.equal(s.markStale, false);
  assert.equal(s.balance.total, total); assert.equal(s.balance.usCostKrw, COST_KRW); assert.equal(s.balance.cashUsd, 0); assert.equal(s.balance.positions.length, 2); assert.deepEqual(Object.keys(s.balance.positions[0]).sort(), ['currency', 'market', 'name', 'qty', 'symbol', 'valueKrw']);
  assert.equal(s.marks.length, 1); assert.equal(s.marks[0].date, '2026-11-12'); assert.equal(s.marks[0].total, total); assert.equal(s.marks[0].cash, 20_000_000); assert.equal(s.marks[0].stock, Math.round(KR_VALUE + US_VALUE * 1330));
  assert.equal(s.chain.length, 1); assert.equal(s.chain[0].prevHash, ''); assert.deepEqual(s.chainCheck, { ok: true, days: 1, brokenAt: null, reason: null });
  assert.deepEqual(s.chain[0].payload.positions, [{ symbol: '069500', qty: 138 }, { symbol: 'SPY', qty: 7 }]); assert.equal(s.chain[0].payload.funding, 0, '실계좌는 정산 전 매수대금 보정이 없다');
  assert.deepEqual(s.chain[0].payload.fills, [{ symbol: '069500', side: 'BUY', qty: 8, avgPrice: 84900 }]); assert.equal(s.staleReason, null);
  // 비교선: 보유 국가 비중(국내 11.73M / 미국 13.41M / 나머지 현금)에서 한 번 고정
  const w = s.baseline.benchmark.weights; assert.ok(Math.abs(w.KR - KR_VALUE / total * 100) < 0.06, String(w.KR)); assert.ok(Math.abs(w.US - US_VALUE * 1330 / total * 100) < 0.06, String(w.US)); assert.ok(Math.abs(w.cash - (100 - w.KR - w.US)) < 1e-9);
  assert.equal(s.baseline.from, '2026-11-12'); assert.equal(s.baseline.capitalKrw, total); assert.equal(s.benchmark.label, '국가 비중·현금 일치 지수 투자'); assert.equal(s.benchmark.diffPp, null, '평가점 하나면 비교 없음'); assert.equal(s.benchmark.days, 1);
  // 응답·장부에 없는 것: 계좌번호 원문·장부 경로·주문번호·종목명(체인)
  const json = JSON.stringify(s); assert.ok(!json.includes('ledgerPath') && !json.includes(dir.replace(/\\/g, '\\\\')) && !json.includes('kis-prod-') && !json.includes('0000012345'));
  assert.ok(!JSON.stringify(s.chain).includes('KODEX') && !JSON.stringify(s.chain).includes('name'));
  assert.deepEqual(readdirSync(dir).filter(f => f.endsWith('.json')), ['kis-prod-5678.json'], '모의 장부(kis-vps-*)와 다른 파일');
  const file = readFileSync(join(dir, 'kis-prod-5678.json'), 'utf8'); assert.equal(JSON.parse(file).readOnly, true); assert.ok(!file.includes('0000012345') && !file.includes('12345'), '주문번호 원문은 장부에도 없다(해시 열쇠만)'); assert.equal(JSON.parse(file).fills.length, 1);
  // 같은 날 다시(현금 바뀜): 항목 수 그대로, 해시만 바뀜 · 기준선은 그대로
  const h1 = s.chain[0].hash; st.cash = 19_000_000; t += 3600e3; s = await rec.status(); assert.equal(s.marks.length, 1); assert.equal(s.chain.length, 1); assert.notEqual(s.chain[0].hash, h1); assert.equal(s.chain[0].payload.cash, 19_000_000); assert.deepEqual(s.baseline.benchmark.weights, w);
  // 다음 날 · 재시작: 두 번째 항목이 첫 항목에 연결 · 비교선 숫자가 나온다(diffPp = 절차 − 비교선)
  t += 864e5; rec = createRealRecord({ reader, store, readMarket, now: () => t }); s = await rec.status();
  assert.equal(s.marks.length, 2); assert.equal(s.chain.length, 2); assert.equal(s.chain[1].prevHash, s.chain[0].hash); assert.equal(verifyChain(s.chain).ok, true);
  assert.deepEqual(s.chain[1].payload.fills, [], '증권사가 같은 체결을 다시 돌려줘도 처음 본 날(어제) 항목에만 있다');
  assert.equal(typeof s.benchmark.diffPp, 'number'); assert.equal(s.benchmark.days, 2); assert.ok(Math.abs(s.benchmark.diffPp - (s.benchmark.ownRetPct - s.benchmark.benchRetPct)) < 0.011); assert.deepEqual([s.benchmark.from, s.benchmark.asOf], ['2026-11-12', '2026-11-13']);
  // 지난 평가점이 바뀌면 체인 항목은 그대로, chainBreaks 에 적힘
  const sealed = JSON.stringify(rec._ledger().chain[0]); rec._ledger().marks[0].total += 1; t += 3600e3; s = await rec.status(); assert.equal(JSON.stringify(s.chain[0]), sealed); assert.equal(s.chainBreaks.length, 1); assert.equal(s.chainBreaks[0].date, '2026-11-12');
});

test('보류·실패: 해외 자산이 있는데 환율이 없으면 평가점을 적지 않고(markStale) · 잔고 조회가 던져도 status 는 기록을 돌려주며 던지지 않는다 · 주문 함수가 있는 클라이언트는 거부', async () => {
  const noFx = async s => (s === 'KRW=X' ? { candles: [] } : readMarket(s));
  const { reader } = fakeReader(); const rec = createRealRecord({ reader, store: createLedgerStore(tmp(), { prefix: 'kis-prod' }), readMarket: noFx, now: () => T0 });
  const s = await rec.status(); assert.equal(s.markStale, true); assert.equal(s.marks.length, 0); assert.equal(s.chain.length, 0); assert.equal(s.balance.total, null); assert.equal(s.baseline, null); assert.equal(s.benchmark, null);
  const bad = { ...reader, balance: async () => { const e = new Error('조회 실패 ODNO 0000012345 계좌 12345678'); e.code = 'kis_error'; throw e; } };
  const rec2 = createRealRecord({ reader: bad, store: createLedgerStore(tmp(), { prefix: 'kis-prod' }), readMarket, now: () => T0 });
  const s2 = await rec2.status(); assert.match(s2.error, /잔고 조회 실패/); assert.ok(!s2.error.includes('0000012345') && !s2.error.includes('12345678'), '오류 문구의 번호는 지운다'); assert.equal(s2.balance, null); assert.deepEqual(s2.marks, []); assert.equal(s2.readOnly, true);
  assert.throws(() => createRealRecord({ reader: { ...reader, place: async () => { } }, store: createLedgerStore(tmp(), { prefix: 'kis-prod' }), readMarket }), /주문 함수/);
  assert.throws(() => createRealRecord({ reader: { ...reader, settings: () => ({ mode: 'vps', accountMasked: '****2787' }) }, store: createLedgerStore(tmp(), { prefix: 'kis-prod' }), readMarket }), /읽기 전용/);
});

test('보류(fail-closed): 미국 잔고 조회 실패(usError)·외화예수금 조회 실패(cashUsdError)는 평가점·봉인·기준선을 만들지 않고 staleReason 을 돌려준다 — 국내만의 값이 자산 급감으로 봉인되거나 첫 평가점의 비교선 미국 비중이 0 으로 굳지 않게', async () => {
  let t = T0; const { reader, st } = fakeReader(); const rec = createRealRecord({ reader, store: createLedgerStore(tmp(), { prefix: 'kis-prod' }), readMarket, now: () => t });
  // 첫날부터 미국 조회 실패: 평가점·기준선 없음(있었다면 미국 0% 비교선이 영영 굳는다)
  st.usError = 'network'; let s = await rec.status(); assert.equal(s.markStale, true); assert.equal(s.staleReason, 'us_failed'); assert.deepEqual(s.marks, []); assert.equal(s.chain.length, 0); assert.equal(s.baseline, null); assert.equal(s.balance.total, null, '국내만의 값을 총자산으로 내지 않는다'); assert.equal(s.balance.usError, 'network'); assert.equal(s.error, null);
  // 정상 조회 → 평가점 1 · 기준선(미국 비중 > 0)
  st.usError = null; t += 3600e3; s = await rec.status(); assert.equal(s.markStale, false); assert.equal(s.marks.length, 1); assert.ok(s.baseline.benchmark.weights.US > 0); const total1 = s.marks[0].total;
  // 다음 날 미국 조회 실패: 평가점·체인 그대로(마지막 정상 평가 유지) · 외화예수금 조회 실패도 같다
  t += 864e5; st.usError = 'kis_error'; s = await rec.status(); assert.equal(s.markStale, true); assert.equal(s.staleReason, 'us_failed'); assert.equal(s.marks.length, 1); assert.equal(s.chain.length, 1); assert.equal(s.marks[0].total, total1); assert.equal(s.balance.total, null);
  st.usError = null; st.cashUsdError = 'present_failed'; s = await rec.status(); assert.equal(s.markStale, true); assert.equal(s.staleReason, 'us_cash_failed'); assert.equal(s.marks.length, 1); assert.equal(s.balance.cashUsdError, 'present_failed');
  st.cashUsdError = null; s = await rec.status(); assert.equal(s.markStale, false); assert.equal(s.marks.length, 2);
});

test('체결은 조회 시각과 무관하게 같다: 같은 KST 날 10:00 과 19:00 의 status 가 같은 fills 를 봉인하고(국내·미국 모두) KST 오늘과 뉴욕 오늘 둘 다 조회한다', async () => {
  const orders = [{ market: 'KR', odno: '0000012345', code: '069500', side: 'BUY', qty: 8, filled: 8, remaining: 0, price: 85000, avgPrice: 84900, status: 'filled' }, { market: 'US', odno: '777', code: 'SPY', side: 'BUY', qty: 2, filled: 2, remaining: 0, price: 500, avgPrice: 499.5, status: 'filled' }, { market: 'KR', odno: '0000012346', code: '005930', side: 'SELL', qty: 10, filled: 3, remaining: 0, price: 70000, avgPrice: 70100, status: 'cancelled' }, { market: 'KR', odno: '0000012347', code: '000660', side: 'BUY', qty: 10, filled: 0, remaining: 10, price: 500000, avgPrice: null, status: 'open' }];
  const want = [{ symbol: '005930', side: 'SELL', qty: 3, avgPrice: 70100 }, { symbol: '069500', side: 'BUY', qty: 8, avgPrice: 84900 }, { symbol: 'SPY', side: 'BUY', qty: 2, avgPrice: 499.5 }];
  for (const hhZ of ['01', '10']) { // 10:00 KST(뉴욕은 전날) · 19:00 KST(뉴욕 같은 날)
    const { reader, st } = fakeReader({ orders }); const rec = createRealRecord({ reader, store: createLedgerStore(tmp(), { prefix: 'kis-prod' }), readMarket, now: () => Date.parse(`2026-11-12T${hhZ}:00:00Z`) });
    const s = await rec.status(); assert.deepEqual(s.chain[0].payload.fills, want, `KST ${hhZ}Z`);
    assert.deepEqual([...new Set(st.orderDates)].sort(), hhZ === '01' ? ['20261111', '20261112'] : ['20261112'], '뉴욕 날짜가 다르면 그 날짜도 조회');
  }
});

test('공개 스냅샷 없음: real-record 는 paper-public 을 쓰지 않고, dev-server 는 실계좌 기록을 publishPublic·공개 파일 쓰기에 넘기지 않는다', () => {
  const root = new URL('../', import.meta.url), rr = readFileSync(new URL('lib/real-record.js', root), 'utf8'), dev = readFileSync(new URL('dev-server.mjs', root), 'utf8');
  assert.doesNotMatch(rr, /from '\.\/paper-public|publicSnapshot|writeFileSync|process\.env/, 'import 도 호출도 없다(주석의 언급만 허용)');
  assert.match(dev, /realRecord=createRealRecord\(/); assert.match(dev, /createLedgerStore\(ledgerDir\(\),\{prefix:'kis-prod'\}\)/); assert.match(dev, /'kis-prod-token\.json'/);
  for (const line of dev.split(/\r?\n/)) if (/realRecord/.test(line)) assert.doesNotMatch(line, /publishPublic|publicSnapshot|writeFileSync|paper-live-public/, '실계좌 기록은 공개 경로에 닿지 않는다');
  assert.doesNotMatch(dev, /createKisClient\([^)]*ro\b/, '실전 설정이 주문 클라이언트에 들어가지 않는다');
});
