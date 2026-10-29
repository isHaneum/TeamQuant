import test from 'node:test';
import assert from 'node:assert/strict';
import {portfolioMetrics,evaluatePrinciples,simulateContributions,rebalanceOptions} from '../lib/portfolio.js';
const p={cash:670,positions:[{symbol:'A',name:'A',quantity:3,avgCost:100}]};
const quotes={A:{price:110,prevClose:100,asOf:'2026-10-28'}};
test('asset metrics distinguish holding gains, daily contribution and cash weights',()=>{
  const m=portfolioMetrics(p,quotes);assert.equal(m.total,1000);assert.equal(m.pnl,30);assert.equal(m.returnPct,10);assert.equal(m.dailyPnl,30);assert.equal(m.positions[0].weightPct,33);assert.equal(m.cashPct,67);
});
test('33% weight vs 25% limit produces 8 percentage points, cash included',()=>{
  const r=evaluatePrinciples(portfolioMetrics(p,quotes),{approvedAt:'now',maxPositionPct:25,minCashPct:10});assert.equal(r.evaluations[0].gap,8);assert.equal(r.evaluations[0].status,'위반');assert.equal(r.score,50);
});
test('missing price does not create fabricated total or passing rule',()=>{
  const m=portfolioMetrics(p,{});assert.equal(m.total,null);assert.equal(m.dailyPnl,null);const r=evaluatePrinciples(m,{approvedAt:'now',maxPositionPct:25,minCashPct:10});assert.equal(r.score,null);assert.equal(r.measurable,0);assert.ok(r.evaluations.every(e=>e.status==='평가 불가'));
});
test('exact threshold passes, near threshold marked imminent, no principles no score',()=>{
  const m=portfolioMetrics({cash:750,positions:[{symbol:'A',name:'A',quantity:1,avgCost:250}]},{A:{price:250}});const r=evaluatePrinciples(m,{approvedAt:'now',maxPositionPct:25,minCashPct:10});assert.equal(r.evaluations[0].status,'임박');assert.equal(r.score,100);assert.equal(evaluatePrinciples(m,null).score,null);assert.equal(m.dailyPnl,null);
});
test('500k monthly for 10y with zero return separates deposited capital',()=>{
  const r=simulateContributions({initial:0,once:0,monthly:500000,months:120,annualRate:0});assert.equal(r.principal,60000000);assert.equal(r.value,60000000);assert.equal(r.gain,0);assert.equal(r.series.length,121);
});
test('contributions occur at month end, fees annual compounded and losses allowed',()=>{
  const r=simulateContributions({initial:100,once:100,monthly:10,months:1,annualRate:12,annualFee:2});assert.ok(Math.abs(r.value-(200*(1.12*.98)**(1/12)+10))<1e-8);
  const loss=simulateContributions({initial:100,once:0,monthly:0,months:12,annualRate:-20});assert.ok(Math.abs(loss.value-80)<1e-8);assert.ok(loss.gain<0);
});
test('rebalance includes fee effect on denominator, integer shares, and does not mutate',()=>{
  const m=portfolioMetrics(p,quotes),copy=structuredClone(m),r=rebalanceOptions(m,'A',25,.2);assert.equal(r.quantity,1);assert.ok(r.afterWeightPct<=25);assert.equal(r.fees,.22);assert.equal(r.additionalCash,320);assert.deepEqual(m,copy);
});
test('reject invalid contributions, empty period and negative cash',()=>{
  assert.throws(()=>portfolioMetrics({...p,cash:-1},quotes));assert.throws(()=>simulateContributions({initial:0,once:0,monthly:1,months:0,annualRate:0}));assert.throws(()=>simulateContributions({initial:0,once:0,monthly:1,months:12,annualRate:-100}));
});
