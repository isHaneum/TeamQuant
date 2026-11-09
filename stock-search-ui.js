// 종목 검색 제안(공용): 입력하면 국내 이름·코드(서버 /api/stocks, 대형주·별칭 우선)와 미국 티커 목록에서 제안을 띄우고, 행마다 오늘 등락(지연 시세)을 붙인다.
// 매매 전 확인·과거 데이터 시뮬 등 종목을 고르는 모든 입력칸이 같은 방식을 쓴다. 보내는 정보는 검색어와 종목 코드뿐이다.
import { getJson } from '/lib/client-data.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const US_LIST = [['AAPL', '애플'], ['MSFT', '마이크로소프트'], ['NVDA', '엔비디아'], ['AMZN', '아마존'], ['GOOGL', '알파벳'], ['META', '메타'], ['TSLA', '테슬라'], ['BRK-B', '버크셔 해서웨이'], ['JPM', 'JP모건'], ['JNJ', '존슨앤드존슨'], ['KO', '코카콜라'], ['PG', 'P&G'], ['LLY', '일라이 릴리'], ['UNH', '유나이티드헬스'], ['XOM', '엑슨모빌'], ['SPY', 'S&P500 ETF'], ['QQQ', '나스닥100 ETF'], ['VOO', '뱅가드 S&P500 ETF'], ['TLT', '미국 장기채 ETF'], ['SOXX', '반도체 ETF'], ['TSM', 'TSMC'], ['AVGO', '브로드컴'], ['AMD', 'AMD'], ['MU', '마이크론'], ['NFLX', '넷플릭스'], ['COST', '코스트코'], ['WMT', '월마트'], ['LMT', '록히드마틴'], ['RTX', 'RTX'], ['GEV', 'GE 버노바'], ['PLTR', '팔란티어'], ['ISRG', '인튜이티브 서지컬'], ['ASML', 'ASML'], ['V', '비자'], ['MA', '마스터카드'], ['HD', '홈디포'], ['ABBV', '애브비'], ['MRK', '머크'], ['PEP', '펩시코'], ['CSCO', '시스코'], ['ORCL', '오라클'], ['CRM', '세일즈포스'], ['INTC', '인텔'], ['BA', '보잉'], ['GS', '골드만삭스'], ['BAC', '뱅크오브아메리카'], ['CEG', '컨스텔레이션 에너지'], ['ALB', '앨버말'], ['ROK', '로크웰 오토메이션'], ['GM', 'GM'], ['TM', '도요타(ADR)'], ['HII', '헌팅턴 잉걸스'], ['PFE', '화이자'], ['NOC', '노스럽그러먼'], ['GD', '제너럴 다이내믹스']];
const quoteCache = new Map();
export async function quoteOf(symbol) { if (!quoteCache.has(symbol)) quoteCache.set(symbol, getJson(`/api/quote?symbol=${encodeURIComponent(symbol)}`).catch(() => null)); return quoteCache.get(symbol); }

/** 검색어 → 제안 목록 [{symbol, name, currency, sub}] (국내는 서버 순위 그대로, 미국은 티커·이름 앞글자) */
export async function searchStocks(q) {
  const up = q.toUpperCase(), out = [];
  if (/^[A-Za-z][A-Za-z.\-]*$/.test(q)) out.push(...US_LIST.filter(([t, n]) => t.startsWith(up) || n.includes(q)).slice(0, 6).map(([t, n]) => ({ symbol: t, name: n, currency: 'USD', sub: t })));
  else out.push(...US_LIST.filter(([, n]) => n.includes(q)).slice(0, 3).map(([t, n]) => ({ symbol: t, name: n, currency: 'USD', sub: t })));
  if (!/^[A-Za-z]/.test(q)) { try { const d = await getJson(`/api/stocks?q=${encodeURIComponent(q)}`); out.push(...(d.items || []).slice(0, 8).map(x => ({ symbol: x.code, name: x.name, currency: 'KRW', sub: x.code }))); } catch { } }
  return out;
}

