// 키 파일 적재(PC 서버 전용). .env.local 에는 키 값 대신 파일 경로만 두고, 서버가 시작할 때 파일에서 읽어 환경 변수로 올린다.
//   DART_KEY_FILE  → DART_API_KEY           (한 줄짜리 키, 또는 key=값)
//   KIS_KEY_FILE   → KIS_APP_KEY / KIS_APP_SECRET / KIS_ACCOUNT_NO / KIS_ACCOUNT_PRODUCT_CODE
// 한투 키 파일은 실전 키와 모의 키를 한 파일에 둘 수 있다(이름표로 구분). KIS_MODE 가 vps(모의)면 모의 이름표(simul*/paper*/vts*)만 쓰고,
// 모의 키가 없으면 실전 키로 대신하지 않는다(실수로 실전 키가 주문 경로에 올라가는 일을 막는다). 값은 어디에도 출력하지 않는다.
import { readFileSync } from 'node:fs';

const norm = k => String(k).replace(/^﻿/, '').trim().toLowerCase().replace(/[\s_\-]/g, '');
const unquote = v => String(v).trim().replace(/^["']|["']$/g, '');

/** 텍스트를 {map:{이름표(정규화)→값}, bare:[이름표 없는 줄]} 로 나눈다. '#' 줄은 무시. */
export function parseKeyFile(text = '') {
  const map = {}, bare = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/^﻿/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([^=:]{1,60})[=:](.*)$/);
    if (m && unquote(m[2])) map[norm(m[1])] = unquote(m[2]); else bare.push(line);
  }
  return { map, bare };
}

const PAPER_KEY = ['simulappkey', 'simulkey', 'paperappkey', 'paperkey', 'vtsappkey', 'vtskey', 'kispaperappkey', 'mockappkey'];
const PAPER_SEC = ['simulappsecret', 'simulsecret', 'simulapp', 'paperappsecret', 'papersecret', 'vtsappsecret', 'vtssecret', 'kispaperappsecret', 'mockappsecret'];
const PAPER_ACC = ['simulaccount', 'simulaccountno', 'simulcano', 'paperaccount', 'paperaccountno', 'vtsaccount', 'kispaperaccountno', 'mockaccount'];
const LIVE_KEY = ['appkey', 'kisappkey', 'key', 'realappkey', 'prodappkey'];
const LIVE_SEC = ['appsecret', 'kisappsecret', 'app', 'secret', 'realappsecret', 'prodappsecret'];
const LIVE_ACC = ['kisaccountno', 'accountno', 'account', 'cano', 'realaccount', 'prodaccount'];
const PRODUCT = ['kisaccountproductcode', 'productcode', 'product', 'acntprdtcd'];
const pick = (map, names) => { for (const n of names) if (map[n]) return map[n]; return null; };
const looksKey = v => /^[A-Za-z0-9_\-]{30,40}$/.test(v), looksSecret = v => /^[A-Za-z0-9+/=_\-]{100,260}$/.test(v), looksAcc = v => /^\d{8}$/.test(v);

/** 한투 키 파일에서 mode('vps'|'prod')에 맞는 한 벌만 고른다. 값은 반환 객체에만 있고 로그로 내지 않는다. */
export function pickKisSet(parsed, mode = 'vps') {
  const { map, bare } = parsed;
  const out = { appKey: null, appSecret: null, account: null, product: pick(map, PRODUCT) || null, source: null };
  if (mode === 'vps') { out.appKey = pick(map, PAPER_KEY); out.appSecret = pick(map, PAPER_SEC); out.account = pick(map, PAPER_ACC); out.source = out.appKey ? 'paper-labels' : null; }
  else { out.appKey = pick(map, LIVE_KEY); out.appSecret = pick(map, LIVE_SEC); out.account = pick(map, LIVE_ACC); out.source = out.appKey ? 'live-labels' : null; }
  // 이름표가 전혀 없는 파일(줄만 나열)은 길이로 추정한다. 어느 모드의 키인지 알 수 없으므로 파일에 mode=... 줄이 있을 때만 받는다.
  if (!out.appKey && bare.length && (map.mode || map.kismode) && norm(map.mode || map.kismode) === mode) {
    out.appKey = bare.find(looksKey) || null; out.appSecret = bare.find(looksSecret) || null; out.account = bare.find(looksAcc) || null; out.source = 'bare-lines';
  }
  return out;
}

/**
 * 환경 변수에 적힌 키 파일을 읽어 환경 변수를 채운다. 이미 값이 있는 변수는 덮어쓰지 않는다.
 * 반환: 값이 없는 요약 { dart:{configured, from}, kis:{mode, configured, accountMasked, from, reason} }
 */
