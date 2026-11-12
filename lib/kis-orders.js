// 한국투자증권 모의투자(vps) 주문 클라이언트: 국내 주식(KRX)과 미국 주식(NASD·NYSE·AMEX) 현금 지정가 주문·취소·당일 주문 조회·현재가·잔고·주문 가능 수량.
// 실전(prod) 모드에서는 이 클라이언트를 만들지 않는다(주문 경로에 실전 키가 올라가지 않도록). tr_id 는 공식 예제(koreainvestment/open-trading-api, 2026) 기준.
// 미국 모의 매도 tr_id 는 공식 예제의 주석·docstring(VTTT1001U)과 코드(VTTT1006U)가 다르다. 문서 쪽(VTTT1001U)을 먼저 쓰고 거절되면 한 번 VTTT1006U 로 재시도한다.
// 응답 필드 이름은 공식 예제가 명시하지 않은 것이 있어 관대하게 읽고 모르면 null 로 둔다. 토큰은 24시간 유효·1분당 1회 발급이라 파일에 캐시한다.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export const KIS_HOSTS = { vps: 'https://openapivts.koreainvestment.com:29443', prod: 'https://openapi.koreainvestment.com:9443' };
export const TR = {
  price: 'FHKST01010100', priceUS: 'HHDFS00000300',
  buy: { vps: 'VTTC0012U', prod: 'TTTC0012U' }, sell: { vps: 'VTTC0011U', prod: 'TTTC0011U' }, cancel: { vps: 'VTTC0013U', prod: 'TTTC0013U' },
  daily: { vps: 'VTTC0081R', prod: 'TTTC0081R' }, psbl: { vps: 'VTTC8908R', prod: 'TTTC8908R' }, balance: { vps: 'VTTC8434R', prod: 'TTTC8434R' },
  buyUS: { vps: 'VTTT1002U', prod: 'TTTT1002U' }, sellUS: { vps: 'VTTT1001U', prod: 'TTTT1006U' }, sellUSAlt: { vps: 'VTTT1006U' }, cancelUS: { vps: 'VTTT1004U', prod: 'TTTT1004U' },
  dailyUS: { vps: 'VTTS3035R', prod: 'TTTS3035R' }, psblUS: { vps: 'VTTS3007R', prod: 'TTTS3007R' }, balanceUS: { vps: 'VTTS3012R', prod: 'TTTS3012R' }, presentUS: { vps: 'VTRP6504R', prod: 'CTRP6504R' }
};
export const US_EXCHANGES = [['NASD', 'NAS'], ['NYSE', 'NYS'], ['AMEX', 'AMS']]; // [주문 거래소 코드, 시세 거래소 코드]
export class KisError extends Error { constructor(message, code = 'kis_error', status = 502) { super(message); this.name = 'KisError'; this.code = code; this.status = status; } }
export const isKrCode = s => /^\d{6}$/.test(String(s || '').split('.')[0]);
export const marketOf = s => isKrCode(s) ? 'KR' : 'US';

export function kisSettings(env = process.env) {
  const mode = (env.KIS_MODE || 'vps').toLowerCase();
  const appKey = env.KIS_APP_KEY, appSecret = env.KIS_APP_SECRET, account = env.KIS_ACCOUNT_NO, product = env.KIS_ACCOUNT_PRODUCT_CODE || '01';
  return { mode, appKey, appSecret, account, product, baseUrl: KIS_HOSTS[mode] || KIS_HOSTS.vps, configured: Boolean(appKey && appSecret && /^\d{8}$/.test(account || '')), accountMasked: /^\d{8}$/.test(account || '') ? '****' + account.slice(-4) : null };
}

// KRX 호가 단위(2023-01 개편 뒤): 2천 미만 1원 · 5천 미만 5원 · 2만 미만 10원 · 5만 미만 50원 · 20만 미만 100원 · 50만 미만 500원 · 그 이상 1,000원. 미국은 0.01달러.
export function tickSize(price, market = 'KR') { if (market === 'US') return 0.01; return price < 2000 ? 1 : price < 5000 ? 5 : price < 20000 ? 10 : price < 50000 ? 50 : price < 200000 ? 100 : price < 500000 ? 500 : 1000; }
export function roundTick(price, side = 'BUY', market = 'KR') { const t = tickSize(price, market); const v = side === 'BUY' ? Math.floor(price / t + 1e-9) * t : Math.ceil(price / t - 1e-9) * t; return market === 'US' ? Math.round(v * 100) / 100 : Math.round(v); }

