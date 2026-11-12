// 한국투자증권 실전(prod) 계좌 읽기 전용 리더(PC 서버 전용 · 2026-11-12 결정 22). 잔고(국내·미국·외화예수금)와 하루 주문·체결 목록만 조회한다.
// 이 모듈에는 주문·취소 요청이 존재하지 않는다: 내부 call() 은 GET 이 아니면 던지고(guardMethod), 반환 객체는 settings/balance/orders 셋만 노출한다.
// 왜 따로 두나: "검증"은 실계좌 조회만을 뜻한다. 주문은 이 코드베이스에서 영원히 모의계좌(lib/kis-orders.js, vps 전용)에서만 나가고, 실전 키는 조회 경로 밖으로 나가지 않는다(process.env 에도 올리지 않음 · lib/key-files.js kisReadOnlySettings).
// 요청 모양·응답 해석은 kis-orders.js 의 INQUIRY/krSummary/usdCashOf… 를 그대로 쓰고 tr_id 만 prod 를 쓴다. 토큰은 모의 토큰과 다른 파일(kis-prod-token.json)에 캐시한다. 값(키·토큰·계좌번호)은 어디에도 출력하지 않는다.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { KIS_HOSTS, TR, US_EXCHANGES, KisError, INQUIRY, nextPageKeys, krPosition, usPosition, krSummary, usdCashOf, usCostKrwOf, krOrderRow, usOrderRow, dedupeRows } from './kis-orders.js';

export const KIS_READER_VERSION = 'RO1-2026-11-12';
/** 실계좌 총자산 정의의 단서. 모의계좌의 정산 전 매수대금 보정(settleUs)은 쓰지 않는다 — 실계좌(통합증거금)는 D+1 자동 환전으로 예수금이 실제로 줄어들기 때문에 그 사이 하루만 과대 평가될 수 있다(아직 실제 매수로 확인하지 않음). */
export const REAL_BALANCE_NOTE = '실계좌는 증권사 평가 그대로. 통합증거금으로 원화로 산 미국 주식은 D+1 정산 전까지 과대 평가될 수 있음(2026-11-12 미검증)';
/** 읽기 전용 보호: 조회(GET)가 아닌 어떤 요청도 만들 수 없다. call() 이 매번 부른다. */
export function guardMethod(method) { if (method !== 'GET') throw new KisError('실계좌 리더는 조회(GET)만 합니다. 주문·취소 요청은 만들 수 없습니다.', 'read_only', 403); }

const num = v => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : null; };

/**
 * @param settings  lib/key-files.js kisReadOnlySettings() 결과(configured 여야 함). 호출자가 모의 설정을 잘못 넘겨도 호스트·tr_id 는 무조건 prod 다.
 * @param fetch     주입 가능(테스트는 네트워크 없이 돈다)
 * @param tokenFile 토큰 캐시 파일(kis-prod-token.json). 모의 토큰 파일과 이름이 다르다. 계좌는 가린 번호로만 적는다.
 * @param minGapMs  호출 간격(실전 서버는 초당 20건까지라 300ms 면 충분하다)
 */
