// 내 가상계좌(결정 62 · 2026-11-24): 증권사 계좌 없이 누구나 이 브라우저에 자기 계좌를 만든다.
// 팀 모의계좌와 같은 계획·규칙 계산으로 점검하고, 체결만 가상(장중 현재가 · 장 밖이면 다음 장 시가). 기록은 이 브라우저(localStorage)에만 — 파일로 저장·불러오기로 옮긴다.
// 화면이 열려 있는 동안 30초마다(장이 닫혀 있으면 5분마다) 시세를 다시 읽어 예약 주문을 체결하고 평가한다. 화면을 닫아 둔 동안 열린 장의 주문은 다음에 열 때 그 장 시가로 맞춰진다.
// 2026-11-26: '지금 점검'은 먼저 살 것·팔 것과 이유를 보여 주고(decide 만 · 주문 없음), '주문하기'를 눌러야 주문한다. 만들기 전에는 따를 계획의 종목·비중을 보여 준다.
import { createAccount, place, processQueue, valuation, decide, checkDue, recordCheck, planFromDoc, validateAccount, mark, quoteUsable, sessionState, marketOf, COSTS, VA_VERSION } from '/lib/virtual-account.js';
import { normalizeRules } from '/lib/core-rules.js';
import { candles as fetchCandles, getJson } from '/lib/client-data.js';
import { tip } from '/tooltip-ui.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = v => (Number.isFinite(v) ? `${Math.round(v).toLocaleString('ko-KR')}원` : '—');
const swon = v => (Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.round(Math.abs(v)).toLocaleString('ko-KR')}원` : '—');
const pctS = v => (Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%` : '—');
const tone = v => (v > 0 ? 'up' : v < 0 ? 'down' : '');
const px = (v, usd) => (Number.isFinite(v) ? (usd ? '$' + v.toFixed(2) : Math.round(v).toLocaleString('ko-KR') + '원') : '—');
// 시각은 한국 시간으로 쓴다(주문 시각은 UTC로 저장된다). 올해 날짜는 MM-DD.
const kstIso = t => new Date(t + 9 * 3600e3).toISOString();
const kstDay = (t = Date.now()) => kstIso(t).slice(0, 10);
const md = d => { const s = String(d || '').slice(0, 10); return s.slice(0, 4) === kstDay().slice(0, 4) ? s.slice(5) : s; };
const hm = iso => { const t = Date.parse(iso); return Number.isFinite(t) ? kstIso(t).slice(11, 16) : '—'; };
const mdhm = iso => { const t = Date.parse(iso); return Number.isFinite(t) ? `${md(kstIso(t))} ${kstIso(t).slice(11, 16)}` : '—'; };
// 이 브라우저에 전에 저장된 계좌의 이유·체결 방식 글(옛 말)을 지금 쓰는 말로 읽는다. 저장된 값은 바꾸지 않는다.
const OLD_TERMS = [[/계획 비중보다/g, '목표 비중보다'], [/대기 뒤/g, '예약 뒤'], [/다음 세션/g, '다음 장'], [/정규장 밖|장 마감 표시/g, '장 마감'], [/현재가 없음/g, '시세 없음'], [/첫 운용/g, '처음 시작'], [/직접 점검/g, '지금 점검']];
const fix = v => OLD_TERMS.reduce((t, [re, to]) => t.replace(re, to), String(v ?? ''));
const session = () => { try { return sessionStorage.getItem('teamQuantSession') || 'guest'; } catch { return 'guest'; } };
const KEY = () => `teamQuantVA:${session()}`;
const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY()) || 'null'); return v ? validateAccount(v) : null; } catch { return null; } };
const save = a => { try { if (a) localStorage.setItem(KEY(), JSON.stringify(a)); else localStorage.removeItem(KEY()); return true; } catch { return false; } };
const savedPlan = () => { try { const v = JSON.parse(localStorage.getItem(`teamQuantRules:${session()}`) || 'null'); return v?.plan && Object.keys(v.plan).length ? v.plan : null; } catch { return null; } };
const savedRules = () => { try { const v = JSON.parse(localStorage.getItem(`teamQuantRules:${session()}`) || 'null'); return normalizeRules(v?.rules || {}).rules; } catch { return normalizeRules({}).rules; } };

const PREVIEW_MS = 5 * 60e3; // 미리보기를 이보다 오래 두었다가 '주문하기'를 누르면 다시 점검한다(그사이 시세가 바뀌므로)
const V = { acc: null, plan: null, planLabel: '', quotes: {}, quotesAt: null, fx: null, fxAt: 0, bars: {}, barsAt: 0, busy: false, queued: null, timer: null, note: '', armed: null, err: '', preview: null, menuOpen: false, draft: null, draftCap: 10_000_000 };