const etParts = d => { const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); const o = {}; for (const p of f.formatToParts(d)) o[p.type] = p.value; return { wd: o.weekday, h: Number(o.hour) % 24, m: Number(o.minute), ymd: `${o.year}-${o.month}-${o.day}` }; };
function kstLabel(iso) { const d = new Date(Date.parse(iso) + 9 * 3600e3); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; }
/**
 * 정규장 여부. KR: 평일 09:00~15:30 KST(새 주문은 15:20 까지). US: 평일 09:30~16:00 ET(새 주문은 15:50 까지; 서머타임은 자동 반영).
 * 반환 {open, reason, openAt(ISO), closeAt(ISO), market}. 휴장일은 모른다(증권사가 거부하면 rejected 로 남는다).
 */
export function marketOpen(now = new Date(), market = 'KR') {
  if (market === 'US') {
    const e = etParts(now), hm = e.h * 60 + e.m, minsSinceOpen = hm - 570; // 09:30 = 570
    const openAt = new Date(now.getTime() - minsSinceOpen * 60e3 - now.getSeconds() * 1000).toISOString(), closeAt = new Date(Date.parse(openAt) + 390 * 60e3).toISOString();
    if (e.wd === 'Sat' || e.wd === 'Sun') return { open: false, reason: '미국 주말에는 주문하지 않습니다.', openAt, closeAt, market };
    if (hm < 570) return { open: false, reason: `미국 장 시작 전입니다(09:30 ET = 한국 ${kstLabel(openAt)}).`, openAt, closeAt, market };
    if (hm >= 950) return { open: false, reason: hm >= 960 ? '미국 장이 끝났습니다(16:00 ET).' : '미국 장 마감 10분 전부터는 새 주문을 내지 않습니다.', openAt, closeAt, market };
    return { open: true, reason: '', openAt, closeAt, market };
  }
  const kst = new Date(now.getTime() + 9 * 3600e3), day = kst.getUTCDay(), hm = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const ymd = kst.toISOString().slice(0, 10), at = (h, m) => new Date(Date.parse(`${ymd}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+09:00`)).toISOString();
  if (day === 0 || day === 6) return { open: false, reason: '주말에는 주문하지 않습니다.', openAt: at(9, 0), closeAt: at(15, 30), market };
  if (hm < 9 * 60) return { open: false, reason: '장 시작 전입니다(09:00 KST).', openAt: at(9, 0), closeAt: at(15, 30), market };
  if (hm >= 15 * 60 + 20) return { open: false, reason: hm >= 15 * 60 + 30 ? '장이 끝났습니다(15:30 KST).' : '마감 10분 전부터는 새 주문을 내지 않습니다.', openAt: at(9, 0), closeAt: at(15, 30), market };
  return { open: true, reason: '', openAt: at(9, 0), closeAt: at(15, 30), market };
}

const num = v => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : null; };

