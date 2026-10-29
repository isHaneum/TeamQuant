import {createLocalBridge} from './lib/local-bridge.js';
import {allowLocalToss,fetchTossHoldings} from './lib/toss.js';
import {privateAccountStatus,readPrivateAccount} from './lib/private-account.js';
import {searchStocks} from "./lib/stocks.js";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchMarketSeries } from "./lib/market.js";
import { fetchNews } from "./lib/news.js";
import { fetchKisAccount } from "./lib/kis.js";


const root = fileURLToPath(new URL(".", import.meta.url));
for (const file of [".env", ".env.local"]) {
  try { process.loadEnvFile(join(root, file)); } catch (error) { if (error.code !== "ENOENT") throw error; }
}
const port = Number(process.env.PORT || 8766);
const types = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".json":"application/json; charset=utf-8" };

const bridge=createLocalBridge({port,readHoldings:fetchTossHoldings,readMarket:async(symbol,range)=>{const resolved=/^\d[\dA-Z]{5}$/.test(symbol)?(await searchStocks('',symbol)).symbol:symbol.replace(/\.(?!KS$|KQ$)/g,'-');return fetchMarketSeries(resolved,range);},readNews:fetchNews});
http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if(url.pathname.startsWith('/api/bridge/')){
      let size=0,raw='',body={};
      for await(const chunk of request){size+=chunk.length;if(size>4096){response.writeHead(413);return response.end();}raw+=chunk;}
      try{if(raw)body=JSON.parse(raw);}catch{response.writeHead(400);return response.end();}
      const result=await bridge.handle(request,url.pathname.split('/').at(-1),body);
      response.writeHead(result.status,result.headers);return response.end(result.body?JSON.stringify(result.body):'');
    }
    if(url.pathname==='/api/toss-account'){
      response.setHeader('Content-Type','application/json; charset=utf-8');response.setHeader('Cache-Control','private, no-store');
      if(!allowLocalToss(request,port)){response.writeHead(403);return response.end(JSON.stringify({error:'본인 PC의 TeamQuant 화면에서만 조회할 수 있습니다.'}));}
      try{const data=await fetchTossHoldings();return response.end(JSON.stringify(data));}catch(error){response.writeHead(error.status||502);return response.end(JSON.stringify({error:error.message,code:error.code||'upstream_failed'}));}
    }
    if (url.pathname === '/api/account-connect') {
      response.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      return response.end(JSON.stringify(privateAccountStatus()));
    }
    if (url.pathname === '/api/stocks') {
      if(request.method!=='GET'){response.writeHead(405);return response.end();}
      const data=await searchStocks(url.searchParams.get('q'),url.searchParams.get('code'));
      response.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});return response.end(JSON.stringify(data));
    }
    if (url.pathname === '/api/news') {
      if (request.method !== 'GET') { response.writeHead(405, {'Allow':'GET'}); return response.end(); }
      const data = await fetchNews(url.searchParams.get('query'), url.searchParams.get('sort') || 'date');
      response.writeHead(200, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'private, no-store'});
      return response.end(JSON.stringify(data));
    }
    if (url.pathname === "/api/market") {
      const data = await fetchMarketSeries(url.searchParams.get("symbol") || "005930.KS", url.searchParams.get("range") || "1y");
      response.writeHead(200, { "Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store" });
      return response.end(JSON.stringify(data));
    }
    if (url.pathname === "/api/kis-account") {
      const result = await readPrivateAccount(request,{readAccount:fetchKisAccount});
      const data=result.body;
      response.writeHead(result.status, { "Content-Type":"application/json; charset=utf-8", "Cache-Control":"private, no-store" });
      return response.end(JSON.stringify(data));
    }
    const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    // Only public application assets. Never expose .env, model files or SQLite journals.
    if(!/^(?:index\.html|styles\.css|overview\.css|overview-ui\.js|account-ui\.js|toss-ui\.js|bridge-client\.js|asset-hub-ui\.js|app\.js|ml-ui\.js|news-ui\.js|journey-ui\.js|flow-ui\.js|lib\/(?:backtest|natural-language|instruments|comparison|portfolio|briefing|asset-workspace)\.js|data\/(?:ml-report|stock-names)\.json)$/.test(requested)){
      response.writeHead(404);return response.end();
    }
    const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
    const filePath = join(root, safePath);
    const content = await readFile(filePath);
    response.writeHead(200, { "Content-Type": types[extname(filePath)] || "application/octet-stream" });
    response.end(content);
  } catch (error) {
    const status = error.status || (error.code === "ENOENT" ? 404 : 400);
    response.writeHead(status, { "Content-Type":"application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: error.message }));
  }
}).listen(port, "127.0.0.1", () => console.log(`Team Quant simulator: http://127.0.0.1:${port}`));