/** 따를 계획: 'mine'(규칙 화면에 저장한 내 계획) 또는 팀 기본 계획(data/paper-plan.json). acc 또는 'team'·'mine'. */
async function planNow(accOrSource) {
  const source = typeof accOrSource === 'string' ? accOrSource : accOrSource?.planSource;
  if (source === 'mine') { const p = savedPlan(); if (p) { const out = {}; for (const [k, v] of Object.entries(p)) { const pct = typeof v === 'number' ? v : Number(v?.pct); if (pct > 0) out[k] = { pct, name: v?.name || k, currency: v?.currency || (marketOf(k) === 'US' ? 'USD' : 'KRW') }; } return { plan: out, label: '내 계획 (규칙 화면)' }; } }
  const doc = await getJson('/data/paper-plan.json').catch(() => null);
  return { plan: planFromDoc(doc), label: doc?.asOf ? `팀 기본 계획 (${md(doc.asOf)} 기준)` : '팀 기본 계획' };
}
const symbolsOf = acc => [...new Set([...Object.keys(V.plan || {}), ...Object.keys(acc.positions), ...acc.orders.filter(o => o.status === 'queued').map(o => o.symbol)])].sort().slice(0, 20); // 정렬: 같은 종목 목록이면 같은 주소 → 공유 캐시(결정 63)
async function readQuotes(acc) { const s = symbolsOf(acc); if (!s.length) return; const r = await getJson(`/api/quote?symbols=${encodeURIComponent(s.join(','))}`); V.quotes = Object.fromEntries(Object.entries(r.quotes || {}).filter(([, q]) => q && !q.error)); V.quotesAt = r.at || new Date().toISOString(); }
async function readFx(force = false) { if (!force && V.fx && Date.now() - V.fxAt < 300_000) return; try { const d = await getJson(`/api/market?symbol=${encodeURIComponent('KRW=X')}&range=3mo&t=${Math.floor(Date.now() / 300_000)}`); const c = (d.candles || []).filter(x => x.close > 0); if (c.length) { V.fx = c.at(-1).close; V.fxAt = Date.now(); V.fxCandles = c; } } catch { } }
/** 예약 주문 체결용 일봉(최근 3개월 · 5분마다 새로). 캐시된 2년 일봉은 오늘 봉이 낡을 수 있어 따로 읽는다. */
async function readBars(acc) {
  const q = [...new Set(acc.orders.filter(o => o.status === 'queued').map(o => o.symbol))]; if (!q.length || Date.now() - V.barsAt < 300_000) return;
  const slot = Math.floor(Date.now() / 300_000);
  await Promise.all(q.map(async s => { try { const sym = marketOf(s) === 'KR' ? s + '.KS' : s.replace(/\./g, '-'); let d = await getJson(`/api/market?symbol=${encodeURIComponent(sym)}&range=3mo&t=${slot}`).catch(() => null); if (marketOf(s) === 'KR' && !(d?.candles?.length)) d = await getJson(`/api/market?symbol=${encodeURIComponent(s + '.KQ')}&range=3mo&t=${slot}`).catch(() => null); V.bars[s] = (d?.candles || []).filter(c => c.open > 0 || c.close > 0); } catch { } }));
  V.barsAt = Date.now();
}
const priceMap = acc => { const out = {}; for (const s of symbolsOf(acc)) { const q = V.quotes[s]; if (q?.price > 0) out[s] = q.price; else if (V.bars[s]?.length) out[s] = V.bars[s].at(-1).close; } return out; };
/** 규칙 점검(계좌를 바꾸지 않음): 2년 일봉으로 변동성·손실 범위를 계산해 살 것·팔 것·막힌 것을 정한다. */
async function decideNow(acc, now) {
  const syms = [...new Set([...Object.keys(V.plan), ...Object.keys(acc.positions)])], cs = {};
  await Promise.all(syms.map(async s => { try { cs[s] = (await fetchCandles(s, marketOf(s) === 'US' ? 'USD' : 'KRW', '2y')).candles; } catch { } }));
  const fxc = await fetchCandles('KRW=X', 'USD', '2y').then(d => d.candles).catch(() => V.fxCandles || []);
  return decide(acc, { plan: V.plan, rules: savedRules(), candlesBySymbol: cs, fxCandles: fxc, prices: priceMap(acc), fx: V.fx, now });
}
const placedNote = (why, d, placed) => { const filled = placed.filter(o => o.status === 'filled').length, queued = placed.filter(o => o.status === 'queued').length, failed = placed.length - filled - queued; return `${fix(why)}: 주문 ${placed.length}건 (체결 ${filled} · 예약 ${queued}${failed ? ` · 못 함 ${failed}` : ''})${d.blocked.length ? ` · 막힘 ${d.blocked.length}건` : ''}${d.missing.length ? ` · 시세 없어 뺌 ${d.missing.length}` : ''}`; };

