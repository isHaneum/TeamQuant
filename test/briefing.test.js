import test from 'node:test';
import assert from 'node:assert/strict';
import {briefingQuery,relevantArticles} from '../lib/briefing.js';
test('NAVER journalist email is not company evidence and original sources deduplicate',()=>{
  const p={symbol:'035420.KS',name:'NAVER'};
  assert.equal(briefingQuery(p),'네이버 실적');
  const article={title:'네이버 실적 발표',description:'매출 자료',link:'https://example.com/1'};
  const items=[{title:'부평구 행사',description:'기자 abc@naver.com',link:'https://example.com/2'},{title:'건강 정보',description:'기자 abc@naver,com',link:'https://example.com/3'},article,{...article}];
  assert.deepEqual(relevantArticles(p,items),[article]);
});