export function createKisReader({ settings, fetch = globalThis.fetch, now = () => Date.now(), timeoutMs = 8000, tokenFile = null, minGapMs = 300, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const cfg = { appKey: settings?.appKey, appSecret: settings?.appSecret, account: settings?.account, product: settings?.product || '01', accountMasked: settings?.accountMasked || null, baseUrl: KIS_HOSTS.prod };
  if (!(settings?.configured && cfg.appKey && cfg.appSecret && /^\d{8}$/.test(cfg.account || ''))) throw new KisError('실계좌 읽기 전용 설정(KIS_REAL_READONLY=1 · 키 파일의 실전 이름표)이 없습니다.', 'not_configured', 503);
  let token = null, lastCallAt = 0;
  async function pace() { const wait = lastCallAt + minGapMs - Date.now(); if (wait > 0) await sleep(wait); lastCallAt = Date.now(); }
  const readTokenFile = () => { if (!tokenFile) return null; try { const t = JSON.parse(readFileSync(tokenFile, 'utf8')); return t && t.mode === 'prod' && t.account === cfg.accountMasked && t.expiresAt > now() + 60_000 ? t : null; } catch { return null; } };
  const writeTokenFile = t => { if (!tokenFile) return; try { mkdirSync(dirname(tokenFile), { recursive: true }); writeFileSync(tokenFile, JSON.stringify({ mode: 'prod', account: cfg.accountMasked, value: t.value, expiresAt: t.expiresAt })); } catch { } };
  // 토큰 발급은 유일한 POST 이고 /oauth2/tokenP 로만 간다(call() 을 거치지 않는다). 24시간 유효·1분당 1회라 파일에 캐시한다.
  async function auth() {
    if (token && token.expiresAt > now() + 60_000) return token.value;
    const cached = readTokenFile(); if (cached) { token = cached; return token.value; }
    const r = await fetch(`${cfg.baseUrl}/oauth2/tokenP`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'client_credentials', appkey: cfg.appKey, appsecret: cfg.appSecret }), signal: AbortSignal.timeout(timeoutMs) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.access_token) throw new KisError((d.error_description || d.msg1 || `토큰 발급 실패 (${r.status})`) + (/1분당/.test(d.error_description || '') ? ' — 1분 뒤 다시 시도하십시오.' : ''), 'auth_failed', 502);
    token = { value: d.access_token, expiresAt: now() + Math.max(300, Number(d.expires_in || 86400)) * 1000 - 3600e3 }; writeTokenFile(token); return token.value;
  }
  async function call(method, path, tr, { params = null } = {}, retryAuth = true, retryRate = true) {
    guardMethod(method);
    const t = await auth(); await pace(); const url = `${cfg.baseUrl}${path}${params ? '?' + new URLSearchParams(params) : ''}`;
    let r; try { r = await fetch(url, { method: 'GET', headers: { 'content-type': 'application/json; charset=utf-8', authorization: `Bearer ${t}`, appkey: cfg.appKey, appsecret: cfg.appSecret, tr_id: tr, custtype: 'P' }, signal: AbortSignal.timeout(timeoutMs) }); }
    catch (e) { throw new KisError(`한투 서버 응답 없음 (${e.name === 'TimeoutError' ? '시간 초과' : e.message})`, 'network', 504); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.rt_cd !== '0') {
      if (retryAuth && /^EGW0012/.test(d.msg_cd || '')) { token = null; try { if (tokenFile) writeFileSync(tokenFile, '{}'); } catch { } return call(method, path, tr, { params }, false); }
      if (retryRate && /초당 거래건수|EGW00201/.test((d.msg1 || '') + (d.msg_cd || ''))) { await sleep(minGapMs + 400); return call(method, path, tr, { params }, retryAuth, false); }
      throw new KisError(d.msg1 || `KIS ${tr} 실패 (${r.status})`, d.msg_cd || 'kis_error', r.status >= 500 ? 502 : 400);
    }
    return { data: d, cont: r.headers?.get?.('tr_cont') || '' };
  }
  const stamp = () => new Date(now()).toISOString();

  async function balanceKR() {
    let fk = '', nk = '', positions = [], summary = null;
    for (let page = 0; page < 5; page++) {
      const q = INQUIRY.balanceKR(cfg, fk, nk), { data, cont } = await call('GET', q.path, TR.balance.prod, { params: q.params });
      positions.push(...(data.output1 || []).filter(x => num(x.hldg_qty) > 0).map(krPosition));
      summary = data.output2?.[0] || summary;
      const more = nextPageKeys(data, cont, 100); if (!more) break; [fk, nk] = more;
    }
    const s = krSummary(summary, positions);
    if (s.cash === null) throw new KisError('예수금을 읽지 못했습니다.', 'no_cash', 502);
    return { ...s, positions };
  }
  async function balanceUS() {
    let fk = '', nk = '', positions = [], summary = null;
    for (let page = 0; page < 5; page++) {
      const q = INQUIRY.balanceUS(cfg, fk, nk), { data, cont } = await call('GET', q.path, TR.balanceUS.prod, { params: q.params });
      positions.push(...(data.output1 || []).filter(x => num(x.ovrs_cblc_qty) > 0).map(usPosition));
      summary = data.output2 || summary;
      const more = nextPageKeys(data, cont, 200); if (!more) break; [fk, nk] = more;
    }
    let cashUsd = null, cashUsdError = null;
    // 외화예수금 조회 실패는 삼키지 않고 표시한다 — 실계좌의 외화예수금은 자산이라 빠지면 총자산이 조용히 과소 평가된다(모의 클라이언트는 외화가 없을 수 있어 삼기지만 여기선 호출자가 보류를 정한다 · 2026-11-12 검토).
    try { const q = INQUIRY.presentUS(cfg), { data } = await call('GET', q.path, TR.presentUS.prod, { params: q.params }); cashUsd = usdCashOf(data); } catch (e) { cashUsdError = e.code || 'present_failed'; }
    return { positions, cashUsd, cashUsdError, stockUsd: positions.reduce((a, p) => a + (p.value || 0), 0), usCostKrw: usCostKrwOf(summary) };
  }
  async function ordersKR(dateYmd) {
    let fk = '', nk = '', rows = [];
    for (let page = 0; page < 5; page++) {
      const q = INQUIRY.ordersKR(cfg, dateYmd, fk, nk), { data, cont } = await call('GET', q.path, TR.daily.prod, { params: q.params });
      rows.push(...(data.output1 || [])); const more = nextPageKeys(data, cont, 100); if (!more) break; [fk, nk] = more;
    }
    return rows.map(krOrderRow);
  }
  async function ordersUSBy(dateYmd, excg) {
    let fk = '', nk = '', rows = [];
    for (let page = 0; page < 5; page++) {
      const q = INQUIRY.ordersUS(cfg, dateYmd, excg, fk, nk), { data, cont } = await call('GET', q.path, TR.dailyUS.prod, { params: q.params });
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
    settings: () => ({ mode: 'prod', readOnly: true, accountMasked: cfg.accountMasked, product: cfg.product, baseUrl: cfg.baseUrl, version: KIS_READER_VERSION }),
    /**
     * 국내+미국 잔고(증권사 평가 그대로 · 모의계좌의 정산 전 매수대금 보정은 쓰지 않는다 — REAL_BALANCE_NOTE).
     * cash = 원화 예수금(가수도정산 ?? 총평가−유가 ?? 예수금총액), stock = 국내 주식 평가, cashUsd = 외화예수금, stockUsd = 미국 주식 평가(달러), usCostKrw = 미국 매입금액(원화 환산 · 참고용).
     * total = tot_evlu_amt(증권사 국내 총평가 · 가수도정산 전에는 cash + stock 과 다를 수 있다) + stockUsd×fx + cashUsd×fx. fx 는 호출자가 넘긴다(야후 KRW=X). 해외 자산이 있는데 fx 가 없으면 total 은 null.
     * usError(미국 잔고 조회 실패)·cashUsdError(외화예수금 조회 실패)가 있으면 total 은 그 다리가 빠진 값이다 — 평가 보류는 호출자(real-record)가 정한다.
     */
    async balance({ fx = null } = {}) {
      const kr = await balanceKR(); let us = { positions: [], cashUsd: null, cashUsdError: null, stockUsd: 0, usCostKrw: null }, usError = null;
      try { us = await balanceUS(); } catch (e) { usError = e.code || 'us_failed'; }
      const stockUsd = us.stockUsd || 0, cashUsd = us.cashUsd || 0, usd = stockUsd + cashUsd, rate = fx > 0 ? fx : null;
      const positions = [...kr.positions, ...us.positions.map(p => ({ ...p, valueKrw: rate ? Math.round((p.value || 0) * rate) : null }))];
      return { cash: kr.cash, cashRaw: kr.cashRaw, stock: kr.stock, totalKrwOnly: kr.total, stockUsd, cashUsd: us.cashUsd, usCostKrw: us.usCostKrw ?? null, fx: rate, total: usd > 0 && !rate ? null : Math.round(kr.total + usd * (rate || 0)), stockKrw: rate ? Math.round(kr.stock + stockUsd * rate) : (usd > 0 ? null : kr.stock), positions, usError, cashUsdError: us.cashUsdError || null, note: REAL_BALANCE_NOTE, asOf: stamp() };
    },
    /** 그날(YYYYMMDD) 주문·체결 목록(국내+미국). 실계좌 주문은 사용자가 증권사 앱에서 낸 것이고 여기서는 읽기만 한다. 미국 목록 조회 실패는 국내만 돌려준다. */
    async orders(dateYmd) { if (!/^\d{8}$/.test(String(dateYmd || ''))) throw new KisError('조회 날짜(YYYYMMDD)가 필요합니다.', 'bad_date', 400); const kr = await ordersKR(dateYmd); try { return [...kr, ...await ordersUS(dateYmd)]; } catch { return kr; } }
  };
}
