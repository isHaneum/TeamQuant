// 내 가상 모의계좌(결정 62 · 2026-11-24): 증권사 계정 없이 누구나 이 브라우저에 자기 계좌를 만든다.
// 팀 모의계좌와 같은 계획·규칙 엔진으로 점검하고, 체결만 가상(장중 현재가 · 장 밖이면 다음 세션 시가). 장부는 이 브라우저(localStorage)에만 — 내보내기·가져오기로 옮긴다.
// 화면이 열려 있는 동안 30초마다(장이 닫혀 있으면 5분마다) 시세를 다시 읽어 대기 주문을 체결하고 평가한다. 화면을 닫아 둔 동안 열린 장의 주문은 다음에 열 때 그 세션 시가로 맞춰진다.
import { createAccount, place, processQueue, valuation, decide, checkDue, recordCheck, planFromDoc, validateAccount, mark, quoteUsable, sessionState, marketOf, COSTS, VA_VERSION } from '/lib/virtual-account.js';
import { normalizeRules } from '/lib/core-rules.js';
import { candles as fetchCandles, getJson } from '/lib/client-data.js';
import { tip } from '/tooltip-ui.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = v => (Number.isFinite(v) ? `${Math.round(v).toLocaleString('ko-KR')}원` : '—');
const swon = v => (Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.round(Math.abs(v)).toLocaleString('ko-KR')}원` : '—');
const pctS = v => (Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(2)}%` : '—');
const tone = v => (v > 0 ? 'up' : v < 0 ? 'down' : '');
const px = (v, usd) => (Number.isFinite(v) ? (usd ? '$' + v.toFixed(2) : Math.round(v).toLocaleString('ko-KR') + '원') : '—');
const session = () => { try { return sessionStorage.getItem('teamQuantSession') || 'guest'; } catch { return 'guest'; } };
const KEY = () => `teamQuantVA:${session()}`;
const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY()) || 'null'); return v ? validateAccount(v) : null; } catch { return null; } };
const save = a => { try { if (a) localStorage.setItem(KEY(), JSON.stringify(a)); else localStorage.removeItem(KEY()); return true; } catch { return false; } };
const savedPlan = () => { try { const v = JSON.parse(localStorage.getItem(`teamQuantRules:${session()}`) || 'null'); return v?.plan && Object.keys(v.plan).length ? v.plan : null; } catch { return null; } };
const savedRules = () => { try { const v = JSON.parse(localStorage.getItem(`teamQuantRules:${session()}`) || 'null'); return normalizeRules(v?.rules || {}).rules; } catch { return normalizeRules({}).rules; } };

const V = { acc: null, plan: null, planLabel: '', quotes: {}, quotesAt: null, fx: null, fxAt: 0, bars: {}, barsAt: 0, busy: false, timer: null, note: '', armed: null, err: '' };