// ── 조회 요청 모양·응답 해석(모의·실계좌 공용 · 순수 함수) ──
// 실계좌 읽기 전용 리더(lib/kis-reader.js)가 아래 모양을 그대로 쓴다(tr_id 만 모드별). 여기에는 주문·취소 요청 모양이 없다 — 그 둘은 모의 클라이언트 안에만 있고 실계좌 쪽에는 만들 수 없다.
const acct = cfg => ({ CANO: cfg.account, ACNT_PRDT_CD: cfg.product });
export const INQUIRY = {
  balanceKR: (cfg, fk = '', nk = '') => ({ path: '/uapi/domestic-stock/v1/trading/inquire-balance', params: { ...acct(cfg), AFHR_FLPR_YN: 'N', OFL_YN: '', INQR_DVSN: '00', UNPR_DVSN: '01', FUND_STTL_ICLD_YN: 'N', FNCG_AMT_AUTO_RDPT_YN: 'N', PRCS_DVSN: '00', CTX_AREA_FK100: fk, CTX_AREA_NK100: nk } }),
  balanceUS: (cfg, fk = '', nk = '') => ({ path: '/uapi/overseas-stock/v1/trading/inquire-balance', params: { ...acct(cfg), OVRS_EXCG_CD: 'NASD', TR_CRCY_CD: 'USD', CTX_AREA_FK200: fk, CTX_AREA_NK200: nk } }),
  presentUS: cfg => ({ path: '/uapi/overseas-stock/v1/trading/inquire-present-balance', params: { ...acct(cfg), WCRC_FRCR_DVSN_CD: '02', NATN_CD: '840', TR_MKET_CD: '00', INQR_DVSN_CD: '00' } }),
  ordersKR: (cfg, dateYmd, fk = '', nk = '') => ({ path: '/uapi/domestic-stock/v1/trading/inquire-daily-ccld', params: { ...acct(cfg), INQR_STRT_DT: dateYmd, INQR_END_DT: dateYmd, SLL_BUY_DVSN_CD: '00', INQR_DVSN: '00', PDNO: '', CCLD_DVSN: '00', ORD_GNO_BRNO: '', ODNO: '', INQR_DVSN_3: '00', INQR_DVSN_1: '', CTX_AREA_FK100: fk, CTX_AREA_NK100: nk } }),
  ordersUS: (cfg, dateYmd, excg = '', fk = '', nk = '') => ({ path: '/uapi/overseas-stock/v1/trading/inquire-ccnl', params: { ...acct(cfg), PDNO: '', ORD_STRT_DT: dateYmd, ORD_END_DT: dateYmd, SLL_BUY_DVSN: '00', CCLD_NCCS_DVSN: '00', OVRS_EXCG_CD: excg, SORT_SQN: 'DS', ORD_DT: '', ORD_GNO_BRNO: '', ODNO: '', CTX_AREA_NK200: nk, CTX_AREA_FK200: fk } })
};
/** 연속 조회: 응답 헤더 tr_cont 가 F·M 이면 다음 쪽 키 [fk, nk](국내 100 · 미국 200), 아니면 null. */
export const nextPageKeys = (data, cont, n) => (['F', 'M'].includes(cont) ? [data[`ctx_area_fk${n}`] || '', data[`ctx_area_nk${n}`] || ''] : null);
export const krPosition = x => ({ symbol: x.pdno, name: x.prdt_name, market: 'KR', currency: 'KRW', qty: num(x.hldg_qty), price: num(x.prpr), value: num(x.evlu_amt), valueKrw: num(x.evlu_amt), avgCost: num(x.pchs_avg_pric) });
export const usPosition = x => ({ symbol: x.ovrs_pdno, name: x.ovrs_item_name || x.ovrs_pdno, market: 'US', currency: 'USD', exchange: x.ovrs_excg_cd || null, qty: num(x.ovrs_cblc_qty), price: num(x.now_pric2), value: num(x.ovrs_stck_evlu_amt), avgCost: num(x.pchs_avg_pric) });
/** 국내 잔고 요약. 예수금총금액(dnca_tot_amt)은 결제 전 당일 매수를 빼지 않는다(D+2). 쓸 수 있는 현금은 가수도정산금액(prvs_rcdl_excc_amt), 없으면 총평가 − 유가평가, 그것도 없으면 예수금총금액. cash 가 null 이면 호출자가 실패로 다룬다. */
export function krSummary(summary, positions) {
  const dnca = num(summary?.dnca_tot_amt), d2 = num(summary?.prvs_rcdl_excc_amt), total = num(summary?.tot_evlu_amt), scts = num(summary?.scts_evlu_amt), stock = positions.reduce((a, p) => a + (p.valueKrw || 0), 0);
  const cash = d2 ?? (total !== null && scts !== null ? total - scts : dnca);
  return { cash, cashRaw: dnca, total: total ?? (cash === null ? null : cash + stock), stock };
}
/** 외화 예수금(USD). 미국 체결 기준 잔고(inquire-present-balance) output2 에서 통화 USD 행. 없으면 null. */
export const usdCashOf = data => { const usd = (data.output2 || []).find(r => (r.crcy_cd || '').toUpperCase() === 'USD'); return usd ? (num(usd.frcr_dncl_amt_2) ?? num(usd.frcr_dncl_amt1)) : null; };
// frcr_pchs_amt1 = 보유 미국 종목 매입금액(원화 환산, 매수 시점 환율). 통합증거금 계좌에서 원화로 샀을 때 '정산 전 매수대금'을 아는 유일한 수치다(모의계좌는 이 원화를 예수금에서 빼지 않는다 — 2026-11-12 확인).
export const usCostKrwOf = summary => num(summary?.frcr_pchs_amt1) ?? num(summary?.frcr_buy_amt_smtl1);
export const krOrderRow = x => { const qty = num(x.ord_qty) || 0, filled = num(x.tot_ccld_qty) || 0, remaining = num(x.rmn_qty) ?? Math.max(0, qty - filled), cancelled = x.cncl_yn === 'Y' || (num(x.cncl_cfrm_qty) || 0) > 0;
  return { market: 'KR', odno: x.odno || null, orgno: x.ord_gno_brno || '', code: x.pdno || null, name: x.prdt_name || null, side: x.sll_buy_dvsn_cd === '02' ? 'BUY' : x.sll_buy_dvsn_cd === '01' ? 'SELL' : (x.sll_buy_dvsn_cd_name || '').includes('매수') ? 'BUY' : 'SELL', qty, filled, remaining, price: num(x.ord_unpr), avgPrice: num(x.avg_prvs), time: x.ord_tmd || null, cancelled, status: cancelled ? 'cancelled' : filled >= qty && qty > 0 ? 'filled' : filled > 0 ? 'partial' : 'open' }; };
