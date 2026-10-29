import {searchStocks} from '../lib/stocks.js';
export default async function handler(req,res){
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'GET 요청만 지원합니다.'});}
  try{return res.status(200).json(await searchStocks(req.query.q,req.query.code));}catch{return res.status(502).json({error:'종목 정보를 확인하지 못했습니다. 잠시 후 다시 선택하세요.'});}
}
