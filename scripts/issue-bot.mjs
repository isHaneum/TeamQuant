// 실시간 이슈 봇 실행기: 수집 → 사건 묶기 → 심각도 → 알림·브리핑 → 사건 기록.
// 사용: node scripts/issue-bot.mjs --mode watch|briefing [--data .issue-data] [--news-base https://teamquant.vercel.app] [--now ISO시각] [--dry]
// 개인 자료(보유 종목·금액)는 쓰지 않는다. 공개 뉴스 제목·요약·링크와 공개 시세만 다룬다.
// 텔레그램: 환경 변수 TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID가 있을 때만 보낸다.
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fetchMarketSeries } from '../lib/market.js';
import { fetchNews } from '../lib/news.js';
import { fetchQuote } from '../lib/quote-check.js';
import { TOPICS, CONTEXT_QUERIES, MARKETS, ISSUE_VERSION, marketMove, applyQuote, clusterArticles, topicRate, spikeZ, assess, dedupeUrgent, worthRecording, shouldAlert, matchKnown, composeBriefing, eventRecord, kstDate } from '../lib/issue-bot.js';

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const mode = arg('mode', 'watch'), dir = resolve(arg('data', '.issue-data')), base = arg('news-base', process.env.NEWS_BASE || 'https://teamquant.vercel.app');
const now = arg('now') ? Date.parse(arg('now')) : Date.now(), dry = process.argv.includes('--dry');
if (!['watch', 'briefing'].includes(mode)) throw new Error('--mode는 watch 또는 briefing');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJson = (f, d) => { try { return JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { return d; } };
const write = (f, v) => { if (dry) return; const p = join(dir, f); mkdirSync(resolve(p, '..'), { recursive: true }); writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v, null, 1)); };
const log = [];

// 1. 시장
const moves = [];
for (const [symbol, label, unit] of MARKETS) {
  try { moves.push(marketMove(symbol, label, unit, (await fetchMarketSeries(symbol, '3mo')).candles)); }
  catch (e) { moves.push({ symbol, label, unit, available: false }); log.push(`시세 실패 ${symbol}: ${e.message}`); }
}

// 1-1. 현재가 교차 확인(네이버). 한국 지수는 한국 날짜, 미국 지수는 뉴욕 날짜로 비교한다.
for (let k = 0; k < moves.length; k++) {
  const m = moves[k]; if (!['^KS11', '^KQ11', '^GSPC', '^IXIC', '^VIX'].includes(m.symbol)) continue;
  try { const q = await fetchQuote(m.symbol), at = Date.parse(q.at), day = new Date(at + (m.symbol.startsWith('^K') ? 9 : -5) * 3600000).toISOString().slice(0, 10); moves[k] = applyQuote(m, q, day); }
  catch (e) { log.push(`현재가 확인 실패 ${m.symbol}: ${e.message}`); }
}

// 2. 기사: 네이버 키가 있으면 직접, 없으면 배포된 공개 검색 경로를 쓴다.
const direct = !!(process.env.NAVER_API_HUB_CLIENT_ID || process.env.NAVER_CLIENT_ID);
async function news(query) {
  if (direct) return (await fetchNews(query, 'date')).items;
  const r = await fetch(`${base}/api/news?query=${encodeURIComponent(query)}&sort=date`, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'TeamQuantIssueBot/1.0' } });
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d.items || [];
}
const state = readJson('state.json', { version: ISSUE_VERSION, history: {}, known: [], alertLog: [], runs: 0 });
const all = [], spikes = {}, rates = {};
let failures = 0;
for (const t of TOPICS) {
  const byQuery = [];
  for (const q of t.queries) { try { byQuery.push(await news(q)); } catch (e) { failures++; log.push(`기사 실패 ${q}: ${e.message}`); } await sleep(200); }
  rates[t.id] = topicRate(byQuery, now);
  spikes[t.id] = spikeZ(rates[t.id], (state.history[t.id] || []).map(h => h.rate));
  all.push(...byQuery.flat());
}
for (const q of CONTEXT_QUERIES) { try { all.push(...await news(q)); } catch (e) { failures++; log.push(`기사 실패 ${q}: ${e.message}`); } await sleep(200); }
if (failures > TOPICS.length) throw new Error(`기사 수집 실패가 많아 중단합니다 (${failures}건). ${log.slice(-3).join(' / ')}`);

