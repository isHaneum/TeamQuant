import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchNews, normalizeNewsQuery } from '../lib/news.js';
import handler from '../api/news.js';

const env = {NAVER_NEWS_PROVIDER:'legacy', NAVER_CLIENT_ID:'test-id', NAVER_CLIENT_SECRET:'test-secret'};

test('신규 발급은 NAVER API HUB 주소와 NCP 인증 헤더를 사용한다', async () => {
  const hubEnv = {NAVER_API_HUB_CLIENT_ID:'hub-id',NAVER_API_HUB_CLIENT_SECRET:'hub-secret'};
  const data = await fetchNews('반도체 수출','sim',{env:hubEnv,fetchImpl:async(url,options)=>{
    assert.equal(url.origin,'https://naverapihub.apigw.ntruss.com');
    assert.equal(url.pathname,'/search/v1/news');
    assert.equal(url.searchParams.get('format'),'json');
    assert.equal(options.headers['X-NCP-APIGW-API-KEY'],'hub-secret');
    assert.equal(options.headers['X-Naver-Client-Secret'],undefined);
    return Response.json({items:[],total:0});
  }});
  assert.deepEqual(data.items,[]);
});

test('검색어·정렬·서버 키를 네이버 계약에 맞게 전달하고 안전한 기사만 반환한다', async () => {
  const result = await fetchNews(' 삼성전자   실적 ', 'date', {env, fetchImpl:async (url, options) => {
    assert.equal(url.origin, 'https://openapi.naver.com');
    assert.equal(url.searchParams.get('query'), '삼성전자 실적');
    assert.equal(url.searchParams.get('sort'), 'date');
    assert.equal(options.headers['X-Naver-Client-Secret'], 'test-secret');
    return Response.json({total:4,items:[
      {title:'<b>삼성전자</b> &quot;실적&quot;',description:'매출 &amp; 영업이익',originallink:'https://example.com/a',pubDate:'Wed, 28 Oct 2026 10:00:00 +0900'},
      {title:'중복 기사',originallink:'https://example.com/a'},
      {title:'외부 링크',originallink:'javascript:alert(1)',link:'https://example.com/b'},
      {title:'거절',originallink:'javascript:alert(1)'}
    ]});
  }});
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].title, '삼성전자 "실적"');
  assert.equal(result.items[0].description, '매출 & 영업이익');
  assert.equal(result.items[0].publishedAt, '2026-10-28T01:00:00.000Z');
  assert.equal(result.items[1].link, 'https://example.com/b');
  assert.ok(!JSON.stringify(result).includes('test-secret'));
});

test('설정 누락과 잘못된 검색 조건에서는 외부 요청하지 않는다', async () => {
  let called = false;
  const options = {env:{},fetchImpl:async () => {called=true;}};
  await assert.rejects(fetchNews('삼성전자','date',options), {status:503});
  await assert.rejects(fetchNews('삼성전자','invalid',{...options,env}), {status:400});
  assert.throws(()=>normalizeNewsQuery('  '), {status:400});
  assert.throws(()=>normalizeNewsQuery('a'.repeat(101)), {status:400});
  assert.equal(called,false);
});

test('인증 실패·한도 초과·잘못된 응답은 기사로 위장하지 않고 설명한다', async () => {
  for (const [status,expected] of [[401,502],[403,502],[429,429],[500,502]]) {
    await assert.rejects(fetchNews('삼성전자','date',{env,fetchImpl:async()=>new Response('private upstream details',{status})}), error=>error.status===expected && !error.message.includes('private'));
  }
  await assert.rejects(fetchNews('삼성전자','date',{env,fetchImpl:async()=>Response.json({wrong:true})}),{status:502});
});

test('검색 API는 POST를 거절하고 응답 캐시를 비공개로 제한한다', async () => {
  const headers = {};
  const response = {setHeader:(k,v)=>headers[k]=v,status(code){this.code=code;return this;},json(value){this.body=value;return this;}};
  await handler({method:'POST'},response);
  assert.equal(response.code,405);
  assert.equal(headers.Allow,'GET');
  assert.equal(headers['Cache-Control'],'private, no-store');
});