export function applyKeyFiles(env = process.env, { readFile = p => readFileSync(p, 'utf8') } = {}) {
  const summary = { dart: { configured: Boolean(env.DART_API_KEY), from: env.DART_API_KEY ? 'env' : null }, kis: { mode: (env.KIS_MODE || 'vps').toLowerCase(), configured: false, accountMasked: null, from: null, reason: null } };
  if (!env.DART_API_KEY && env.DART_KEY_FILE) {
    try {
      const p = parseKeyFile(readFile(env.DART_KEY_FILE));
      const v = pick(p.map, ['dartapikey', 'dart', 'crtfckey', 'key', 'apikey']) || p.bare.find(x => /^[a-f0-9]{40}$/i.test(x)) || null;
      if (v) { env.DART_API_KEY = v; summary.dart = { configured: true, from: 'file' }; } else summary.dart.reason = 'DART 키 파일에서 40자리 키를 찾지 못했습니다.';
    } catch { summary.dart.reason = 'DART 키 파일을 읽지 못했습니다.'; }
  }
  const mode = summary.kis.mode;
  if (env.KIS_KEY_FILE && !(env.KIS_APP_KEY && env.KIS_APP_SECRET)) {
    try {
      const set = pickKisSet(parseKeyFile(readFile(env.KIS_KEY_FILE)), mode);
      if (set.appKey && set.appSecret) {
        env.KIS_APP_KEY = set.appKey; env.KIS_APP_SECRET = set.appSecret; summary.kis.from = 'file:' + set.source;
        const acc = mode === 'vps' ? (env.KIS_PAPER_ACCOUNT_NO || set.account) : (set.account || env.KIS_ACCOUNT_NO);
        if (acc) env.KIS_ACCOUNT_NO = acc;
        if (!env.KIS_ACCOUNT_PRODUCT_CODE && set.product) env.KIS_ACCOUNT_PRODUCT_CODE = set.product;
      } else summary.kis.reason = mode === 'vps' ? '키 파일에 모의투자 키(simulappkey / simulappsecret)가 없습니다. 실전 키로 대신하지 않습니다.' : '키 파일에 실전 키(appkey / appsecret)가 없습니다.';
    } catch { summary.kis.reason = '한투 키 파일을 읽지 못했습니다.'; }
  }
  if (mode === 'vps' && env.KIS_PAPER_ACCOUNT_NO && !env.KIS_ACCOUNT_NO) env.KIS_ACCOUNT_NO = env.KIS_PAPER_ACCOUNT_NO;
  if (mode === 'vps' && env.KIS_PAPER_ACCOUNT_NO) env.KIS_ACCOUNT_NO = env.KIS_PAPER_ACCOUNT_NO; // 모의 모드에서는 모의계좌 번호가 우선
  const acc = env.KIS_ACCOUNT_NO || '';
  summary.kis.configured = Boolean(env.KIS_APP_KEY && env.KIS_APP_SECRET && /^\d{8}$/.test(acc));
  summary.kis.accountMasked = /^\d{8}$/.test(acc) ? '****' + acc.slice(-4) : null;
  if (!summary.kis.configured && !summary.kis.reason) summary.kis.reason = env.KIS_KEY_FILE || env.KIS_APP_KEY ? (acc ? '계좌번호가 8자리가 아닙니다.' : (mode === 'vps' ? 'KIS_PAPER_ACCOUNT_NO(모의계좌 8자리)가 없습니다.' : 'KIS_ACCOUNT_NO가 없습니다.')) : 'KIS_KEY_FILE 또는 KIS_APP_KEY가 없습니다.';
  return summary;
}

/**
 * 실계좌 읽기 전용 설정(2026-11-12 결정 22). KIS_REAL_READONLY=1 일 때만 같은 키 파일의 실전 이름표(appkey/app/KIS_ACCOUNT_NO)를 고른다.
 * process.env 에는 아무것도 쓰지 않는다 — 엔진의 env 는 모의 한 벌만 가져야 하고(실전 키가 주문 경로의 환경 변수에 올라가지 않게), 이 값은 조회 전용 리더(lib/kis-reader.js)에만 넘긴다.
 * 계좌번호는 키 파일의 실전 이름표에서만 읽는다(env.KIS_ACCOUNT_NO 는 모의 모드에서 모의계좌 번호가 들어 있으므로 쓰지 않는다). 값은 반환 객체에만 있고 로그로 내지 않는다.
 * 반환: { configured, appKey, appSecret, account, product, accountMasked, reason } — configured 가 아니면 값은 모두 null.
 */
export function kisReadOnlySettings(env = process.env, { readFile = p => readFileSync(p, 'utf8') } = {}) {
  const off = reason => ({ configured: false, appKey: null, appSecret: null, account: null, product: null, accountMasked: null, reason });
  if (env.KIS_REAL_READONLY !== '1') return off('KIS_REAL_READONLY=1 이 아니라 실계좌 조회를 켜지 않습니다.');
  if (!env.KIS_KEY_FILE) return off('KIS_KEY_FILE 이 없습니다.');
  let set; try { set = pickKisSet(parseKeyFile(readFile(env.KIS_KEY_FILE)), 'prod'); } catch { return off('한투 키 파일을 읽지 못했습니다.'); }
  if (!(set.appKey && set.appSecret)) return off('키 파일에 실전 키(appkey / appsecret)가 없습니다.');
  if (!/^\d{8}$/.test(set.account || '')) return off('키 파일에 실전 계좌번호(KIS_ACCOUNT_NO 8자리)가 없습니다.');
  return { configured: true, appKey: set.appKey, appSecret: set.appSecret, account: set.account, product: set.product || '01', accountMasked: '****' + set.account.slice(-4), reason: null };
}