async function planNow(acc) {
  if (acc.planSource === 'mine') { const p = savedPlan(); if (p) { const out = {}; for (const [k, v] of Object.entries(p)) { const pct = typeof v === 'number' ? v : Number(v?.pct); if (pct > 0) out[k] = { pct, name: v?.name || k, currency: v?.currency || (marketOf(k) === 'US' ? 'USD' : 'KRW') }; } return { plan: out, label: '규칙 화면의 내 계획' }; } }
  const doc = await getJson('/data/paper-plan.json').catch(() => null);
  return { plan: planFromDoc(doc), label: doc?.version ? `팀 기본 계획 ${doc.version}` : '팀 기본 계획' };
}
const symbolsOf = acc => [...new Set([...Object.keys(V.plan || {}), ...Object.keys(acc.positions), ...acc.orders.filter(o => o.status === 'queued').map(o => o.symbol)])].slice(0, 20);
async function readQuotes(acc) { const s = symbolsOf(acc); if (!s.length) return; const r = await getJson(`/api/quote?symbols=${encodeURIComponent(s.join(','))}`); V.quotes = Object.fromEntries(Object.entries(r.quotes || {}).filter(([, q]) => q && !q.error)); V.quotesAt = r.at || new Date().toISOString(); }
async function readFx(force = false) { if (!force && V.fx && Date.now() - V.fxAt < 300_000) return; try { const d = await getJson(`/api/market?symbol=${encodeURIComponent('KRW=X')}&range=3mo&t=${Math.floor(Date.now() / 300_000)}`); const c = (d.candles || []).filter(x => x.close > 0); if (c.length) { V.fx = c.at(-1).close; V.fxAt = Date.now(); V.fxCandles = c; } } catch { } }
/** 대기 주문 체결용 일봉(최근 3개월 · 5분마다 새로). 캐시된 2년 일봉은 오늘 봉이 낡을 수 있어 따로 읽는다. */
async function readBars(acc) {
  const q = [...new Set(acc.orders.filter(o => o.status === 'queued').map(o => o.symbol))]; if (!q.length || Date.now() - V.barsAt < 300_000) return;
  const slot = Math.floor(Date.now() / 300_000);
  await Promise.all(q.map(async s => { try { const sym = marketOf(s) === 'KR' ? s + '.KS' : s.replace(/\./g, '-'); let d = await getJson(`/api/market?symbol=${encodeURIComponent(sym)}&range=3mo&t=${slot}`).catch(() => null); if (marketOf(s) === 'KR' && !(d?.candles?.length)) d = await getJson(`/api/market?symbol=${encodeURIComponent(s + '.KQ')}&range=3mo&t=${slot}`).catch(() => null); V.bars[s] = (d?.candles || []).filter(c => c.open > 0 || c.close > 0); } catch { } }));
  V.barsAt = Date.now();
}
const priceMap = acc => { const out = {}; for (const s of symbolsOf(acc)) { const q = V.quotes[s]; if (q?.price > 0) out[s] = q.price; else if (V.bars[s]?.length) out[s] = V.bars[s].at(-1).close; } return out; };

/** 한 바퀴: 시세 → 대기 주문 체결 → (때가 되면) 점검·주문 → 평가·평가점 → 저장 · 그리기. */
async function tick({ forceCheck = false } = {}) {
  const acc = V.acc; if (!acc || V.busy) return; V.busy = true; V.err = '';
  try {
    if (!V.plan) { const p = await planNow(acc); V.plan = p.plan; V.planLabel = p.label; }
    await Promise.all([readQuotes(acc).catch(e => { V.err = `시세: ${e.message}`; }), readFx(), readBars(acc)]);
    const now = Date.now();
    const filled = processQueue(acc, { candles: V.bars, fxCandles: V.fxCandles || [], quotes: V.quotes, fx: V.fx, now });
    const due = checkDue(acc, now);
    if (forceCheck || due.due) {
      V.note = '점검 중 — 2년 일봉으로 변동성·손실 범위를 계산합니다…'; render();
      const syms = [...new Set([...Object.keys(V.plan), ...Object.keys(acc.positions)])], cs = {};
      await Promise.all(syms.map(async s => { try { cs[s] = (await fetchCandles(s, marketOf(s) === 'US' ? 'USD' : 'KRW', '2y')).candles; } catch { } }));
      const fxc = await fetchCandles('KRW=X', 'USD', '2y').then(d => d.candles).catch(() => V.fxCandles || []);
      const d = decide(acc, { plan: V.plan, rules: savedRules(), candlesBySymbol: cs, fxCandles: fxc, prices: priceMap(acc), fx: V.fx, now });
      const c = recordCheck(acc, { now, why: forceCheck ? '직접 점검' : due.why, orders: d.orders, blocked: d.blocked, evaluation: d.evaluation });
      const placed = place(acc, d.orders, { quotes: V.quotes, fx: V.fx, now, checkId: c.id });
      V.note = `${forceCheck ? '직접 점검' : due.why}: 주문 ${placed.length}건(바로 체결 ${placed.filter(o => o.status === 'filled').length} · 대기 ${placed.filter(o => o.status === 'queued').length})${d.blocked.length ? ` · 막힘 ${d.blocked.length}건` : ''}${d.missing.length ? ` · 시세 없어 뺀 종목 ${d.missing.length}` : ''}`;
      V.lastBlocked = d.blocked;
    } else if (filled.length) V.note = `대기 주문 ${filled.length}건 체결`;
    const v = valuation(acc, { prices: priceMap(acc), fx: V.fx }); if (v.complete && (!Object.keys(acc.positions).some(s => marketOf(s) === 'US') || V.fx)) mark(acc, v.totalKrw, now);
    if (!save(acc)) V.err = '이 브라우저에 저장하지 못했습니다(저장 공간·비공개 창).';
  } catch (e) { V.err = e.message || String(e); }
  finally { V.busy = false; render(); schedule(); }
}
function schedule() {
  clearTimeout(V.timer); if (!V.acc) return;
  const open = ['KR', 'US'].some(m => sessionState(new Date(), m).open), ms = document.visibilityState === 'visible' ? (open ? 30_000 : 300_000) : 600_000;
  V.timer = setTimeout(() => tick(), ms);
}

