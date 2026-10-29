import {readFile} from 'node:fs/promises';
let catalog;
export async function searchStocks(query='',code='') {
  catalog ||= JSON.parse(await readFile(new URL('../data/stocks.json',import.meta.url),'utf8'));
  if(code){
    const stock=catalog.find(x=>x.code===code); if(!stock)throw new Error('종목을 찾지 못했습니다.');
    if(!process.env.DART_API_KEY)throw new Error('종목 시장 확인에 필요한 DART 서버 설정이 없습니다.');
    const url=new URL('https://opendart.fss.or.kr/api/company.json');url.search=new URLSearchParams({crtfc_key:process.env.DART_API_KEY,corp_code:stock.corpCode});
    const response=await fetch(url,{signal:AbortSignal.timeout(8000)}),data=await response.json();
    if(!response.ok||data.status!=='000'||!['Y','K'].includes(data.corp_cls))throw new Error('현재 지원하는 코스피·코스닥 종목인지 확인하지 못했습니다.');
    return {...stock,symbol:stock.code+(data.corp_cls==='Y'?'.KS':'.KQ'),market:data.corp_cls==='Y'?'코스피':'코스닥'};
  }
  const term=String(query).trim().toLowerCase();if(!term||term.length>60)return {items:[]};
  return {items:catalog.filter(x=>x.name.toLowerCase().includes(term)||x.code.startsWith(term)).sort((a,b)=>(a.name.toLowerCase()===term?-1:b.name.toLowerCase()===term?1:a.name.length-b.name.length)).slice(0,12)};
}