/** 한 바퀴: 시세 → 예약 주문 체결 → (때가 되면) 점검·주문 → 평가·하루 기록 → 저장 · 그리기.
 *  preview: 점검만 하고 결과를 보여 준다(주문 없음) · placePreview: 보여 준 미리보기대로 주문한다(5분이 지났으면 다시 점검만). */
async function tick({ preview = false, placePreview = false } = {}) {
  const acc = V.acc; if (!acc) return;
  if (V.busy) { if (preview || placePreview) V.queued = { preview, placePreview }; return; }
  V.busy = true; V.err = '';
  try {
    if (!V.plan) { const p = await planNow(acc); V.plan = p.plan; V.planLabel = p.label; }
    await Promise.all([readQuotes(acc).catch(e => { V.err = `시세: ${e.message}`; }), readFx(), readBars(acc)]);
    const now = Date.now();
    const filled = processQueue(acc, { candles: V.bars, fxCandles: V.fxCandles || [], quotes: V.quotes, fx: V.fx, now });
    const due = checkDue(acc, now);
    if (placePreview && V.preview) {
      if (now - V.preview.at > PREVIEW_MS) { V.note = '규칙 점검 중…'; render(); V.preview = { at: now, d: await decideNow(acc, now) }; V.note = '점검한 지 5분이 지나 다시 점검했습니다. 내용을 확인하고 다시 눌러 주세요.'; }
      else { const d = V.preview.d; V.preview = null; const c = recordCheck(acc, { now, why: '지금 점검', orders: d.orders, blocked: d.blocked, evaluation: d.evaluation }); const placed = place(acc, d.orders, { quotes: V.quotes, fx: V.fx, now, checkId: c.id }); V.note = placedNote('지금 점검', d, placed); V.lastBlocked = d.blocked; }
    } else if (preview) {
      V.note = '규칙 점검 중…'; render();
      V.preview = { at: now, d: await decideNow(acc, now) }; V.note = '';
    } else if (due.due) {
      V.note = '규칙 점검 중…'; render();
      const d = await decideNow(acc, now);
      const c = recordCheck(acc, { now, why: due.why, orders: d.orders, blocked: d.blocked, evaluation: d.evaluation });
      const placed = place(acc, d.orders, { quotes: V.quotes, fx: V.fx, now, checkId: c.id });
      V.note = placedNote(due.why, d, placed); V.lastBlocked = d.blocked; V.preview = null;
    } else if (filled.length) V.note = `예약 주문 ${filled.length}건 체결`;
    const v = valuation(acc, { prices: priceMap(acc), fx: V.fx }); if (v.complete && (!Object.keys(acc.positions).some(s => marketOf(s) === 'US') || V.fx)) mark(acc, v.totalKrw, now);
    if (!save(acc)) V.err = '이 브라우저에 저장하지 못했습니다(저장 공간·비공개 창).';
  } catch (e) { V.err = e.message || String(e); }
  finally { V.busy = false; render(); schedule(); const q = V.queued; V.queued = null; if (q) void tick(q); }
}
function schedule() {
  clearTimeout(V.timer); if (!V.acc) return;
  if (document.visibilityState !== 'visible') return; // 숨은 탭은 멈춤 · 보이면 visibilitychange 가 다시 부른다(결정 63)
  const open = ['KR', 'US'].some(m => sessionState(new Date(), m).open), ms = open ? 30_000 : 300_000;
  V.timer = setTimeout(() => tick(), ms);
}

