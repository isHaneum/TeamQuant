// 섹터 지도(lib/sectors.js)와 자료 파일(data/sectors.json) 검증
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { SECTORS, COMMON_ISSUES, classify, sectorExposure, issuesFor, returnsFrom, sectorName } from '../lib/sectors.js';

test('모든 이슈는 날짜·출처(URL)·영향 대상이 있고, 날짜가 자료 기준일을 넘지 않는다', () => {
  const all = [...SECTORS.flatMap(s => s.issues.map(i => ({ ...i, sector: s.id }))), ...COMMON_ISSUES];
  assert.ok(all.length >= 30);
  for (const i of all) {
    assert.match(i.date, /^\d{4}(-\d{2}(-\d{2})?)?$/, `${i.title}: date`);
    assert.ok(i.date <= '2026-11-09', `${i.title}: 미래 날짜`);
    assert.match(i.source, /^https?:\/\//, `${i.title}: source`);
    assert.ok(['+', '−', '±'].includes(i.effect), `${i.title}: effect`);
    assert.ok(i.title.length >= 8 && i.text.length >= 10);
  }
  // 섹터 이슈의 hits는 그 섹터 대표 회사 또는 다른 섹터 대표 회사 중 하나여야 한다(오타 방지)
  const known = new Set(SECTORS.flatMap(s => s.companies.map(c => c.symbol)));
  for (const s of SECTORS) for (const i of s.issues) for (const h of i.hits || []) assert.ok(known.has(h), `${s.id}/${i.title}: 모르는 종목 ${h}`);
});

test('섹터마다 대표 회사(국내 포함)·국가별 방향(5개국)·지켜볼 일정이 있다', () => {
  assert.equal(SECTORS.length, 10);
  for (const s of SECTORS) {
    assert.ok(s.companies.filter(c => c.market === 'KR').length >= 2, s.id);
    for (const k of ['US', 'EU', 'KR', 'CN', 'JP']) assert.ok(s.stances[k]?.length > 5, `${s.id} ${k}`);
    assert.ok(s.watch.length >= 2, s.id);
    assert.ok(s.etf.KR?.symbol, s.id);
  }
  const ids = new Set(SECTORS.map(s => s.id)); assert.equal(ids.size, SECTORS.length);
});

test('종목 분류: 대표 회사·코드만 있는 국내 종목·ETF·업종 힌트·모르는 종목', () => {
  assert.equal(classify('005930.KS', '삼성전자'), 'semi');
  assert.equal(classify('005930', '삼성전자'), 'semi'); // 접미사 없는 코드
  assert.equal(classify('NVDA', '엔비디아'), 'semi');
  assert.equal(classify('069500', 'KODEX 200'), 'index');
  assert.equal(classify('SPY', 'S&P500 ETF'), 'index');
  assert.equal(classify('TLT', '미국 장기채 ETF'), 'bond');
  assert.equal(classify('KO', '코카콜라'), 'unknown');
  assert.equal(classify('KO', '코카콜라', '음료'), 'other');
  assert.equal(classify('123456', '어떤 회사', '반도체와반도체장비'), 'semi');
  assert.equal(classify('042660.KS', '한화오션'), 'ship');
  assert.equal(classify('HII', 'Huntington'), 'ship'); // EXTRA가 대표 회사 매핑을 덮어쓰지 않는지(둘 다 ship)
  assert.equal(sectorName('semi'), '반도체'); assert.equal(sectorName('unknown'), '분류 없음');
});

test('섹터 분포: 비중·집중도·상한 초과·검토안', () => {
  const pos = [{ symbol: '005930.KS', name: '삼성전자', valueKrw: 5_000_000 }, { symbol: '000660.KS', name: 'SK하이닉스', valueKrw: 2_000_000 }, { symbol: '069500.KS', name: 'KODEX 200', valueKrw: 2_000_000 }, { symbol: 'KO', name: '코카콜라', valueKrw: 1_000_000 }];
  const e = sectorExposure(pos, { cashKrw: 2_000_000, style: 'balanced' });
  assert.equal(e.stocks, 10_000_000); assert.equal(e.total, 12_000_000);
  assert.equal(e.rows[0].id, 'semi'); assert.equal(Math.round(e.rows[0].pct), 70); assert.equal(e.rows[0].symbols.length, 2);
  assert.equal(e.top.id, 'semi'); assert.equal(e.cap, 40);
  assert.equal(e.over.length, 1); assert.equal(e.over[0].cutKrw, 3_000_000); // 70% → 40%
  assert.equal(e.cutKrw, 3_000_000); assert.ok(Math.abs(e.cutPctOfTotal - 25) < 1e-9);
  assert.ok(e.effective > 1.5 && e.effective < 2.2, String(e.effective)); // HHI = .49+.04+.01 = .54 → 1.85
  assert.equal(e.plan.find(p => p.id === 'semi').planPct, 40);
  // 지수 ETF만 70%여도 상한 초과로 치지 않는다
  const e2 = sectorExposure([{ symbol: '069500', name: 'KODEX 200', valueKrw: 7e6 }, { symbol: '005930', name: '삼성전자', valueKrw: 3e6 }]);
  assert.equal(e2.over.length, 0); assert.equal(e2.top.id, 'semi');
  // 성장 성향은 상한 50
  assert.equal(sectorExposure(pos, { style: 'growth' }).cap, 50);
  // 빈 입력
  const e3 = sectorExposure([]); assert.equal(e3.stocks, 0); assert.equal(e3.top, null); assert.equal(e3.effective, 0);
});

test('보유 종목에 걸린 이슈는 최신순이고 섹터 이름이 붙는다', () => {
  const list = issuesFor(['005930', 'KO']);
  assert.ok(list.length >= 3);
  for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].date >= list[i].date);
  assert.ok(list.every(i => i.sectorName && i.hits.some(h => h.startsWith('005930'))));
  assert.equal(issuesFor(['KO']).length, 0);
});

