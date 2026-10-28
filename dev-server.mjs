import { fetchNews } from "./lib/news.js";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchMarketSeries } from "./lib/market.js";
import { fetchKisAccount } from "./lib/kis.js";

const root = fileURLToPath(new URL(".", import.meta.url));
for (const file of [".env", ".env.local"]) {
  try { process.loadEnvFile(join(root, file)); } catch (error) { if (error.code !== "ENOENT") throw error; }
}
const port = Number(process.env.PORT || 8766);
const types = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".json":"application/json; charset=utf-8" };

http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
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
      const data = await fetchKisAccount();
      response.writeHead(200, { "Content-Type":"application/json; charset=utf-8", "Cache-Control":"private, no-store" });
      return response.end(JSON.stringify(data));
    }
    const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (!/^(?:index\.html|styles\.css|app\.js|news-ui\.js|lib\/(?:backtest|natural-language)\.js)$/.test(requested)) { response.writeHead(404); return response.end(); }
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
