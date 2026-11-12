// 기록 해시 체인(순수 함수): 결정성 · 한 칸 바꾸면 들킴 · 연결 끊김 · 날짜 순서 · 체결 선별(확인한 KST 날짜 · 체결 수량 기준) · 표시 숫자 대조 · CLI verify 는 공개 파일만 읽는다. 네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonical, entryFor, verifyChain, verifyAgainstMarks, hashOf, TOTAL_DEFINITION } from '../lib/paper-chain.js';

const mark = (date, over = {}) => ({ date, total: 100_000_000, cash: 20_000_000, stock: 80_000_000, fx: 1450, ...over });
const positions = [{ symbol: 'SPY', qty: 7, name: 'S&P500', price: 759 }, { symbol: '005930', qty: 57, name: '삼성전자' }];
const orders = [
  { at: '2026-11-09T03:21:00Z', symbol: '005930', market: 'KR', side: 'BUY', qty: 57, filledQty: 57, avgPrice: 68000, status: 'filled', odno: '0000123456', brokerMsg: '정상' },   // KST 11-09
  { at: '2026-11-09T14:40:00Z', symbol: 'SPY', market: 'US', side: 'BUY', qty: 7, filledQty: 7, avgPrice: 749.01, status: 'filled', odno: '9002' },                              // 09:40 ET 11-09 (KST 23:40)
  { at: '2026-11-09T16:30:00Z', symbol: 'JNJ', market: 'US', side: 'BUY', qty: 17, filledQty: 10, avgPrice: 281.74, status: 'partial', odno: '9003' },                           // 11:30 ET 11-09 = KST 11-10 01:30 → 11-10 항목(확인한 KST 날짜 · 뉴욕 거래일이 아님)
  { at: '2026-11-09T04:00:00Z', symbol: '069500', market: 'KR', side: 'SELL', qty: 100, filledQty: 0, status: 'sent' },                                                           // 미체결 → 제외
  { at: '2026-11-08T03:00:00Z', symbol: '000660', market: 'KR', side: 'BUY', qty: 9, filledQty: 9, avgPrice: 500000, status: 'filled' },                                         // 다른 날 → 제외
  { at: '2026-11-09T05:00:00Z', symbol: '035420', market: 'KR', side: 'SELL', qty: 10, filledQty: 3, avgPrice: 210000, status: 'cancelled' },                                     // 일부 체결 뒤 취소 → 체결 3주는 들어간다
  { at: '2026-11-08T14:40:00Z', symbol: 'NVDA', market: 'US', side: 'BUY', qty: 4, filledQty: 4, avgPrice: 180.1, status: 'filled', filledAt: '2026-11-09T00:10:00Z' },         // 주문은 11-08, 체결 확인은 KST 11-09 09:10 → 11-09 항목
  { at: '2026-11-09T06:00:00Z', symbol: '005380', market: 'KR', side: 'BUY', qty: 5, filledQty: 0, status: 'expired' }                                                            // 체결 0 소멸 → 제외
];
const chainOf = (n, over = {}) => { const out = []; let prev = ''; for (let i = 0; i < n; i++) { const d = `2026-11-${String(9 + i).padStart(2, '0')}`; const e = entryFor({ prevHash: prev, mark: mark(d, { total: 100_000_000 + i * 1000, ...over }), positions, fills: orders }); out.push(e); prev = e.hash; } return out; };

test('canonical: 키 순서가 달라도 같은 문자열, 숫자는 그대로, undefined 는 빠지고 null 은 남는다', () => {
  assert.equal(canonical({ b: 1, a: [{ z: 2, y: null }, 'x'], c: { k: 0.1 } }), canonical({ c: { k: 0.1 }, a: [{ y: null, z: 2 }, 'x'], b: 1 }));
  assert.equal(canonical({ a: 1, u: undefined }), '{"a":1}'); assert.equal(canonical([1, undefined, null]), '[1,null,null]'); assert.equal(canonical(1234567.89), '1234567.89');
});

