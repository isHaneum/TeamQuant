import test from 'node:test';
import assert from 'node:assert/strict';
import {runBacktest} from '../lib/backtest.js';
import {compareThreeMonths,threeMonthsBefore} from '../lib/comparison.js';
const candles=Array.from({length:260},(_,i)=>({date:new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10),open:100+Math.sin(i/6)*10,close:100+Math.sin(i/6)*10,adjustedClose:100+Math.sin(i/6)*10}));
const config={strategyType:'breakout',entryLookback:3,exitLookback:2,positionPct:100};
test('평가 전 가격은 지표 준비에만 쓰고 이전 주문·자산은 평가에 섞지 않는다',()=>{
  const start=candles[170].date,r=runBacktest(candles,{...config,evaluationStartDate:start});
  assert.equal(r.equity[0].date,start);
  assert.equal(r.equity[0].value,10_000_000);
  assert.ok(r.trades.every(t=>t.signalDate>=start&&t.date>t.signalDate));
});
test('시장 자료가 없거나 허용하지 않으면 신규 매수를 보류한다',()=>{
  const r=runBacktest(candles,{...config,entryAllowedByDate:{}});
  assert.equal(r.trades.length,0);
  assert.ok(r.decisions.some(d=>d.reason.includes('시장 조건')));
});
test('종목 간 같은 날짜·시작 자금으로 3개월 비교하며 결과가 재현된다',()=>{
  const series=[{symbol:'A',candles},{symbol:'B',candles}],market={candles};
  const a=compareThreeMonths(series,market,config,10000000,.2),b=compareThreeMonths(series,market,config,10000000,.2);
  assert.deepEqual(a,b);
  assert.equal(a.base.equity[0].value,10000000);
  assert.ok(a.perStock.every(s=>s.base.equity[0].date===a.start));
  assert.equal(a.filtered.equity.length,a.benchmark.equity.length);
  assert.ok(a.start>=threeMonthsBefore(a.end));
});
test('미래 시장 값은 과거 판단을 바꾸지 않는다',()=>{
  const changed=candles.map((c,i)=>i>230?{...c,close:c.close*5,adjustedClose:c.close*5}:c);
  const a=compareThreeMonths([{symbol:'A',candles}],{candles},config,10000000,.2);
  const b=compareThreeMonths([{symbol:'A',candles}],{candles:changed},config,10000000,.2);
  assert.deepEqual(a.perStock[0].market.decisions.filter(x=>x.date<=candles[230].date),b.perStock[0].market.decisions.filter(x=>x.date<=candles[230].date));
});
test('달력상 3개월과 잘못된 비용·데이터를 처리한다',()=>{
  assert.equal(threeMonthsBefore('2026-05-31'),'2026-02-28');
  assert.throws(()=>compareThreeMonths([],{candles},config,1,.2));
  assert.throws(()=>compareThreeMonths([{symbol:'A',candles}],{candles},config,1,-1));
});
