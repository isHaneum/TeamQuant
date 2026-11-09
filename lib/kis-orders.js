// 한국투자증권 모의투자(vps) 주문 클라이언트. 국내 주식 현금 지정가 주문·취소·당일 주문 조회·현재가·잔고·주문 가능 수량.
// 실전(prod) 모드에서는 이 클라이언트를 만들지 않는다(주문 경로에 실전 키가 올라가지 않도록). tr_id 는 공식 예제(koreainvestment/open-trading-api, 2026) 기준.
// 응답 필드 이름은 공식 예제가 명시하지 않은 것이 있어(일별 주문체결 output1), 관대하게 읽고 모르면 null 로 둔다.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export const KIS_HOSTS = { vps: 'https://openapivts.koreainvestment.com:29443', prod: 'https://openapi.koreainvestment.com:9443' };
export const TR = {
  price: 'FHKST01010100',
  buy: { vps: 'VTTC0012U', prod: 'TTTC0012U' }, sell: { vps: 'VTTC0011U', prod: 'TTTC0011U' }, cancel: { vps: 'VTTC0013U', prod: 'TTTC0013U' },
  daily: { vps: 'VTTC0081R', prod: 'TTTC0081R' }, psbl: { vps: 'VTTC8908R', prod: 'TTTC8908R' }, balance: { vps: 'VTTC8434R', prod: 'TTTC8434R' }
};
export class KisError extends Error { constructor(message, code = 'kis_error', status = 502) { super(message); this.name = 'KisError'; this.code = code; this.status = status; } }

export function kisSettings(env = process.env) {
  const mode = (env.KIS_MODE || 'vps').toLowerCase();
  const appKey = env.KIS_APP_KEY, appSecret = env.KIS_APP_SECRET, account = env.KIS_ACCOUNT_NO, product = env.KIS_ACCOUNT_PRODUCT_CODE || '01';
  return { mode, appKey, appSecret, account, product, baseUrl: KIS_HOSTS[mode] || KIS_HOSTS.vps, configured: Boolean(appKey && appSecret && /^\d{8}$/.test(account || '')), accountMasked: /^\d{8}$/.test(account || '') ? '****' + account.slice(-4) : null };
}

// KRX 호가 단위(2023-01 개편 뒤): 2천 미만 1원 · 5천 미만 5원 · 2만 미만 10원 · 5만 미만 50원 · 20만 미만 100원 · 50만 미만 500원 · 그 이상 1,000원
export function tickSize(price) { return price < 2000 ? 1 : price < 5000 ? 5 : price < 20000 ? 10 : price < 50000 ? 50 : price < 200000 ? 100 : price < 500000 ? 500 : 1000; }
export function roundTick(price, side = 'BUY') { const t = tickSize(price); return side === 'BUY' ? Math.floor(price / t) * t : Math.ceil(price / t) * t; }

/** 한국 정규장(평일 09:00~15:30 KST). 새 주문은 15:20 까지만 낸다(마감 동시호가 전). 반환 {open, reason, openAt(ISO), closeAt(ISO), kst} */
export function marketOpen(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 3600e3), day = kst.getUTCDay(), hm = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const ymd = kst.toISOString().slice(0, 10), at = (h, m) => new Date(Date.parse(`${ymd}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+09:00`)).toISOString();
  if (day === 0 || day === 6) return { open: false, reason: '주말에는 주문하지 않습니다.', openAt: at(9, 0), closeAt: at(15, 30), kst: kst.toISOString() };
  if (hm < 9 * 60) return { open: false, reason: '장 시작 전입니다(09:00 KST).', openAt: at(9, 0), closeAt: at(15, 30), kst: kst.toISOString() };
  if (hm >= 15 * 60 + 20) return { open: false, reason: hm >= 15 * 60 + 30 ? '장이 끝났습니다(15:30 KST).' : '마감 10분 전부터는 새 주문을 내지 않습니다.', openAt: at(9, 0), closeAt: at(15, 30), kst: kst.toISOString() };
  return { open: true, reason: '', openAt: at(9, 0), closeAt: at(15, 30), kst: kst.toISOString() };
}

const num = v => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : null; };

/**
 * 모의투자 클라이언트. fetch 를 주입할 수 있어 테스트는 네트워크 없이 돈다.
 * 모든 메서드는 실패하면 KisError 를 던진다(조용히 빈 값을 돌려주지 않는다 — 주문 엔진이 fail-closed 로 동작하기 위해).
 */