test('entryFor: 결정적 · genesis prevHash 는 빈 문자열 · 보유는 종목순 · 체결은 확인한 KST 날짜(filledAt · 없으면 at)가 그날이고 체결 수량이 있는 주문(취소·소멸 포함)만 종목·방향순 · fx 없음은 null · 주문번호·증권사 문구는 들어가지 않는다', () => {
  const e1 = entryFor({ prevHash: '', mark: mark('2026-11-09'), positions, fills: orders }), e2 = entryFor({ prevHash: '', mark: mark('2026-11-09'), positions: [...positions].reverse(), fills: [...orders].reverse() });
  assert.equal(e1.hash, e2.hash); assert.equal(e1.prevHash, ''); assert.match(e1.hash, /^[0-9a-f]{64}$/); assert.equal(e1.hash, hashOf('', e1.payload));
  assert.deepEqual(e1.payload.positions, [{ symbol: '005930', qty: 57 }, { symbol: 'SPY', qty: 7 }]);
  assert.deepEqual(e1.payload.fills, [{ symbol: '005930', side: 'BUY', qty: 57, avgPrice: 68000 }, { symbol: '035420', side: 'SELL', qty: 3, avgPrice: 210000 }, { symbol: 'NVDA', side: 'BUY', qty: 4, avgPrice: 180.1 }, { symbol: 'SPY', side: 'BUY', qty: 7, avgPrice: 749.01 }]);
  // KST 자정 뒤 미국 체결(JNJ)은 다음 날(11-10) 항목에 들어간다 — 뉴욕 거래일로 골랐다면 이미 닫힌 11-09 항목에 속해 어디에도 못 들어갔다
  assert.deepEqual(entryFor({ mark: mark('2026-11-10'), fills: orders }).payload.fills, [{ symbol: 'JNJ', side: 'BUY', qty: 10, avgPrice: 281.74 }]);
  assert.deepEqual([e1.payload.funding, e1.payload.fx, e1.payload.total], [0, 1450, 100_000_000]);
  const noFx = entryFor({ mark: mark('2026-11-09', { fx: null }) }).payload; assert.equal(noFx.fx, null, '환율 없음은 null 로 봉인(0 이 아님)'); assert.equal(entryFor({ mark: mark('2026-11-09', { fx: undefined }) }).payload.fx, null);
  const text = JSON.stringify(e1); assert.ok(!text.includes('0000123456') && !text.includes('9002') && !text.includes('정상') && !text.includes('name'));
  assert.equal(entryFor({ mark: mark('2026-11-09', { funding: 13_409_913, fx: null }), positions: [], fills: [] }).payload.funding, 13_409_913);
  assert.notEqual(entryFor({ prevHash: 'a', mark: mark('2026-11-09') }).hash, entryFor({ prevHash: 'b', mark: mark('2026-11-09') }).hash, 'prevHash 가 다르면 해시가 다르다');
});

test('verifyChain: 정상 체인은 ok · payload 한 칸만 바꿔도 그 날짜에서 깨짐 · 연결(prevHash) 끊김 · 날짜가 증가하지 않으면 깨짐 · 빈 체인은 0일 정상', () => {
  const chain = chainOf(4); assert.deepEqual(verifyChain(chain), { ok: true, days: 4, brokenAt: null, reason: null });
  assert.deepEqual(verifyChain([]), { ok: true, days: 0, brokenAt: null, reason: null });
  const tampered = chain.map((e, i) => i === 1 ? { ...e, payload: { ...e.payload, total: e.payload.total + 1 } } : e);
  const t = verifyChain(tampered); assert.equal(t.ok, false); assert.equal(t.brokenAt, '2026-11-10'); assert.match(t.reason, /해시/);
  const qty = chain.map((e, i) => i === 2 ? { ...e, payload: { ...e.payload, positions: e.payload.positions.map(p => ({ ...p, qty: p.qty + 1 })) } } : e); assert.equal(verifyChain(qty).brokenAt, '2026-11-11');
  // 한 항목을 통째로 다시 만들어 끼우면(자기 해시는 맞음) 다음 항목의 prevHash 가 맞지 않는다
  const rewritten = chain.map((e, i) => i === 1 ? entryFor({ prevHash: chain[0].hash, mark: mark('2026-11-10', { total: 1 }), positions, fills: orders }) : e);
  const r = verifyChain(rewritten); assert.equal(r.ok, false); assert.equal(r.brokenAt, '2026-11-11'); assert.match(r.reason, /prevHash/);
  const dropped = [chain[0], chain[2], chain[3]]; assert.match(verifyChain(dropped).reason, /prevHash/, '중간 하루를 지워도 들킨다');
  const reordered = [chain[1], chain[0]]; assert.equal(verifyChain(reordered).ok, false); assert.match(verifyChain(reordered).reason, /날짜/);
  const dup = [chain[0], { ...chain[0] }]; assert.match(verifyChain(dup).reason, /날짜/, '같은 날짜가 두 번이면 깨짐');
  assert.equal(verifyChain([{ ...chain[0], date: '2026-11-10' }]).ok, false, '항목 날짜와 봉인된 날짜가 다르면 깨짐');
  assert.equal(verifyChain(null).ok, false); assert.equal(verifyChain([null]).ok, false);
  // 공개 파일은 최근 400일만 실을 수 있다: 앞이 잘린 체인도 남은 부분은 검증된다
  assert.equal(verifyChain(chain.slice(2)).ok, true);
});