export const usOrderRow = x => { const qty = num(x.ft_ord_qty) || 0, filled = num(x.ft_ccld_qty) || 0, remaining = num(x.nccs_qty) ?? Math.max(0, qty - filled), st = x.prcs_stat_name || '', rejected = Boolean((x.rjct_rson || '').trim()) || /거부/.test(st), cancelled = /취소/.test(st);
  return { market: 'US', odno: x.odno || null, orgno: x.ord_gno_brno || '', code: x.pdno || null, name: x.prdt_name || null, exchange: x.ovrs_excg_cd || null, side: x.sll_buy_dvsn_cd === '02' ? 'BUY' : 'SELL', qty, filled, remaining, price: num(x.ft_ord_unpr3), avgPrice: num(x.ft_ccld_unpr3), time: x.ord_tmd || null, cancelled, rejected, reason: x.rjct_rson || '', status: cancelled ? 'cancelled' : rejected ? 'rejected' : filled >= qty && qty > 0 ? 'filled' : filled > 0 ? 'partial' : 'open' }; };
/** 미국 주문 목록 중복 제거(거래소별 조회를 합칠 때): 주문번호, 없으면 행 전체로 본다. */
export const dedupeRows = rows => { const seen = new Set(); return rows.filter(x => { const k = x.odno || JSON.stringify(x); if (seen.has(k)) return false; seen.add(k); return true; }); };

/**
 * 모의투자 클라이언트. fetch 를 주입할 수 있어 테스트는 네트워크 없이 돈다.
 * 모든 메서드는 실패하면 KisError 를 던진다(조용히 빈 값을 돌려주지 않는다 — 주문 엔진이 fail-closed 로 동작하기 위해).
 */