const costTip = () => tip(`체결은 가상입니다. 장중에는 그 순간 현재가(네이버 증권 · 시각 표시)에 호가 차이 절반 + 충격(국내 주식 ${COSTS.KR.halfSpreadBp.stock + COSTS.impactBp}bp · 국내 ETF ${COSTS.KR.halfSpreadBp.etf + COSTS.impactBp}bp · 미국 주식 ${COSTS.US.halfSpreadBp.stock + COSTS.impactBp}bp · 미국 ETF ${COSTS.US.halfSpreadBp.etf + COSTS.impactBp}bp)만큼 불리하게, 호가 단위로 체결합니다. 장이 닫혀 있거나 시세가 ${COSTS.quoteMaxAgeSec / 60}분보다 낡으면 대기했다가 다음 세션 시가로 체결합니다(화면을 닫아 둔 동안 열린 장도 같은 시가로 맞춥니다). 수수료 국내 ${COSTS.KR.commission * 100}% · 미국 ${COSTS.US.commission * 100}%, 국내 주식 매도 거래세 ${COSTS.KR.sellTax.stock * 100}%(ETF 없음), 미국 매도 SEC 수수료, 달러 종목은 원화를 자동 환전(환율 ±${COSTS.fxSpread * 100}%). 1주 단위. 실제 체결과 다를 수 있습니다(호가 잔량·급변·휴장일).`);

