import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('.',import.meta.url);
for(const name of ['.env','.env.local'])try{process.loadEnvFile(fileURLToPath(new URL(name,root)));}catch(e){if(e.code!=='ENOENT')throw e;}
const endpoints=new Set(['market','news','stocks','kis-account','account-connect']);
const publicPath=/^(?:index\.html|(?:app|flow-ui|journey-ui|news-ui|overview-ui|account-ui)\.js|(?:styles|overview)\.css|data\/(?:stock-names)\.json|lib\/(?:backtest|natural-language|instruments|comparison|portfolio|briefing)\.js)$/;
http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');res.status=n=>{res.statusCode=n;return res;};res.json=obj=>{res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(obj));};const endpoint=url.pathname.match(/^\/api\/([a-z-]+)$/)?.[1];if(endpoints.has(endpoint)){req.query=Object.fromEntries(url.searchParams);return await (await import('./api/'+endpoint+'.js')).default(req,res);}const name=url.pathname==='/'?'index.html':url.pathname.slice(1);if(!publicPath.test(name)){res.statusCode=404;return res.end();}const data=await readFile(new URL(name,root));res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript; charset=utf-8':name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':'text/html; charset=utf-8');res.end(data);}catch{res.statusCode=500;res.end('Request failed');}}).listen(Number(process.env.PORT||8768),'127.0.0.1');