// 3. 사건 묶기·심각도·알림
const clusters = clusterArticles(all, { now }).filter(c => c.topics.length || c.critical.length);
const known = (state.known || []).filter(k => now - Date.parse(k.lastSeen || k.firstSeen) < 48 * 3600000);
const issues = [], alerts = [], newEvents = [];
const assessed = dedupeUrgent(clusters.map(c => ({ ...c, assess: assess(c, { spikes, moves, now }) })));
for (const issue of assessed) {
  const c = issue, a = issue.assess, k = matchKnown(c, known);
  if (k) { issue.id = k.id; issue.firstSeen = k.firstSeen < c.firstSeen ? k.firstSeen : c.firstSeen; }
  const rec = k || { id: issue.id, title: c.title, firstSeen: issue.firstSeen };
  if (shouldAlert(rec, a, now)) { rec.alertedAt = new Date(now).toISOString(); rec.alertedLevel = a.level; alerts.push(issue); }
  const rank = { watch: 0, caution: 1, urgent: 2 };
  if (worthRecording(issue) && (!k || !k.recorded || rank[a.level] > rank[k.level || 'watch'])) { newEvents.push(eventRecord(issue, moves, now)); rec.recorded = true; }
  rec.lastSeen = c.lastSeen; rec.level = k && rank[k.level] > rank[a.level] ? k.level : a.level;
  if (!k) known.push(rec);
  issues.push(issue);
}
issues.sort((x, y) => y.assess.score - x.assess.score || y.count - x.count);

// 4. 전달(선택)
async function telegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat || dry) return false;
  try { const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text: text.slice(0, 3900), disable_web_page_preview: true }), signal: AbortSignal.timeout(10000) }); return r.ok; }
  catch { return false; }
}
for (const i of alerts) {
  const text = `[${i.assess.label}] ${i.title}\n${i.assess.why.join(' · ')}\n${i.sources}곳 보도 · 처음 ${new Date(i.firstSeen).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}\n${i.links[0]?.link || ''}\n원인을 단정하지 않으며 매수·매도 권유가 아닙니다.`;
  i.delivered = await telegram(text);
}

// 5. 저장
const stamp = new Date(now).toISOString();
for (const t of TOPICS) state.history[t.id] = [...(state.history[t.id] || []), { at: stamp, rate: rates[t.id].rate }].filter(h => now - Date.parse(h.at) < 7 * 86400000).slice(-600);
state.known = known.slice(-400);
state.alertLog = [...alerts.map(i => ({ at: stamp, id: i.id, level: i.assess.level, title: i.title, why: i.assess.why, link: i.links[0]?.link || null, delivered: !!i.delivered })), ...(state.alertLog || [])].filter(x => now - Date.parse(x.at) < 3 * 86400000).slice(0, 100);
state.runs = (state.runs || 0) + 1; state.version = ISSUE_VERSION; state.lastRun = stamp;
if (newEvents.length && !dry) { mkdirSync(join(dir, 'events'), { recursive: true }); appendFileSync(join(dir, 'events', `${kstDate(now).slice(0, 7)}.jsonl`), newEvents.map(e => JSON.stringify(e)).join('\n') + '\n'); }

const latest = readJson('latest.json', {});
let briefing = latest.briefing || null;
if (mode === 'briefing') {
  briefing = composeBriefing({ now, moves, issues });
  briefing.delivered = await telegram(briefing.text);
  write(`briefings/${briefing.id}.json`, briefing);
  const index = readJson('briefings/index.json', []);
  write('briefings/index.json', [{ id: briefing.id, title: briefing.title, at: briefing.at, headline: briefing.headline }, ...index.filter(x => x.id !== briefing.id)].slice(0, 60));
}
const slim = i => ({ id: i.id, title: i.title, firstSeen: i.firstSeen, lastSeen: i.lastSeen, count: i.count, sources: i.sources, topics: i.topics, critical: i.critical, links: i.links, assess: i.assess });
write('latest.json', {
  version: ISSUE_VERSION, updatedAt: stamp, mode, newsSource: direct ? '네이버 뉴스 검색(직접)' : '네이버 뉴스 검색(배포 서버 경유)',
  markets: moves, spikes, rates, issues: issues.slice(0, 15).map(slim), alerts: state.alertLog.slice(0, 20), briefing, problems: log.slice(0, 10)
});
write('state.json', state);
if (!existsSync(join(dir, 'vercel.json')) && !dry) write('vercel.json', { git: { deploymentEnabled: false } });
console.log(`${mode} ${stamp} · 시세 ${moves.filter(m => m.available).length}/${moves.length} · 기사 ${all.length}건 · 사건 ${issues.length}개 · 알림 ${alerts.length} · 새 기록 ${newEvents.length}${log.length ? ` · 문제 ${log.length}건` : ''}`);
for (const i of issues.slice(0, 6)) console.log(`  [${i.assess.label} ${i.assess.score}] ${i.title} (${i.count}건/${i.sources}곳) ${i.assess.why.join(', ')}`);
if (mode === 'briefing') console.log('\n' + briefing.text);