export function createKisClient({ env = process.env, fetch = globalThis.fetch, now = () => Date.now(), timeoutMs = 8000, tokenFile = null, minGapMs = 1100, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const cfg = kisSettings(env);
  if (!cfg.configured) throw new KisError('한투 키·모의계좌가 설정되지 않았습니다.', 'not_configured', 503);
  if (cfg.mode !== 'vps') throw new KisError('주문 클라이언트는 모의투자(KIS_MODE=vps)에서만 만듭니다. 실전 계좌 주문은 지원하지 않습니다.', 'live_forbidden', 403);
  let token = null; const exchangeOf = new Map();
  // 모의 서버는 초당 1건 정도만 받는다. 호출 사이를 띄우고, 그래도 '초당 거래건수 초과'면 한 번 쉬었다 다시 보낸다.
  let lastCallAt = 0; async function pace() { const wait = lastCallAt + minGapMs - Date.now(); if (wait > 0) await sleep(wait); lastCallAt = Date.now(); }
  const readTokenFile = () => { if (!tokenFile) return null; try { const t = JSON.parse(readFileSync(tokenFile, 'utf8')); return t && t.mode === cfg.mode && t.account === cfg.account && t.expiresAt > now() + 60_000 ? t : null; } catch { return null; } };
  const writeTokenFile = t => { if (!tokenFile) return; try { mkdirSync(dirname(tokenFile), { recursive: true }); writeFileSync(tokenFile, JSON.stringify({ mode: cfg.mode, account: cfg.account, value: t.value, expiresAt: t.expiresAt })); } catch { } };
  async function auth() {
    if (token && token.expiresAt > now() + 60_000) return token.value;
    const cached = readTokenFile(); if (cached) { token = cached; return token.value; }
    const r = await fetch(`${cfg.baseUrl}/oauth2/tokenP`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'client_credentials', appkey: cfg.appKey, appsecret: cfg.appSecret }), signal: AbortSignal.timeout(timeoutMs) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.access_token) throw new KisError((d.error_description || d.msg1 || `토큰 발급 실패 (${r.status})`) + (/1분당/.test(d.error_description || '') ? ' — 1분 뒤 다시 시도하십시오.' : ''), 'auth_failed', 502);
    token = { value: d.access_token, expiresAt: now() + Math.max(300, Number(d.expires_in || 86400)) * 1000 - 3600e3 }; writeTokenFile(token); return token.value;
  }
  async function call(method, path, tr, { params = null, body = null } = {}, retryAuth = true, retryRate = true) {
    const t = await auth(); await pace(); const url = `${cfg.baseUrl}${path}${params ? '?' + new URLSearchParams(params) : ''}`;
    let r; try { r = await fetch(url, { method, headers: { 'content-type': 'application/json; charset=utf-8', authorization: `Bearer ${t}`, appkey: cfg.appKey, appsecret: cfg.appSecret, tr_id: tr, custtype: 'P' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) }); }
    catch (e) { throw new KisError(`한투 서버 응답 없음 (${e.name === 'TimeoutError' ? '시간 초과' : e.message})`, 'network', 504); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.rt_cd !== '0') {
      // 토큰 만료·무효(EGW0012x)면 캐시를 버리고 한 번만 다시 발급해 재시도한다.
      if (retryAuth && /^EGW0012/.test(d.msg_cd || '')) { token = null; try { if (tokenFile) writeFileSync(tokenFile, '{}'); } catch { } return call(method, path, tr, { params, body }, false); }
      if (retryRate && /초당 거래건수|EGW00201/.test((d.msg1 || '') + (d.msg_cd || ''))) { await sleep(minGapMs + 400); return call(method, path, tr, { params, body }, retryAuth, false); }
      throw new KisError(d.msg1 || `KIS ${tr} 실패 (${r.status})`, d.msg_cd || 'kis_error', r.status >= 500 ? 502 : 400);
    }
    return { data: d, cont: r.headers?.get?.('tr_cont') || '' };
  }
  const ymd = (ms = now()) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
  const stamp = () => new Date(now()).toISOString();

  // ── 국내 ──
  async function priceKR(code) {
    const { data } = await call('GET', '/uapi/domestic-stock/v1/quotations/inquire-price', TR.price, { params: { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: code } });
    const o = data.output || {}, price = num(o.stck_prpr); if (!(price > 0)) throw new KisError(`${code} 현재가를 받지 못했습니다.`, 'no_price', 502);
    return { code, market: 'KR', currency: 'KRW', exchange: 'KRX', price, open: num(o.stck_oprc), upper: num(o.stck_mxpr), lower: num(o.stck_llam), prevClose: num(o.stck_sdpr), halted: o.temp_stop_yn === 'Y', warn: o.mrkt_warn_cls_code || '00', name: o.hts_kor_isnm || null, asOf: stamp() };
  }
  async function balanceKR() {
    let fk = '', nk = '', positions = [], summary = null;
    for (let page = 0; page < 5; page++) {
      const q = INQUIRY.balanceKR(cfg, fk, nk), { data, cont } = await call('GET', q.path, TR.balance.vps, { params: q.params });
      positions.push(...(data.output1 || []).filter(x => num(x.hldg_qty) > 0).map(krPosition));
      summary = data.output2?.[0] || summary;
      const more = nextPageKeys(data, cont, 100); if (!more) break; [fk, nk] = more;
    }
    const s = krSummary(summary, positions);
    if (s.cash === null) throw new KisError('예수금을 읽지 못했습니다.', 'no_cash', 502);
    return { ...s, positions };
  }
  async function buyingPowerKR(code, price) {
    const { data } = await call('GET', '/uapi/domestic-stock/v1/trading/inquire-psbl-order', TR.psbl.vps, { params: { CANO: cfg.account, ACNT_PRDT_CD: cfg.product, PDNO: code, ORD_UNPR: String(price), ORD_DVSN: '00', CMA_EVLU_AMT_ICLD_YN: 'N', OVRS_ICLD_YN: 'N' } });
    const o = data.output || {}; return { code, market: 'KR', maxQty: num(o.max_buy_qty), cashQty: num(o.nrcvb_buy_qty), cashAmt: num(o.nrcvb_buy_amt), ordCash: num(o.ord_psbl_cash) };
  }
  async function placeKR({ code, side, qty, price }) {
    const { data } = await call('POST', '/uapi/domestic-stock/v1/trading/order-cash', TR[side === 'BUY' ? 'buy' : 'sell'].vps, { body: { CANO: cfg.account, ACNT_PRDT_CD: cfg.product, PDNO: code, ORD_DVSN: '00', ORD_QTY: String(qty), ORD_UNPR: String(Math.round(price)), EXCG_ID_DVSN_CD: 'KRX', SLL_TYPE: side === 'SELL' ? '01' : '', CNDT_PRIC: '' } });
    const o = data.output || {}; return { odno: o.ODNO || o.odno || null, orgno: o.KRX_FWDG_ORD_ORGNO || o.krx_fwdg_ord_orgno || '', time: o.ORD_TMD || o.ord_tmd || null, msg: data.msg1 || '', exchange: 'KRX' };
  }
  async function cancelKR({ odno, orgno = '', qty = 0 }) {
    const { data } = await call('POST', '/uapi/domestic-stock/v1/trading/order-rvsecncl', TR.cancel.vps, { body: { CANO: cfg.account, ACNT_PRDT_CD: cfg.product, KRX_FWDG_ORD_ORGNO: orgno || '', ORGN_ODNO: odno, ORD_DVSN: '00', RVSE_CNCL_DVSN_CD: '02', ORD_QTY: String(qty || 0), ORD_UNPR: '0', QTY_ALL_ORD_YN: qty ? 'N' : 'Y', EXCG_ID_DVSN_CD: 'KRX' } });
    const o = data.output || {}; return { odno: o.ODNO || o.odno || odno, msg: data.msg1 || '' };
  }
  async function ordersKR(dateYmd) {
    let fk = '', nk = '', rows = [];
    for (let page = 0; page < 5; page++) {
      const q = INQUIRY.ordersKR(cfg, dateYmd, fk, nk), { data, cont } = await call('GET', q.path, TR.daily.vps, { params: q.params });
      rows.push(...(data.output1 || [])); const more = nextPageKeys(data, cont, 100); if (!more) break; [fk, nk] = more;
    }
    return rows.map(krOrderRow);
  }

  // ── 미국 ──
  async function priceUS(symbol) {
    const tries = exchangeOf.has(symbol) ? [US_EXCHANGES.find(e => e[0] === exchangeOf.get(symbol))] : US_EXCHANGES;
    let lastErr = null;
    for (const [ord, excd] of tries) {
      try {
        const { data } = await call('GET', '/uapi/overseas-price/v1/quotations/price', TR.priceUS, { params: { AUTH: '', EXCD: excd, SYMB: symbol } });
        const o = data.output || {}, price = num(o.last);
        if (price > 0) { exchangeOf.set(symbol, ord); return { code: symbol, market: 'US', currency: 'USD', exchange: ord, price, open: num(o.open), upper: null, lower: null, prevClose: num(o.base), halted: false, warn: '00', name: null, asOf: stamp() }; }
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new KisError(`${symbol} 미국 현재가를 받지 못했습니다(NASD·NYSE·AMEX 모두 없음).`, 'no_price', 502);
  }
  async function balanceUS() {
    let fk = '', nk = '', positions = [], summary = null;
    for (let page = 0; page < 5; page++) {
      const q = INQUIRY.balanceUS(cfg, fk, nk), { data, cont } = await call('GET', q.path, TR.balanceUS.vps, { params: q.params });
      positions.push(...(data.output1 || []).filter(x => num(x.ovrs_cblc_qty) > 0).map(x => { const p = usPosition(x); if (p.exchange) exchangeOf.set(p.symbol, p.exchange); return p; }));
      summary = data.output2 || summary;
      const more = nextPageKeys(data, cont, 200); if (!more) break; [fk, nk] = more;
    }
    let cashUsd = null;
    try { // 외화 예수금(있으면). 모의계좌는 통합증거금으로 원화만 있을 수 있어 실패해도 무시한다.
      const q = INQUIRY.presentUS(cfg), { data } = await call('GET', q.path, TR.presentUS.vps, { params: q.params }); cashUsd = usdCashOf(data);
    } catch { }
    const usCostKrw = usCostKrwOf(summary);
    return { positions, cashUsd, stockUsd: positions.reduce((a, p) => a + (p.value || 0), 0), usCostKrw, usCostUsd: positions.reduce((a, p) => a + (p.qty || 0) * (p.avgCost || 0), 0), summary };
  }
  async function buyingPowerUS(symbol, price) {
    const ex = exchangeOf.get(symbol) || (await priceUS(symbol)).exchange;
    const { data } = await call('GET', '/uapi/overseas-stock/v1/trading/inquire-psamount', TR.psblUS.vps, { params: { CANO: cfg.account, ACNT_PRDT_CD: cfg.product, OVRS_EXCG_CD: ex, OVRS_ORD_UNPR: price.toFixed(2), ITEM_CD: symbol } });
    const o = data.output || {}; return { code: symbol, market: 'US', exchange: ex, maxQty: num(o.max_ord_psbl_qty) ?? num(o.ovrs_max_ord_psbl_qty), cashQty: num(o.max_ord_psbl_qty) ?? num(o.ovrs_max_ord_psbl_qty), cashAmt: num(o.ovrs_ord_psbl_amt) ?? num(o.frcr_ord_psbl_amt1), ordCash: num(o.ovrs_ord_psbl_amt), fx: num(o.exrt) };
  }
  async function placeUS({ code, side, qty, price, exchange }) {
    const ex = exchange || exchangeOf.get(code) || (await priceUS(code)).exchange;
    const body = { CANO: cfg.account, ACNT_PRDT_CD: cfg.product, OVRS_EXCG_CD: ex, PDNO: code, ORD_QTY: String(qty), OVRS_ORD_UNPR: price.toFixed(2), CTAC_TLNO: '', MGCO_APTM_ODNO: '', SLL_TYPE: side === 'SELL' ? '00' : '', ORD_SVR_DVSN_CD: '0', ORD_DVSN: '00' };
    const send = tr => call('POST', '/uapi/overseas-stock/v1/trading/order', tr, { body });
    let res; try { res = await send(side === 'BUY' ? TR.buyUS.vps : TR.sellUS.vps); }
    catch (e) { if (side === 'SELL' && e.code !== 'network' && /tr_id|TR_ID|거래ID|존재하지/i.test(e.message || '')) res = await send(TR.sellUSAlt.vps); else throw e; }
    const o = res.data.output || {}; return { odno: o.ODNO || o.odno || null, orgno: o.KRX_FWDG_ORD_ORGNO || '', time: o.ORD_TMD || o.ord_tmd || null, msg: res.data.msg1 || '', exchange: ex };
  }
  async function cancelUS({ odno, code, exchange, qty = 0 }) {
    const ex = exchange || exchangeOf.get(code) || 'NASD';
    const { data } = await call('POST', '/uapi/overseas-stock/v1/trading/order-rvsecncl', TR.cancelUS.vps, { body: { CANO: cfg.account, ACNT_PRDT_CD: cfg.product, OVRS_EXCG_CD: ex, PDNO: code, ORGN_ODNO: odno, RVSE_CNCL_DVSN_CD: '02', ORD_QTY: String(qty || 0), OVRS_ORD_UNPR: '0', MGCO_APTM_ODNO: '', ORD_SVR_DVSN_CD: '0' } });
    const o = data.output || {}; return { odno: o.ODNO || o.odno || odno, msg: data.msg1 || '' };
  }
  // 주문·체결 목록은 거래소를 비우면 전체(NASD·NYSE·AMEX)가 온다(모의 서버 2026-11-12 확인). NASD 만 조회하던 때 NYSE·AMEX 체결 4건이 '목록에 없음'으로 소멸 처리됐다.
  // 빈 거래소 코드를 거부하는 서버면 거래소별로 세 번 조회해 합친다.
  async function ordersUSBy(dateYmd, excg) {
    let fk = '', nk = '', rows = [];
    for (let page = 0; page < 5; page++) {
      const q = INQUIRY.ordersUS(cfg, dateYmd, excg, fk, nk), { data, cont } = await call('GET', q.path, TR.dailyUS.vps, { params: q.params });
      rows.push(...(data.output || data.output1 || [])); const more = nextPageKeys(data, cont, 200); if (!more) break; [fk, nk] = more;
    }
    return rows;
  }
  async function ordersUS(dateYmd) {
    let rows;
    try { rows = await ordersUSBy(dateYmd, ''); }
    catch (e) { if (e.code === 'network') throw e; rows = []; for (const [ex] of US_EXCHANGES) rows.push(...await ordersUSBy(dateYmd, ex)); }
    return dedupeRows(rows).map(usOrderRow);
  }

  return {
    settings: () => ({ mode: cfg.mode, accountMasked: cfg.accountMasked, product: cfg.product, baseUrl: cfg.baseUrl }),
    price: symbol => isKrCode(symbol) ? priceKR(String(symbol).split('.')[0]) : priceUS(String(symbol).toUpperCase()),
    /** 국내+미국 잔고. cash 는 원화(결제 기준), cashUsd 는 외화 예수금(없으면 null). 미국 종목 value 는 달러. */
    async balance({ us = true } = {}) {
      const kr = await balanceKR(); let usb = { positions: [], cashUsd: null, stockUsd: 0, usCostKrw: null, usCostUsd: 0 }, usError = null;
      if (us) { try { usb = await balanceUS(); } catch (e) { usError = e.message; } }
      return { ...kr, positions: [...kr.positions, ...usb.positions], cashUsd: usb.cashUsd, stockUsd: usb.stockUsd, usCostKrw: usb.usCostKrw ?? null, usCostUsd: usb.usCostUsd || 0, usError, asOf: stamp() };
    },
    buyingPower: (symbol, price) => isKrCode(symbol) ? buyingPowerKR(String(symbol).split('.')[0], price) : buyingPowerUS(String(symbol).toUpperCase(), price),
    /** 지정가 현금 주문. 반환 {odno, orgno, time, exchange}. 서버가 주문을 받았는데 응답을 못 받으면 KisError(network) — 호출자가 '미확인'으로 기록하고 재조회해야 한다. */
    async place({ code, side, qty, price, exchange = null }) {
      if (!['BUY', 'SELL'].includes(side) || !Number.isInteger(qty) || qty <= 0 || !(price > 0)) throw new KisError('주문 값이 올바르지 않습니다.', 'bad_order', 400);
      return isKrCode(code) ? placeKR({ code: String(code).split('.')[0], side, qty, price }) : placeUS({ code: String(code).toUpperCase(), side, qty, price, exchange });
    },
    cancel: ({ odno, orgno = '', qty = 0, code = '', exchange = null, market = null }) => (market === 'US' || (!market && code && !isKrCode(code))) ? cancelUS({ odno, code, exchange, qty }) : cancelKR({ odno, orgno, qty }),
    /** 당일 주문·체결 목록(국내+미국). 상태: filled / partial / open / cancelled / rejected */
    async orders(dateYmd = ymd(), { us = true } = {}) { const kr = await ordersKR(dateYmd); if (!us) return kr; try { return [...kr, ...await ordersUS(dateYmd)]; } catch { return kr; } },
    exchangeOf: symbol => exchangeOf.get(symbol) || null
  };
}
