// 결정 63: 묶음 시세가 원천을 두드리지 않게 — 실패 5분 기억 · 새 미국 코드는 요청당 5개까지 · 성공한 주소 기억 · 목록 정렬.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchQuotes, parseSymbolList } from '../lib/quote-check.js';

test('없는 미국 코드 20개: 첫 요청은 5개 × 4주소 = 20번까지만 · 같은 요청 반복은 원천 0번(실패 기억)', async () => {
  let n = 0; const fetchImpl = async () => { n++; return { ok: false, json: async () => ({}) }; };
  const list = parseSymbolList(Array.from({ length: 20 }, (_, i) => 'ZZQ' + String.fromCharCode(65 + i)).join(','));
  const r1 = await fetchQuotes(list, { fetchImpl }); assert.equal(n, 20); assert.equal(Object.values(r1.quotes).filter(q => /잠시 뒤/.test(q.error || '')).length, 15);
  n = 0; await fetchQuotes(list.slice(0, 5), { fetchImpl }); assert.equal(n, 0, '실패는 5분 기억');
});

test('성공한 미국 주소를 기억해 다음엔 한 번만 묻는다 · 목록은 정렬된다', async () => {
  let n = 0; const fetchImpl = async url => { n++; return url.endsWith('ABCD.N/basic') ? { ok: true, json: async () => ({ closePrice: '10', marketStatus: 'OPEN', localTradedAt: new Date().toISOString() }) } : { ok: false, json: async () => ({}) }; };
  let t = 1e12; await fetchQuotes(['ABCD'], { fetchImpl, now: () => t }); assert.equal(n, 2, '.O 실패 → .N 성공');
  n = 0; t += 60_000; const r = await fetchQuotes(['ABCD'], { fetchImpl, now: () => t }); assert.equal(n, 1, '기억한 주소 하나만'); assert.equal(r.quotes.ABCD.price, 10);
  assert.deepEqual(parseSymbolList('SPY,069500,AMZN'), ['069500', 'AMZN', 'SPY']);
});