/**
 * 입력칸에 제안 목록을 붙인다. onPick({symbol,name,currency}) 를 부른다.
 * 옵션: clearOnPick(고르면 칸 비움, 여러 개 고를 때) · exclude(() => Set) 이미 고른 종목 제외
 */
export function attachStockSearch(input, { onPick, clearOnPick = false, exclude = () => new Set() } = {}) {
  if (!input || input.dataset.searchAttached) return; input.dataset.searchAttached = '1';
  let wrap = input.parentElement; if (!wrap.classList.contains('cp-search')) { wrap = document.createElement('div'); wrap.className = 'cp-search'; input.replaceWith(wrap); wrap.append(input); }
  let box = wrap.querySelector('.cp-sugg'); if (!box) { box = document.createElement('div'); box.className = 'cp-sugg'; box.hidden = true; box.setAttribute('role', 'listbox'); wrap.append(box); }
  input.setAttribute('autocomplete', 'off'); input.setAttribute('aria-autocomplete', 'list');
  let run = 0, timer = null;
  const hide = () => { box.hidden = true; };
  async function suggest(q) {
    const my = ++run; if (!q) { hide(); box.innerHTML = ''; return; }
    box.hidden = false; box.innerHTML = '<div class="cp-sugg-empty">찾는 중…</div>'; // 이전 검색어의 목록을 남겨 두지 않는다
    const skip = exclude(), out = (await searchStocks(q)).filter(o => !skip.has(o.symbol));
    if (my !== run) return;
    if (!out.length) { box.hidden = false; box.innerHTML = '<div class="cp-sugg-empty">찾는 종목이 없습니다. 6자리 코드나 미국 티커로 적어 보십시오.</div>'; return; }
    box.hidden = false; box.innerHTML = out.map(o => `<button type="button" role="option" data-symbol="${esc(o.symbol)}" data-name="${esc(o.name)}" data-cur="${o.currency}"><b>${esc(o.name)}</b><small>${esc(o.sub)}</small><span class="q" data-q="${esc(o.symbol)}">…</span></button>`).join('');
    box.querySelectorAll('button').forEach(b => b.onclick = () => { const o = { symbol: b.dataset.symbol, name: b.dataset.name, currency: b.dataset.cur }; input.value = clearOnPick ? '' : o.name; hide(); onPick?.(o); if (clearOnPick) input.focus(); });
    await Promise.all(out.slice(0, 6).map(async o => { const qv = await quoteOf(o.symbol); if (my !== run) return; const el = box.querySelector(`[data-q="${CSS.escape(o.symbol)}"]`); if (!el) return; if (qv && Number.isFinite(qv.pct)) { el.textContent = `${qv.pct > 0 ? '+' : ''}${qv.pct.toFixed(2)}%`; el.className = `q ${qv.pct > 0 ? 'up' : qv.pct < 0 ? 'down' : ''}`; } else el.textContent = ''; }));
  }
  input.addEventListener('input', () => { clearTimeout(timer); const v = input.value.trim(); timer = setTimeout(() => void suggest(v), 180); });
  input.addEventListener('focus', () => { const v = input.value.trim(); if (v) void suggest(v); });
  input.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); if (e.key === 'ArrowDown') { const f = box.querySelector('button'); if (f) { e.preventDefault(); f.focus(); } } if (e.key === 'Enter' && !box.hidden) { const f = box.querySelector('button'); if (f) { e.preventDefault(); f.click(); } } });
  box.addEventListener('keydown', e => { const items = [...box.querySelectorAll('button')], i = items.indexOf(document.activeElement); if (e.key === 'ArrowDown' && items[i + 1]) { e.preventDefault(); items[i + 1].focus(); } if (e.key === 'ArrowUp') { e.preventDefault(); (items[i - 1] || input).focus(); } if (e.key === 'Escape') { hide(); input.focus(); } });
  document.addEventListener('click', e => { if (!wrap.contains(e.target)) hide(); });
  return { hide, suggest };
}