test('verifyAgainstMarks: 화면이 읽는 marks 가 봉인 값과 다르면(체인은 멀쩡해도) 날짜·항목을 집어낸다 · 평가점이 없는 날짜는 비교하지 않는다 · funding 없음은 0 과 같다', () => {
  const chain = chainOf(3), marks = chain.map(e => ({ date: e.date, total: e.payload.total, cash: e.payload.cash, stock: e.payload.stock }));
  assert.deepEqual(verifyAgainstMarks(chain, marks), { ok: true, compared: 3, mismatches: [] });
  const edited = marks.map((m, i) => i === 1 ? { ...m, total: m.total - 90 } : m); assert.equal(verifyChain(chain).ok, true, '체인만 보면 정상');
  assert.deepEqual(verifyAgainstMarks(chain, edited), { ok: false, compared: 3, mismatches: [{ date: '2026-11-10', keys: ['total'] }] });
  assert.deepEqual(verifyAgainstMarks(chain, marks.slice(1)).compared, 2); assert.deepEqual(verifyAgainstMarks(chain, [{ ...marks[0], funding: 5 }]).mismatches, [{ date: '2026-11-09', keys: ['funding'] }]);
  assert.equal(verifyAgainstMarks(null, null).ok, true);
});

test('CLI verify: 공개 파일만 읽어 한 줄로 답하고 표시 숫자를 대조하고 총자산 정의를 찍는다 · 깨진 파일·marks 만 고친 파일은 종료 코드 1 · 키·.env·장부·서버가 없어도 된다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-chain-')), script = new URL('../scripts/kis-paper.mjs', import.meta.url);
  const chain = chainOf(3); const good = join(dir, 'good.json'), bad = join(dir, 'bad.json'), edited = join(dir, 'edited.json');
  const marks = chain.map(e => ({ date: e.date, total: e.payload.total, cash: e.payload.cash, stock: e.payload.stock }));
  writeFileSync(good, JSON.stringify({ version: 'PUB2', chain, chainBreaks: [{ date: '2026-11-09', note: 'x' }], marks, total: marks.at(-1).total }));
  writeFileSync(edited, JSON.stringify({ version: 'PUB2', chain, marks: marks.map((m, i) => i === 0 ? { ...m, total: 90 } : m), total: marks.at(-1).total + 1 }));
  writeFileSync(bad, JSON.stringify({ version: 'PUB2', chain: chain.map((e, i) => i === 2 ? { ...e, payload: { ...e.payload, cash: 1 } } : e) }));
  const env = { ...process.env, TEAMQUANT_PAPER_DIR: join(dir, 'no-ledger') }; // 장부 폴더가 없어도(만들지도 않고) 돈다
  const out = execFileSync(process.execPath, [fileURLToPath(script), 'verify', good], { encoding: 'utf8', env });
  assert.match(out, /^해시 체인 3일 · 정상 · 봉인 뒤 바뀐 지난 평가점 1건/m); assert.match(out, /^표시 숫자 대조 3건 일치/m); assert.ok(out.includes(TOTAL_DEFINITION)); assert.doesNotMatch(out, /키: /, '키 요약 줄을 찍지 않는다(환경을 읽지 않음)');
  const run = file => { try { return { code: 0, text: execFileSync(process.execPath, [fileURLToPath(script), 'verify', file], { encoding: 'utf8', env }) }; } catch (e) { return { code: e.status, text: String(e.stdout) }; } };
  const b = run(bad); assert.equal(b.code, 1); assert.match(b.text, /해시 체인 3일 · 깨짐: 2026-11-11/);
  // 체인은 그대로 두고 화면이 읽는 marks·total 만 고친 파일: 체인은 정상이지만 종료 코드 1 과 불일치 줄
  const e = run(edited); assert.equal(e.code, 1); assert.match(e.text, /^해시 체인 3일 · 정상/m); assert.match(e.text, /표시 숫자와 봉인 값 불일치 2건\(2026-11-09: total · 2026-11-11: total\(공개 total\)\)/);
});
