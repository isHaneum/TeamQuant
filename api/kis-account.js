import { fetchKisAccount } from "../lib/kis.js";
import {readPrivateAccount} from '../lib/private-account.js';

export default async function handler(request,response){
  response.setHeader("Cache-Control","private, no-store");
  const result=await readPrivateAccount(request,{readAccount:fetchKisAccount});
  if(result.status===405)response.setHeader('Allow','GET');
  return response.status(result.status).json(result.body);
}
