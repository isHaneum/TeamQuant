import {privateAccountStatus} from '../lib/private-account.js';
export default function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'GET 요청만 지원합니다.'});}
  return res.status(200).json(privateAccountStatus());
}