const bpPct = bp => `${+(bp / 100).toFixed(2)}%`, pc = v => `${+(v * 100).toFixed(4)}%`;
const costTip = () => tip(`가상 체결입니다. 장중에는 지금 시세(네이버 증권 · 시각 표시)보다 조금 불리하게(국내 주식 ${bpPct(COSTS.KR.halfSpreadBp.stock + COSTS.impactBp)} · 국내 ETF ${bpPct(COSTS.KR.halfSpreadBp.etf + COSTS.impactBp)} · 미국 주식 ${bpPct(COSTS.US.halfSpreadBp.stock + COSTS.impactBp)} · 미국 ETF ${bpPct(COSTS.US.halfSpreadBp.etf + COSTS.impactBp)}) 호가 단위·1주 단위로 체결합니다. 장이 닫혀 있거나 시세가 ${COSTS.quoteMaxAgeSec / 60}분보다 오래되면 예약 주문으로 두었다가 다음 장 시가에 체결합니다. 수수료 국내 ${pc(COSTS.KR.commission)} · 미국 ${pc(COSTS.US.commission)}, 국내 주식 팔 때 거래세 ${pc(COSTS.KR.sellTax.stock)}(ETF 없음), 미국 팔 때 SEC 수수료가 붙고, 달러 종목은 원화를 자동 환전합니다(환율 ±${pc(COSTS.fxSpread)}). 호가 잔량·급변·휴장일 때문에 실제 체결과 다를 수 있습니다.`, '가상 체결 방식');

