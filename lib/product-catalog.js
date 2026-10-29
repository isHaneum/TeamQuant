// Explicit exchange mappings for ETFs; DART company lookup is not an ETF directory.
export const products=[
 {code:'069500',symbol:'069500.KS',name:'KODEX 200',currency:'KRW',kind:'ETF',market:'코스피',source:'https://www.samsungfund.com/etf/product/view.do?id=2ETF01'},
 {code:'360750',symbol:'360750.KS',name:'TIGER 미국S&P500',currency:'KRW',kind:'ETF',market:'코스피',source:'https://www.tigeretf.com/upload/etf/20250312031249004920.pdf'}
];
export function findProduct(value){const q=String(value).trim().toUpperCase();return products.find(p=>[p.code,p.symbol,p.name.toUpperCase()].includes(q));}
export function parseFundCsv(text,name='기준가 펀드',currency='KRW'){
 if(!['KRW','USD'].includes(currency)||text.length>2_000_000)throw new Error('KRW/USD 기준가 CSV(2MB 이하)만 지원합니다.');
 const lines=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/);if(lines.shift()?.trim().toLowerCase()!=='date,nav')throw new Error('CSV 첫 행은 date,nav 형식이어야 합니다.');
 const candles=lines.map((line,i)=>{const [date,raw,...rest]=line.split(',').map(x=>x.trim()),v=Number(raw);if(rest.length||!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date>new Date().toISOString().slice(0,10)||!raw||!Number.isFinite(v)||v<=0)throw new Error(`${i+2}행의 날짜·기준가를 확인하십시오.`);return {date,open:v,close:v,adjustedClose:v};});
 if(candles.length<90||candles.length>10000||candles.some((c,i)=>i&&c.date<=candles[i-1].date))throw new Error('날짜순·중복 없는 기준가 90행 이상이 필요합니다. 권장: 최근 1년.');
 return {name:String(name).slice(0,60),currency,instrumentType:'MUTUALFUND',source:'사용자가 입력한 기준가 CSV · 출처 미검증',fetchedAt:new Date().toISOString(),candles};
}
