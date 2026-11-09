import {products,findProduct} from './product-catalog.js';
import {readFile} from 'node:fs/promises';
let catalog;
// 검색 순위: 흔히 찾는 대형주·ETF를 먼저(이름 길이만으로 정렬하면 '현대'에 현대금속이 현대차보다 앞선다). 별칭은 흔한 줄임말.
const PRIORITY_LIST=['005930','000660','005380','000270','012330','035420','035720','105560','055550','086790','207940','068270','373220','006400','051910','005490','012450','064350','047810','079550','329180','042660','010140','009540','034020','015760','066570','003550','017670','030200','096770','028260','009150','018260','032830','000810','138040','069500','102110','091160','091180','305720','266420','449450','494670','445290','247540','196170','042700','003670','011200','010130','034730','000100','326030','259960','036570','005935','000270','011170','010950','090430','051900','271560','033780','097950','004020','009830','000720','006800','016360','039490','024110','316140','071050','323410','030000','021240','008770','035250','139480','251270','293490','352820'];
const PRIORITY=new Map(PRIORITY_LIST.map((c,i)=>[c,i]));
const ALIAS={'현대차':'005380','현차':'005380','현대자동차':'005380','삼전':'005930','삼성':'005930','하이닉스':'000660','에스케이하이닉스':'000660','네이버':'035420','카카오':'035720','기아차':'000270','엘지엔솔':'373220','엘지에너지솔루션':'373220','포스코':'005490','케이비':'105560','국민은행':'105560','셀트':'068270','삼바':'207940','삼성바이오':'207940','한화에어로':'012450','현대중공업':'329180','코덱스200':'069500','kodex200':'069500','코스피200':'069500'};
export async function searchStocks(query='',code='') {
  catalog ||= JSON.parse(await readFile(new URL('../data/stocks.json',import.meta.url),'utf8'));
  if(code){
    const product=findProduct(code);if(product)return product;
    const stock=catalog.find(x=>x.code===code); if(!stock)throw new Error('종목을 찾지 못했습니다.');
    if(!process.env.DART_API_KEY)throw new Error('종목 시장 확인에 필요한 DART 서버 설정이 없습니다.');
    const url=new URL('https://opendart.fss.or.kr/api/company.json');url.search=new URLSearchParams({crtfc_key:process.env.DART_API_KEY,corp_code:stock.corpCode});
    const response=await fetch(url,{signal:AbortSignal.timeout(8000)}),data=await response.json();
    if(!response.ok||data.status!=='000'||!['Y','K'].includes(data.corp_cls))throw new Error('현재 지원하는 코스피·코스닥 종목인지 확인하지 못했습니다.');
    return {...stock,symbol:stock.code+(data.corp_cls==='Y'?'.KS':'.KQ'),market:data.corp_cls==='Y'?'코스피':'코스닥'};
  }
  const term=String(query).trim().toLowerCase();if(!term||term.length>60)return {items:[]};
  const all=[...products,...catalog],alias=ALIAS[term.replace(/\s+/g,'')];
  const rank=x=>(x.code===alias?0:x.name.toLowerCase()===term?1:2)*1000+(PRIORITY.has(x.code)?PRIORITY.get(x.code):300+(x.name.toLowerCase().startsWith(term)?0:100)+x.name.length);
  const hits=all.filter(x=>x.name.toLowerCase().includes(term)||x.code.startsWith(term)||x.code===alias);
  return {items:hits.sort((a,b)=>rank(a)-rank(b)).slice(0,15)};
}