export function createKisClient({ env = process.env, fetch = globalThis.fetch, now = () => Date.now(), timeoutMs = 8000, tokenFile = null } = {}) {
  const cfg = kisSettings(env);
  if (!cfg.configured) throw new KisError('한투 키·모의계좌가 설정되지 않았습니다.', 'not_configured', 503);
  if (cfg.mode !== 'vps') throw new KisError('주문 클라이언트는 모의투자(KIS_MODE=vps)에서만 만듭니다. 실전 계좌 주문은 지원하지 않습니다.', 'live_forbidden', 403);
  // 토큰은 24시간 유효하고 발급은 1분당 1회로 제한된다. tokenFile 을 주면 프로세스가 달라도(CLI·서버) 같은 토큰을 다시 쓴다.
  let token = null;
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
  async function call(method, path, tr, { params = null, body = null } = {}, retryAuth = true) {
    const t = await auth(), url = `${cfg.baseUrl}${path}${params ? '?' + new URLSearchParams(params) : ''}`;
    let r; try { r = await fetch(url, { method, headers: { 'content-type': 'application/json; charset=utf-8', authorization: `Bearer ${t}`, appkey: cfg.appKey, appsecret: cfg.appSecret, tr_id: tr, custtype: 'P' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) }); }
    catch (e) { throw new KisError(`한투 서버 응답 없음 (${e.name === 'TimeoutError' ? '시간 초과' : e.message})`, 'network', 504); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.rt_cd !== '0') {
      // 토큰 만료·무효(EGW0012x)면 캐시를 버리고 한 번만 다시 발급해 재시도한다.
      if (retryAuth && /^EGW0012/.test(d.msg_cd || '')) { token = null; try { if (tokenFile) writeFileSync(tokenFile, '{}'); } catch { } return call(method, path, tr, { params, body }, false); }
      throw new KisError(d.msg1 || `KIS ${tr} 실패 (${r.status})`, d.msg_cd || 'kis_error', r.status >= 500 ? 502 : 400);
    }
    return { data: d, cont: r.headers?.get?.('tr_cont') || '' };
  }
  const ymd = (ms = now()) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
  return {
    settings: () => ({ mode: cfg.mode, accountMasked: cfg.accountMasked, product: cfg.product, baseUrl: cfg.baseUrl }),
    async price(code) {
      const { data } = await call('GET', '/uapi/domestic-stock/v1/quotations/inquire-price', TR.price, { params: { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: code } });
      const o = data.output || {};
      const price = num(o.stck_prpr); if (!(price > 0)) throw new KisError(`${code} 현재가를 받지 못했습니다.`, 'no_price', 502);
      return { code, price, open: num(o.stck_oprc), upper: num(o.stck_mxpr), lower: num(o.stck_llam), prevClose: num(o.stck_sdpr), halted: o.temp_stop_yn === 'Y', warn: o.mrkt_warn_cls_code || '00', name: o.hts_kor_isnm || null, asOf: new Date(now()).toISOString() };
    },
    async balance() {
      const base = { CANO: cfg.account, ACNT_PRDT_CD: cfg.product, AFHR_FLPR_YN: 'N', OFL_YN: '', INQR_DVSN: '00', UNPR_DVSN: '01', FUND_STTL_ICLD_YN: 'N', FNCG_AMT_AUTO_RDPT_YN: 'N', PRCS_DVSN: '00' };
      let fk = '', nk = '', positions = [], summary = null;
      for (let page = 0; page < 5; page++) {
        const { data, cont } = await call('GET', '/uapi/domestic-stock/v1/trading/inquire-balance', TR.balance.vps, { params: { ...base, CTX_AREA_FK100: fk, CTX_AREA_NK100: nk } });
        positions.push(...(data.output1 || []).filter(x => num(x.hldg_qty) > 0).map(x => ({ symbol: x.pdno, name: x.prdt_name, qty: num(x.hldg_qty), price: num(x.prpr), valueKrw: num(x.evlu_amt), avgCost: num(x.pchs_avg_pric), currency: 'KRW' })));
        summary = data.output2?.[0] || summary;
        if (!['F', 'M'].includes(cont)) break; fk = data.ctx_area_fk100 || ''; nk = data.ctx_area_nk100 || '';
      }
      // 예수금총금액(dnca_tot_amt)은 아직 결제되지 않은 당일 매수를 빼지 않는다(D+2). 쓸 수 있는 현금은 가수도정산금액(prvs_rcdl_excc_amt)이고,
      // 없으면 총평가 − 유가평가로 맞춘다. 그래야 산 직후에 다시 '살 돈이 있다'고 보지 않는다.
      const dnca = num(summary?.dnca_tot_amt), d2 = num(summary?.prvs_rcdl_excc_amt), total = num(summary?.tot_evlu_amt), scts = num(summary?.scts_evlu_amt);
      const cash = d2 ?? (total !== null && scts !== null ? total - scts : dnca);
      if (cash === null) throw new KisError('예수금을 읽지 못했습니다.', 'no_cash', 502);
      return { cash, cashRaw: dnca, total: total ?? cash + positions.reduce((a, p) => a + (p.valueKrw || 0), 0), stock: positions.reduce((a, p) => a + (p.valueKrw || 0), 0), positions, asOf: new Date(now()).toISOString() };
    },
    async buyingPower(code, price) {
      const { data } = await call('GET', '/uapi/domestic-stock/v1/trading/inquire-psbl-order', TR.psbl.vps, { params: { CANO: cfg.account, ACNT_PRDT_CD: cfg.product, PDNO: code, ORD_UNPR: String(price), ORD_DVSN: '00', CMA_EVLU_AMT_ICLD_YN: 'N', OVRS_ICLD_YN: 'N' } });
      const o = data.output || {}; return { code, maxQty: num(o.max_buy_qty), cashQty: num(o.nrcvb_buy_qty), cashAmt: num(o.nrcvb_buy_amt), ordCash: num(o.ord_psbl_cash) };
    },
    /** 지정가 현금 주문. 반환 {odno, orgno, time}. 서버가 주문을 받았는데 응답을 못 받으면 KisError(network) — 호출자가 '미확인'으로 기록하고 재조회해야 한다. */
    async place({ code, side, qty, price }) {
      if (!['BUY', 'SELL'].includes(side) || !Number.isInteger(qty) || qty <= 0 || !(price > 0)) throw new KisError('주문 값이 올바르지 않습니다.', 'bad_order', 400);
      const { data } = await call('POST', '/uapi/domestic-stock/v1/trading/order-cash', TR[side === 'BUY' ? 'buy' : 'sell'].vps, { body: { CANO: cfg.account, ACNT_PRDT_CD: cfg.product, PDNO: code, ORD_DVSN: '00', ORD_QTY: String(qty), ORD_UNPR: String(Math.round(price)), EXCG_ID_DVSN_CD: 'KRX', SLL_TYPE: side === 'SELL' ? '01' : '', CNDT_PRIC: '' } });
      const o = data.output || {}; return { odno: o.ODNO || o.odno || null, orgno: o.KRX_FWDG_ORD_ORGNO || o.krx_fwdg_ord_orgno || '', time: o.ORD_TMD || o.ord_tmd || null, msg: data.msg1 || '' };
    },
    async cancel({ odno, orgno = '', qty = 0 }) {
      const { data } = await call('POST', '/uapi/domestic-stock/v1/trading/order-rvsecncl', TR.cancel.vps, { body: { CANO: cfg.account, ACNT_PRDT_CD: cfg.product, KRX_FWDG_ORD_ORGNO: orgno || '', ORGN_ODNO: odno, ORD_DVSN: '00', RVSE_CNCL_DVSN_CD: '02', ORD_QTY: String(qty || 0), ORD_UNPR: '0', QTY_ALL_ORD_YN: qty ? 'N' : 'Y', EXCG_ID_DVSN_CD: 'KRX' } });
      const o = data.output || {}; return { odno: o.ODNO || o.odno || odno, msg: data.msg1 || '' };
    },
    /** 당일(또는 지정일) 주문·체결 목록. 상태: filled / partial / open / cancelled */
    async orders(dateYmd = ymd()) {
      const base = { CANO: cfg.account, ACNT_PRDT_CD: cfg.product, INQR_STRT_DT: dateYmd, INQR_END_DT: dateYmd, SLL_BUY_DVSN_CD: '00', INQR_DVSN: '00', PDNO: '', CCLD_DVSN: '00', ORD_GNO_BRNO: '', ODNO: '', INQR_DVSN_3: '00', INQR_DVSN_1: '' };
      let fk = '', nk = '', rows = [];
      for (let page = 0; page < 5; page++) {
        const { data, cont } = await call('GET', '/uapi/domestic-stock/v1/trading/inquire-daily-ccld', TR.daily.vps, { params: { ...base, CTX_AREA_FK100: fk, CTX_AREA_NK100: nk } });
        rows.push(...(data.output1 || [])); if (!['F', 'M'].includes(cont)) break; fk = data.ctx_area_fk100 || ''; nk = data.ctx_area_nk100 || '';
      }
      return rows.map(x => { const qty = num(x.ord_qty) || 0, filled = num(x.tot_ccld_qty) || 0, remaining = num(x.rmn_qty) ?? Math.max(0, qty - filled), cancelled = x.cncl_yn === 'Y' || (num(x.cncl_cfrm_qty) || 0) > 0;
        return { odno: x.odno || null, orgno: x.ord_gno_brno || '', code: x.pdno || null, name: x.prdt_name || null, side: x.sll_buy_dvsn_cd === '02' ? 'BUY' : x.sll_buy_dvsn_cd === '01' ? 'SELL' : (x.sll_buy_dvsn_cd_name || '').includes('매수') ? 'BUY' : 'SELL', qty, filled, remaining, price: num(x.ord_unpr), avgPrice: num(x.avg_prvs), time: x.ord_tmd || null, cancelled, status: cancelled ? 'cancelled' : filled >= qty && qty > 0 ? 'filled' : filled > 0 ? 'partial' : 'open' }; });
    }
  };
}