function holdingsHtml(v, acc) {
  if (!v.rows.length) return '<p class="cr-muted">아직 보유 없음 — 첫 점검이 계획 비중만큼 주문합니다.</p>';
  const plan = V.plan || {};
  return `<div class="pp-scroll"><table class="pp-hold"><thead><tr><th>종목</th><th>수량</th><th>평균 원가</th><th>현재가</th><th>평가</th><th>손익</th><th>비중 / 계획</th></tr></thead><tbody>${v.rows.sort((a, b) => (b.valueKrw || 0) - (a.valueKrw || 0)).map(r => {
    const usd = r.currency === 'USD', q = V.quotes[r.symbol], live = q && quoteUsable(q, Date.now(), marketOf(r.symbol)).ok;
    return `<tr><td>${esc(r.name)} <span class="cr-muted">${esc(r.symbol)}</span></td><td>${r.qty.toLocaleString('ko-KR')}</td><td>${won(r.costKrw / r.qty)}</td><td>${px(r.price, usd)}${live ? '' : ' <span class="cr-muted">(마지막 값)</span>'}</td><td>${won(r.valueKrw)}</td><td class="${tone(r.pnlKrw)}">${swon(r.pnlKrw)}</td><td>${Number.isFinite(r.weightPct) ? r.weightPct.toFixed(1) + '%' : '—'} / ${Number.isFinite(Number(plan[r.symbol]?.pct)) ? Number(plan[r.symbol].pct).toFixed(1) + '%' : '계획 밖'}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function ordersHtml(acc) {
  const q = acc.orders.filter(o => o.status === 'queued'), recent = acc.orders.filter(o => o.status !== 'queued').slice(-15).reverse();
  const row = o => `<tr class="${o.status === 'filled' ? '체결' : '차단'}"><td>${esc(String(o.fill?.at || o.at).slice(5, 16).replace('T', ' '))}</td><td>${o.side === 'SELL' ? '매도' : '매수'}</td><td>${esc(o.name)} ${o.fill ? `${o.fill.qty}주 @${px(o.fill.price, o.market === 'US')} · ${esc(o.fill.source)} · 비용 ${won((o.fill.feeKrw || 0) + (o.fill.taxKrw || 0))}${o.fill.realizedKrw !== undefined ? ` · 실현 ${swon(o.fill.realizedKrw)}` : ''}${o.fill.note ? ` · ${esc(o.fill.note)}` : ''}` : `${o.qty}주 · ${esc(o.reason || o.status)}`}<br><small class="cr-muted">${esc(o.why)}</small></td></tr>`;
  return `${q.length ? `<h4>대기 주문 ${q.length}건 ${tip('장이 닫혀 있거나 시세가 낡아 바로 체결하지 못한 주문입니다. 그 시장의 다음 세션 시가로 체결합니다.')}</h4><ul class="pp-kis-items">${q.map(o => `<li>${o.side === 'SELL' ? '매도' : '매수'} ${esc(o.name)} ${o.qty}주 <small>${esc(o.waitWhy || '')} · ${esc(o.why)}</small></li>`).join('')}</ul>` : ''}
  ${recent.length ? `<h4>최근 체결</h4><div class="pp-scroll"><table class="pp-journal"><tbody>${recent.map(row).join('')}</tbody></table></div>` : ''}`;
}
function render() {
  const box = document.getElementById('pp-va'); if (!box) return; const acc = V.acc;
  if (!acc) {
    const mine = savedPlan();
    box.innerHTML = `<header><h3>내 가상 모의계좌 ${tip('증권사 계정 없이 이 브라우저에 나만의 모의계좌를 만듭니다. 위 팀 모의계좌와 같은 계획·규칙 엔진으로 주 1회(그 주 첫 접속) 점검하고, 체결은 실시간 시세로 가상 처리합니다. 장부는 이 브라우저에만 있습니다.')}</h3></header>
    <div class="pp-form"><label class="ck-field unit"><span>시작 자금</span><input id="va-cap" type="number" value="10000000" min="1000000" step="1000000" inputmode="numeric"><i>원</i></label>
    <label class="ck-field"><span>계획</span><select id="va-plan"><option value="team">팀 기본 계획(위 모의계좌와 같은 비중)</option><option value="mine"${mine ? '' : ' disabled'}>규칙 화면의 내 계획${mine ? '' : ' (저장 없음)'}</option></select></label></div>
    <div class="cr-actions"><button class="primary" id="va-create">가상 계좌 만들기</button><button class="secondary" id="va-import">파일에서 가져오기</button><span class="cr-err" id="va-err">${esc(V.err)}</span></div>`;
    box.querySelector('#va-create').onclick = () => { try { V.acc = createAccount({ startKrw: Number(box.querySelector('#va-cap').value), planSource: box.querySelector('#va-plan').value }); V.plan = null; save(V.acc); tick(); } catch (e) { V.err = e.message; render(); } };
    box.querySelector('#va-import').onclick = importFile; return;
  }
  const v = valuation(acc, { prices: priceMap(acc), fx: V.fx }), costs = acc.feesKrw + acc.taxKrw + acc.fxCostKrw + acc.slipKrw, last = acc.checks.at(-1), due = checkDue(acc);
  const mk = m => { const s = sessionState(new Date(), m); return `${m === 'KR' ? '국내' : '미국'} ${s.open ? '<b class="run">열림</b>' : '닫힘'}`; };
  box.innerHTML = `<header><h3>내 가상 모의계좌 ${costTip()} <span class="pp-kis-sub">(${esc(V.planLabel || '계획 읽는 중')} · 이 브라우저)</span></h3></header>
  <div class="pp-hero"><div><span>총자산</span><b>${won(v.totalKrw)}</b><small>${v.complete ? '' : '일부 종목 가격 없음'}</small></div><div><span>시작 대비</span><b class="${tone(v.retPct)}">${pctS(v.retPct)}</b><small>${won(acc.startKrw)}에서 · ${esc(acc.createdAt.slice(0, 10))}</small></div><div><span>현금</span><b>${won(v.cashKrw)}</b><small>${v.totalKrw > 0 ? (v.cashKrw / v.totalKrw * 100).toFixed(1) + '%' : ''}</small></div><div><span>쓴 비용 ${tip('수수료 + 거래세·SEC 수수료 + 환전 스프레드 + 호가 차이·충격(현재가 대비 불리하게 체결된 만큼)의 합입니다.')}</span><b>${won(costs)}</b><small>수수료 ${won(acc.feesKrw)} · 세금 ${won(acc.taxKrw)}</small></div><div><span>다음 점검</span><b>${due.due ? '지금' : '다음 주 첫 접속'}</b><small>${last ? `마지막 ${esc(last.at.slice(5, 16).replace('T', ' '))}` : ''}</small></div></div>
  <p class="pp-kis-note">${mk('KR')} · ${mk('US')} · 시세 ${V.quotesAt ? esc(new Date(V.quotesAt).toLocaleTimeString('ko-KR', { hour12: false })) : '—'}${V.fx ? ` · 환율 ${V.fx.toFixed(1)}` : ''} · ${V.busy ? '갱신 중…' : '장중 30초 · 장 밖 5분마다 자동 갱신'}${V.note ? ` · ${esc(V.note)}` : ''}</p>
  ${V.err ? `<p class="cr-err">${esc(V.err)}</p>` : ''}
  ${holdingsHtml(v, acc)}${ordersHtml(acc)}
  ${V.lastBlocked?.length ? `<details class="pp-kis-plan"><summary>이번 점검에서 막힌 주문 ${V.lastBlocked.length}건</summary><ul class="pp-kis-items">${V.lastBlocked.map(b => `<li class="bad">${b.side === 'SELL' ? '매도' : '매수'} ${esc(b.name)} ${won(b.amountKrw)} <small>${esc(b.why)}</small></li>`).join('')}</ul></details>` : ''}
  <div class="cr-actions"><button class="primary" id="va-check">지금 점검·주문</button><button class="secondary" id="va-refresh">시세 새로고침</button><button class="secondary" id="va-export">내보내기</button><button class="secondary" id="va-import">가져오기</button><button class="secondary" id="va-reset">${V.armed === 'reset' ? '정말 지우기(되돌릴 수 없음)' : '계좌 지우기'}</button></div>`;
  box.querySelector('#va-check').onclick = () => tick({ forceCheck: true });
  box.querySelector('#va-refresh').onclick = () => { V.barsAt = 0; readFx(true).then(() => tick()); };
  box.querySelector('#va-export').onclick = () => { const b = new Blob([JSON.stringify(acc, null, 1)], { type: 'application/json' }), a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `teamquant-virtual-${acc.id}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  box.querySelector('#va-import').onclick = importFile;
  box.querySelector('#va-reset').onclick = () => { if (V.armed !== 'reset') { V.armed = 'reset'; render(); setTimeout(() => { if (V.armed === 'reset') { V.armed = null; render(); } }, 6000); return; } V.armed = null; clearTimeout(V.timer); V.acc = null; V.plan = null; save(null); render(); };
}
function importFile() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json';
  inp.onchange = async () => { try { const f = inp.files?.[0]; if (!f || f.size > 2_000_000) throw new Error('파일이 없거나 너무 큽니다.'); const a = validateAccount(JSON.parse(await f.text())); V.acc = a; V.plan = null; save(a); tick(); } catch (e) { V.err = e.message; render(); } };
  inp.click();
}

/** paper-ui 가 모의투자 화면을 만든 뒤 부른다. 팀 모의계좌 카드 바로 아래에 둔다. */
export function mountVirtual(page) {
  if (document.getElementById('pp-va')) return;
  const card = document.createElement('article'); card.className = 'cr-card'; card.id = 'pp-va';
  const anchor = page.querySelector('#pp-kis'); if (anchor) anchor.after(card); else page.querySelector('.cr-main')?.prepend(card);
  V.acc = load(); render();
  if (V.acc) tick();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && V.acc) tick(); });
}
export { VA_VERSION };