// 보유표: 팀 모의계좌 표와 같은 8칸(종목·수량·평균단가·현재가·평가액·손익·수익률·비중(목표)). 종목 칸에 오늘 등락(받아 둔 시세의 전날 종가 대비)을 붙인다.
function holdingsHtml(v) {
  if (!v.rows.length) return '<p class="cr-muted">아직 산 종목이 없습니다. 첫 점검 때 목표 비중만큼 주문합니다.</p>';
  const plan = V.plan || {}, now = Date.now(), rows = v.rows.slice().sort((a, b) => (b.valueKrw || 0) - (a.valueKrw || 0));
  const sumV = rows.reduce((a, r) => a + (r.valueKrw || 0), 0), sumC = rows.reduce((a, r) => a + (r.costKrw || 0), 0), sumP = rows.reduce((a, r) => a + (r.pnlKrw || 0), 0);
  return `<h4 class="pp-h4">보유 ${rows.length}종목 ${tip("평균단가와 손익은 원화입니다(달러 종목은 환전 비용 포함). 수익률은 손익 ÷ 산 금액입니다. '오늘'은 받아 둔 시세의 전날 종가 대비 등락입니다. 비중은 총자산 대비이고 괄호 안은 목표 비중입니다.")}</h4><div class="pp-scroll"><table class="pp-hold"><thead><tr><th>종목</th><th>수량</th><th>평균단가</th><th>현재가</th><th>평가액</th><th>손익</th><th>수익률</th><th>비중(목표)</th></tr></thead><tbody>${rows.map(r => {
    const usd = r.currency === 'USD', q = V.quotes[r.symbol], live = q && quoteUsable(q, now, marketOf(r.symbol)).ok, day = q && q.pct !== null && q.pct !== undefined ? Number(q.pct) : NaN;
    const ret = r.costKrw > 0 && Number.isFinite(r.pnlKrw) ? r.pnlKrw / r.costKrw * 100 : null, goal = Number(plan[r.symbol]?.pct);
    return `<tr><td>${esc(r.name)} <small class="cr-muted">${esc(r.symbol)}</small>${Number.isFinite(day) ? `<span class="pp-day ${tone(day)}">오늘 ${pctS(day)}</span>` : ''}</td><td>${r.qty.toLocaleString('ko-KR')}</td><td>${won(r.costKrw / r.qty)}</td><td>${px(r.price, usd)}${live ? '' : ' <span class="cr-muted">(마지막 값)</span>'}</td><td>${won(r.valueKrw)}</td><td class="${tone(r.pnlKrw)}">${swon(r.pnlKrw)}</td><td class="${tone(ret)}">${pctS(ret)}</td><td>${Number.isFinite(r.weightPct) ? r.weightPct.toFixed(1) + '%' : '—'} <small class="cr-muted">(${Number.isFinite(goal) && goal > 0 ? goal.toFixed(1) + '%' : '계획 밖'})</small></td></tr>`;
  }).join('')}</tbody><tfoot><tr><td>합계</td><td></td><td></td><td></td><td>${won(sumV)}</td><td class="${tone(sumP)}">${swon(sumP)}</td><td class="${tone(sumP)}">${sumC > 0 ? pctS(sumP / sumC * 100) : '—'}</td><td>${v.totalKrw > 0 ? (sumV / v.totalKrw * 100).toFixed(1) + '%' : '—'}</td></tr></tfoot></table></div>`;
}
function ordersHtml(acc) {
  const q = acc.orders.filter(o => o.status === 'queued'), recent = acc.orders.filter(o => o.status !== 'queued').slice(-15).reverse(), STATUS = { unfilled: '체결 안 됨', cancelled: '취소' };
  const row = o => `<tr class="${o.status === 'filled' ? '체결' : '차단'}"><td>${esc(mdhm(o.fill?.at || o.at))}</td><td>${o.side === 'SELL' ? '매도' : '매수'}</td><td>${esc(o.name)} ${o.fill ? `${Number(o.fill.qty)}주 @${px(o.fill.price, o.market === 'US')} · ${esc(fix(o.fill.source))} · 비용 ${won((o.fill.feeKrw || 0) + (o.fill.taxKrw || 0))}${o.fill.realizedKrw !== undefined ? ` · 실현 ${swon(o.fill.realizedKrw)}` : ''}${o.fill.note ? ` · ${esc(o.fill.note)}` : ''}` : `${Number(o.qty)}주 · ${esc(fix(o.reason) || STATUS[o.status] || o.status)}`}<br><small class="cr-muted">${esc(fix(o.why))}</small></td></tr>`;
  return `${q.length ? `<h4>예약 주문 ${q.length}건 ${tip('장이 닫혀 있거나 시세가 오래돼 바로 체결하지 못한 예약 주문입니다. 그 시장의 다음 장 시가에 체결합니다.')}</h4><ul class="pp-kis-items">${q.map(o => `<li>${o.side === 'SELL' ? '매도' : '매수'} ${esc(o.name)} ${Number(o.qty)}주 <small>${esc(fix(o.waitWhy || ''))} · ${esc(fix(o.why))}</small></li>`).join('')}</ul>` : ''}
  ${recent.length ? `<h4>최근 주문</h4><div class="pp-scroll"><table class="pp-journal"><tbody>${recent.map(row).join('')}</tbody></table></div>` : ''}`;
}
/** '지금 점검'의 결과: 지금 주문하면 무엇을 사고팔지와 이유(아직 주문하지 않음). */
function previewHtml(acc) {
  const p = V.preview; if (!p) return '';
  const d = p.d, e = d.evaluation, prices = priceMap(acc), n = d.orders.length, old = Date.now() - p.at > PREVIEW_MS;
  const est = o => { const pr = prices[o.symbol]; return pr > 0 ? o.qty * pr * (marketOf(o.symbol) === 'US' ? (V.fx || 0) : 1) : null; };
  const items = [...d.orders.map(o => `<li class="ok"><span class="st">${o.side === 'SELL' ? '매도' : '매수'}</span> · ${esc(o.name)} ${o.qty.toLocaleString('ko-KR')}주${est(o) > 0 ? ` · 약 ${won(est(o))}` : ''}<small>${esc(fix(o.why))}</small></li>`), ...d.blocked.map(b => `<li class="bad"><span class="st">막힘</span> · ${b.side === 'SELL' ? '매도' : '매수'} ${esc(b.name)} ${won(b.amountKrw)}<small>${esc(fix(b.why))}</small></li>`)];
  return `<div class="pp-preview" id="va-preview"><h4>지금 주문하면 ${tip("지금 시세로 규칙을 점검한 결과입니다. '주문하기'를 눌러야 사고팝니다. 점검한 지 5분이 지나면 누를 때 다시 점검합니다.")}</h4>
  <p class="pp-kis-note">${esc(hm(new Date(p.at).toISOString()))} 점검 · 규칙 ${e.known}개 중 ${e.okCount}개 지킴 · 주문 ${n}건${d.blocked.length ? ` · 막힘 ${d.blocked.length}건` : ''}${d.missing.length ? ` · 시세 없어 뺌 ${d.missing.length}` : ''}${old ? ' · 5분 지남(누르면 다시 점검)' : ''}</p>
  ${items.length ? `<ul class="pp-kis-items">${items.join('')}</ul>` : '<p class="cr-muted">지금 낼 주문이 없습니다.</p>'}
  <div class="cr-actions">${n ? `<button class="primary" id="va-place">주문하기 (${n}건)</button>` : ''}<button class="secondary" id="va-cancel">${n ? '취소' : '닫기'}</button></div></div>`;
}
/** 만들기 전: 따를 계획의 종목·목표 비중(만들면 바로 이 비중대로 첫 주문이 나간다). */
async function loadDraft(source) {
  V.draft = { source, plan: null, label: '' };
  const p = await planNow(source).catch(() => ({ plan: {}, label: '계획을 불러오지 못했습니다' }));
  if (V.acc || V.draft?.source !== source) return;
  V.draft = { source, plan: p.plan || {}, label: p.label }; render();
}
function planListHtml() {
  const d = V.draft; if (!d?.plan) return '<p class="cr-muted">따를 계획을 불러오는 중…</p>';
  const items = Object.entries(d.plan).filter(([, x]) => x.pct > 0).sort((a, b) => b[1].pct - a[1].pct); if (!items.length) return `<p class="cr-muted">${esc(d.label)}: 종목이 없습니다.</p>`;
  const sum = items.reduce((a, [, x]) => a + x.pct, 0);
  return `<h4>${esc(d.label)} · ${items.length}종목 · 현금 ${Math.max(0, 100 - sum).toFixed(0)}% ${tip('만들면 바로 첫 점검을 해 이 목표 비중대로 삽니다. 규칙(한 종목 최대 비중·현금 최소 비중 등)에 걸리는 주문은 막힙니다.')}</h4><div class="pp-scroll"><table class="pp-ref"><thead><tr><th>종목</th><th>목표 비중</th><th>통화</th></tr></thead><tbody>${items.map(([k, x]) => `<tr><td>${esc(x.name || k)} <small class="cr-muted">${esc(k)}</small></td><td>${x.pct}%</td><td>${x.currency === 'USD' ? '달러' : '원화'}</td></tr>`).join('')}</tbody></table></div>`;
}
function render() { try { renderInner(); } catch (e) { const box = document.getElementById('pp-va'); if (!box) return; box.innerHTML = `<header><h3>내 가상계좌</h3></header><p class="cr-err">가상계좌를 불러오지 못했습니다(${esc(e.message)}). 저장된 기록이 손상됐을 수 있습니다.</p><div class="cr-actions"><button class="secondary" id="va-wipe">계좌 지우기</button></div>`; box.querySelector('#va-wipe').onclick = () => { clearTimeout(V.timer); V.acc = null; V.plan = null; V.preview = null; save(null); render(); }; } }
function renderInner() {
  const box = document.getElementById('pp-va'); if (!box) return; const acc = V.acc;
  if (!acc) {
    const mine = savedPlan(), src = V.draft?.source === 'mine' && mine ? 'mine' : 'team';
    if (!V.draft || V.draft.source !== src) void loadDraft(src);
    box.innerHTML = `<header><h3 class="pp-head">내 가상계좌 ${tip('증권사 계좌 없이 이 브라우저에 내 가상계좌를 만듭니다. 팀 모의계좌와 같은 규칙으로 주 1번(그 주 처음 열 때) 점검해 사고팔고, 가격은 실제 시세를 씁니다. 만들면 바로 첫 점검을 해 목표 비중대로 주문합니다. 기록은 이 브라우저에만 남습니다.', '내 가상계좌 설명')}</h3></header>
    <div class="pp-form"><label class="ck-field unit"><span>시작 자금</span><input id="va-cap" type="number" value="${Number(V.draftCap) || 10000000}" min="1000000" step="1000000" inputmode="numeric"><i>원</i></label>
    <label class="ck-field"><span>따를 계획</span><select id="va-plan"><option value="team"${src === 'team' ? ' selected' : ''}>팀 기본 계획 (팀 모의계좌와 같은 비중)</option><option value="mine"${mine ? '' : ' disabled'}${src === 'mine' ? ' selected' : ''}>내 계획${mine ? ' (규칙 화면)' : ' (규칙 화면에서 먼저 저장)'}</option></select></label></div>
    <div class="pp-va-plan" id="va-plan-list">${planListHtml()}</div>
    <div class="cr-actions"><button class="primary" id="va-create">가상계좌 만들기</button><button class="secondary" id="va-import">파일에서 불러오기</button><span class="cr-err" id="va-err">${esc(V.err)}</span></div>`;
    box.querySelector('#va-cap').addEventListener('input', e => { V.draftCap = Number(e.target.value); });
    box.querySelector('#va-plan').onchange = e => { void loadDraft(e.target.value === 'mine' ? 'mine' : 'team'); render(); };
    box.querySelector('#va-create').onclick = async () => { if (window.tqRequireConsent && !(await window.tqRequireConsent('내 가상계좌 만들기'))) return; try { V.acc = createAccount({ startKrw: Number(box.querySelector('#va-cap').value), planSource: box.querySelector('#va-plan').value }); V.plan = null; V.err = ''; save(V.acc); tick(); } catch (e) { V.err = e.message; render(); } };
    box.querySelector('#va-import').onclick = importFile; return;
  }
  const now = Date.now(), v = valuation(acc, { prices: priceMap(acc), fx: V.fx }), costs = acc.feesKrw + acc.taxKrw + acc.fxCostKrw + acc.slipKrw, last = acc.checks.at(-1), due = checkDue(acc, now);
  const pnl = v.totalKrw - acc.startKrw, prev = acc.marks.filter(m => m.date < kstDay(now)).at(-1), day = v.complete && prev?.totalKrw > 0 ? v.totalKrw - prev.totalKrw : null;
  const mk = m => { const s = sessionState(new Date(now), m); return `${m === 'KR' ? '국내' : '미국'} ${s.open ? '<b class="run">장중</b>' : '장 마감'}`; };
  const tiles = [
    `<div><span>원금 대비</span><b class="${tone(pnl)}">${swon(pnl)}</b><small class="${tone(v.retPct)}">${pctS(v.retPct)}</small><small>원금 ${won(acc.startKrw)} · ${esc(md(kstDay(Date.parse(acc.createdAt))))} 시작</small></div>`,
    day === null ? '' : `<div><span>전날 대비</span><b class="${tone(day)}">${swon(day)}</b><small class="${tone(day)}">${pctS(day / prev.totalKrw * 100)}</small><small>${esc(md(prev.date))} 기록과 비교</small></div>`,
    `<div><span>현금</span><b>${won(v.cashKrw)}</b><small>${v.totalKrw > 0 ? (v.cashKrw / v.totalKrw * 100).toFixed(1) + '%' : ''}</small></div>`,
    `<div><span>쓴 비용 ${tip('수수료·거래세·SEC 수수료·환전 비용에, 시세보다 불리하게 체결된 금액을 더한 값입니다.')}</span><b>${won(costs)}</b><small>수수료 ${won(acc.feesKrw)} · 세금 ${won(acc.taxKrw)}</small></div>`,
    `<div><span>다음 점검</span><b>${due.due ? '지금' : '다음 주에 처음 열 때'}</b><small>${last ? `마지막 ${esc(String(last.at).slice(5, 16).replace('T', ' '))}` : ''}</small></div>`
  ].filter(Boolean);
  box.innerHTML = `<header><h3 class="pp-head"><b>${esc(V.planLabel || '계획 읽는 중')}</b> · 이 브라우저 ${costTip()}</h3></header>
  <div class="pp-hero" style="--pp-n:${tiles.length}"><div><span>총자산</span><b>${won(v.totalKrw)}</b><small>${v.complete ? '' : '일부 종목 가격 없음'}</small></div>${tiles.join('')}</div>
  <p class="pp-kis-note">${mk('KR')} · ${mk('US')} · 시세 ${V.quotesAt ? esc(hm(V.quotesAt)) : '—'}${V.fx ? ` · 환율 ${V.fx.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}원` : ''}${V.busy ? ' · 새로고침 중…' : ''} ${tip('장중 30초 · 장 밖 5분마다 자동으로 새로고침합니다.')}</p>
  <p class="pp-va-status" role="status">${esc(fix(V.note))}</p>
  ${V.err ? `<p class="cr-err">${esc(V.err)}</p>` : ''}
  ${previewHtml(acc)}${holdingsHtml(v)}${ordersHtml(acc)}
  ${V.lastBlocked?.length ? `<details class="pp-kis-plan"><summary>이번 점검에서 막힌 주문 ${V.lastBlocked.length}건</summary><ul class="pp-kis-items">${V.lastBlocked.map(b => `<li class="bad">${b.side === 'SELL' ? '매도' : '매수'} ${esc(b.name)} ${won(b.amountKrw)} <small>${esc(fix(b.why))}</small></li>`).join('')}</ul></details>` : ''}
  <div class="cr-actions"><button class="primary" id="va-check"${V.busy ? ' disabled' : ''}>지금 점검</button>${tip("지금 시세로 규칙을 점검해 살 것·팔 것과 이유를 먼저 보여 줍니다. 그 아래 '주문하기'를 눌러야 주문합니다.")}<details class="pp-menu" id="va-menu"${V.menuOpen || V.armed === 'reset' ? ' open' : ''}><summary aria-label="더보기" title="더보기">⋯</summary><div class="pp-menu-list"><button type="button" class="text-button" id="va-export">파일로 저장</button><button type="button" class="text-button" id="va-import">파일에서 불러오기 (지금 계좌를 바꿈)</button><button type="button" class="text-button pp-danger" id="va-reset">${V.armed === 'reset' ? '정말 지우기(되돌릴 수 없음)' : '계좌 지우기'}</button></div></details></div>`;
  box.querySelector('#va-check').onclick = () => tick({ preview: true });
  const placeBtn = box.querySelector('#va-place'); if (placeBtn) placeBtn.onclick = () => tick({ placePreview: true });
  const cancelBtn = box.querySelector('#va-cancel'); if (cancelBtn) cancelBtn.onclick = () => { V.preview = null; render(); };
  const menu = box.querySelector('#va-menu'); menu.addEventListener('toggle', () => { V.menuOpen = menu.open; if (!menu.open && V.armed === 'reset') { V.armed = null; render(); } });
  box.querySelector('#va-export').onclick = () => { const b = new Blob([JSON.stringify(acc, null, 1)], { type: 'application/json' }), a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `teamquant-virtual-${acc.id}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  box.querySelector('#va-import').onclick = importFile;
  box.querySelector('#va-reset').onclick = () => { if (V.armed !== 'reset') { V.armed = 'reset'; render(); setTimeout(() => { if (V.armed === 'reset') { V.armed = null; render(); } }, 6000); return; } V.armed = null; V.menuOpen = false; clearTimeout(V.timer); V.acc = null; V.plan = null; V.preview = null; V.note = ''; V.lastBlocked = null; save(null); render(); };
}
async function importFile() {
  if (V.acc && !confirm("지금 가상계좌를 불러온 파일의 계좌로 바꿉니다. 지금 기록은 이 브라우저에서 사라집니다(먼저 '파일로 저장'을 해 두세요).")) return;
  if (window.tqRequireConsent && !(await window.tqRequireConsent('파일에서 불러오기'))) return;
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json';
  inp.onchange = async () => { try { const f = inp.files?.[0]; if (!f || f.size > 2_000_000) throw new Error('파일이 없거나 너무 큽니다.'); const a = validateAccount(JSON.parse(await f.text())); V.acc = a; V.plan = null; V.preview = null; V.err = ''; save(a); tick(); } catch (e) { V.err = e.message; render(); } };
  inp.click();
}

/** paper-ui 가 모의투자 화면을 만든 뒤 부른다. 카드는 팀 모의계좌 카드 바로 아래, 탭은 화면 제목 줄에 둔다. */
export function mountVirtual(page) {
  if (document.getElementById('pp-va')) return;
  const card = document.createElement('article'); card.className = 'cr-card'; card.id = 'pp-va';
  const anchor = page.querySelector('#pp-kis'); if (anchor) anchor.after(card); else page.querySelector('.cr-main')?.prepend(card);
  // 2026-11-25 UI·UX P0: 두 계좌를 탭으로 나눈다(띠·숫자·표가 고른 계좌만). 고른 탭은 이 브라우저에 기억(편의). 2026-11-26: 탭을 제목 줄로 올려 위쪽 빈자리를 줄였다.
  const tabs = document.createElement('div'); tabs.className = 'pp-tabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '계좌');
  tabs.innerHTML = '<button type="button" role="tab" data-pp-tab-btn="mine">내 가상계좌</button><button type="button" role="tab" data-pp-tab-btn="team">팀 모의계좌</button>';
  const head = page.querySelector('.page-head'); if (head) head.append(tabs); else (page.querySelector('#pp-kis') || card).before(tabs);
  const setTab = t => { page.dataset.ppTab = t; for (const b of tabs.querySelectorAll('[data-pp-tab-btn]')) { const on = b.dataset.ppTabBtn === t; b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; } try { localStorage.setItem('teamQuantPaperTab', t); } catch { } };
  tabs.addEventListener('click', e => { const b = e.target.closest('[data-pp-tab-btn]'); if (b) setTab(b.dataset.ppTabBtn); });
  tabs.addEventListener('keydown', e => { if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; const next = page.dataset.ppTab === 'mine' ? 'team' : 'mine'; setTab(next); tabs.querySelector('[data-pp-tab-btn="' + next + '"]')?.focus(); });
  let savedTab = null; try { savedTab = localStorage.getItem('teamQuantPaperTab'); } catch { }
  V.acc = load(); render(); setTab(savedTab === 'team' || savedTab === 'mine' ? savedTab : (V.acc ? 'mine' : 'team'));
  if (V.acc) tick();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && V.acc) tick(); });
}
export { VA_VERSION };
