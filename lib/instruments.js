import {products,findProduct} from './product-catalog.js';
const fallback={'005930':'삼성전자','000660':'SK하이닉스','035420':'NAVER','035720':'카카오','005380':'현대차','051910':'LG화학','105560':'KB금융','055550':'신한지주','373220':'LG에너지솔루션','005490':'POSCO홀딩스'};
for(const p of products)fallback[p.code]=p.name;
let names=fallback;
try { const r=await fetch('/data/stock-names.json'); if(r.ok)names={...await r.json(),...fallback}; } catch {}
export function stockName(symbol='') {return symbol==='^KS11'?'코스피':names[String(symbol).split('.')[0]]||String(symbol);}
export const stockNames=names;
export async function resolveStockInput(value){
  const input=String(value).trim();
  const product=findProduct(input);if(product)return product.symbol;
  const aliases={'네이버':'035420','현대자동차':'005380','엘지화학':'051910','포스코홀딩스':'005490'};
  if(/^[0-9]{6}\.(KS|KQ)$/i.test(input)) return input.toUpperCase();
  const code=aliases[input]||(/^\d{6}$/.test(input)?input:Object.keys(names).find(k=>names[k].toLowerCase()===input.toLowerCase()));
  if(!code)throw new Error('종목 이름을 검색하고 목록에서 선택하세요.');
  const response=await fetch('/api/stocks?'+new URLSearchParams({code})),data=await response.json();
  if(!response.ok)throw new Error(data.error||'종목 시장을 확인하지 못했습니다.');
  return data.symbol;
}