test('수익률 계산: 1주·1개월·올해·고점 대비', () => {
  const closes = []; let d = new Date('2025-01-02');
  for (let i = 0; i < 300; i++) { closes.push({ date: d.toISOString().slice(0, 10), close: 100 + i }); d = new Date(d.getTime() + 864e5); }
  const r = returnsFrom(closes);
  assert.equal(r.asOf, closes.at(-1).date);
  assert.ok(Math.abs(r.w1 - (399 / 394 - 1)) < 1e-12);
  assert.ok(Math.abs(r.y1 - (399 / 147 - 1)) < 1e-12);
  assert.equal(r.offHigh, 0);
  const ytdBase = [...closes].reverse().find(c => c.date < '2026-01-01').close; assert.ok(Math.abs(r.ytd - (399 / ytdBase - 1)) < 1e-12);
  assert.equal(returnsFrom([{ date: '2026-01-01', close: 1 }]), null);
});

test('data/sectors.json: 모든 섹터·대표 회사의 수익률이 들어 있다', { skip: !existsSync(new URL('../data/sectors.json', import.meta.url)) && '자료 파일 없음' }, () => {
  const d = JSON.parse(readFileSync(new URL('../data/sectors.json', import.meta.url), 'utf8'));
  assert.match(d.asOf, /^\d{4}-\d{2}-\d{2}$/);
  for (const s of SECTORS) {
    const o = d.sectors[s.id]; assert.ok(o, s.id);
    assert.ok(o.etf.KR?.ret?.m1 !== undefined, `${s.id} KR ETF`);
    for (const c of s.companies) { const x = o.companies[c.symbol]; assert.ok(x?.ret && Number.isFinite(x.ret.m1), `${s.id} ${c.symbol}`); assert.ok(Array.isArray(x.spark) && x.spark.length >= 40, `${s.id} ${c.symbol} spark`); }
    assert.ok(Number.isFinite(o.basket.KR?.m1), `${s.id} KR basket`);
  }
});
