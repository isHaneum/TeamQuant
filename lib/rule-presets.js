// 세 질문으로 규칙 만들기: "한 달에 얼마까지 잃어도 견디나 · 몇 개 섹터로 나눌까 · 얼마나 자주 볼까" → 규칙 C3 의 숫자와 섹터 상한·점검 주기.
// 숫자 사이의 관계는 아래에 적힌 대로이고 예측이 아니다. 사용자가 바꾼 세부 숫자는 그대로 둔다(프리셋은 시작점).
import { normalizeRules, DEFAULT_RULES } from './core-rules.js';

export const PRESET_VERSION = 'Q3-2026-11-09';
export const LOSS_OPTIONS = [
  { id: 5, label: '한 달에 5%까지', desc: '보수적. 급락장에서도 계좌가 크게 흔들리지 않게 비중을 낮게 둡니다.' },
  { id: 10, label: '한 달에 10%까지', desc: '보통. 코스피가 20% 빠질 때 절반쯤 따라가는 수준입니다.' },
  { id: 20, label: '한 달에 20%까지', desc: '공격적. 지수만큼 흔들리는 것을 받아들입니다.' }
];
export const SECTOR_OPTIONS = [
  { id: 3, label: '3개 안팎', cap: 40, desc: '집중. 한 섹터가 40%까지. 한 사건에 많이 걸립니다.' },
  { id: 5, label: '5개 안팎', cap: 30, desc: '보통. 한 섹터 30%까지.' },
  { id: 8, label: '8개 이상', cap: 20, desc: '분산. 한 섹터 20%까지. 지수에 가까워집니다.' }
];
export const CADENCE_OPTIONS = [
  { id: 'weekly', label: '주 1회', trades30: 8, desc: '그 주 마지막 거래일 종가에 맞춥니다. 30일 매매 결정 8회(재조정 묶음은 1회로 셈 · 주문 건수는 따로 표시).' },
  { id: 'monthly', label: '월 1회', trades30: 4, desc: '달의 첫 거래일에 맞춥니다. 30일 매매 결정 4회. 비용·감정 개입이 가장 적습니다.' },
  { id: 'urgent', label: '급할 때만', trades30: 3, desc: '하루 손실 한도 1.25배 초과·한 종목 상한 1.2배 초과·레버리지 보유일 때만 움직입니다. 30일 매매 결정 3회.' }
];
const r1 = v => Math.round(v * 10) / 10;

/**
 * prefs {lossMonthly:5|10|20, sectors:3|5|8, cadence:'weekly'|'monthly'|'urgent'} → { rules, sectorCap, cadence, explain:[...] }
 * - 하루 손실 한도 = 월 허용 손실 ÷ √21 (한 달 ≈ 21거래일, 손실이 날마다 독립이라는 거친 가정)
 * - 종목 변동성 목표(연) = 하루 손실 한도 × √252 ÷ 1.645 (95% 한 쪽 꼬리)
 * - 한 종목 최대 비중 = 섹터 수에 따라 25 / 20 / 15 — 섹터 상한의 절반~2/3 안쪽
 * - 현금 최소 = 허용 손실이 작을수록 크게 20 / 10 / 5
 * - 30일 매매 상한 = 점검 주기에 따라 8 / 4 / 3
 */
export function presetRules(prefs = {}) {
  const loss = LOSS_OPTIONS.find(o => o.id === Number(prefs.lossMonthly)) || LOSS_OPTIONS[1];
  const sec = SECTOR_OPTIONS.find(o => o.id === Number(prefs.sectors)) || SECTOR_OPTIONS[1];
  const cad = CADENCE_OPTIONS.find(o => o.id === prefs.cadence) || CADENCE_OPTIONS[0];
  const dailyLoss = Math.max(0.5, r1(loss.id / Math.sqrt(21)));
  const volTarget = Math.max(5, Math.round(dailyLoss / 100 * Math.sqrt(252) / 1.645 * 100));
  const maxSingle = sec.id <= 3 ? 25 : sec.id <= 5 ? 20 : 15;
  const minCash = loss.id <= 5 ? 20 : loss.id <= 10 ? 10 : 5;
  const { rules } = normalizeRules({ ...DEFAULT_RULES, dailyLoss, volTarget, maxSingle, minCash, maxTrades30: cad.trades30, trendUS: true, letWinnersRun: true, noLeverage: true, perAssetVol: false });
  const explain = [
    `하루 손실 한도 ${dailyLoss}% — 한 달 ${loss.id}% ÷ √21거래일`,
    `한 종목 최대 ${maxSingle}% · 한 섹터 최대 ${sec.cap}% — ${sec.label}로 나누기`,
    `현금 최소 ${minCash}% — 급락 때 팔지 않고 버틸 돈`,
    `30일 매매 ${cad.trades30}회 · ${cad.label} 점검`,
    '미국 종목 200일선 규칙 · 레버리지 금지 · 오른 종목은 상한까지 두기 (기본 유지)'
  ];
  return { version: PRESET_VERSION, prefs: { lossMonthly: loss.id, sectors: sec.id, cadence: cad.id }, rules, sectorCap: sec.cap, cadence: cad.id, explain };
}

/** 지금 규칙이 어느 프리셋에 가장 가까운지(화면에서 선택 상태를 되살릴 때). 정확히 같지 않으면 custom:true */
export function nearestPreset(rules = {}) {
  let best = null;
  for (const l of LOSS_OPTIONS) for (const s of SECTOR_OPTIONS) for (const c of CADENCE_OPTIONS) {
    const p = presetRules({ lossMonthly: l.id, sectors: s.id, cadence: c.id });
    const d = Math.abs((p.rules.dailyLoss - (rules.dailyLoss ?? 0)) / 2.5) + Math.abs((p.rules.maxSingle - (rules.maxSingle ?? 0)) / 25) + Math.abs((p.rules.minCash - (rules.minCash ?? 0)) / 10) + Math.abs((p.rules.maxTrades30 - (rules.maxTrades30 ?? 0)) / 8);
    if (!best || d < best.d) best = { d, prefs: p.prefs };
  }
  return { ...best.prefs, custom: best.d > 0.05 };
}

/**
 * 기록으로 규칙 점검(측정이지 예측이 아니다). status = paper-live status(marks, ordersToday/recentOrders, runs, auto), rules = 지금 규칙.
 * 반환: { days, change, dailyBreaches, trades30, cashAvgPct, blockedTop, findings:[{key, tone, text, suggest}] }
 */
export function reviewRules(status = {}, rules = DEFAULT_RULES, { orders = null, indexPct = null } = {}) {
  const marks = (status.marks || []).filter(m => m.total > 0), all = orders || status.recentOrders || [];
  const days = marks.length, first = marks[0], last = marks.at(-1);
  const change = first && last ? last.total / first.total - 1 : null;
  let dailyBreaches = 0, worstDay = 0; for (let i = 1; i < marks.length; i++) { const r = marks[i].total / marks[i - 1].total - 1; if (r < worstDay) worstDay = r; if (r < -rules.dailyLoss / 100) dailyBreaches++; }
  const cashAvgPct = days ? marks.reduce((a, m) => a + (m.cash / m.total) * 100, 0) / days : null;
  const now = Date.now(), recent = all.filter(o => now - Date.parse(o.at) < 30 * 864e5 && ['filled', 'partial'].includes(o.status));
  const trades30 = status.activity30?.decisions ?? (recent.filter(o => !o.batch).length + new Set(recent.filter(o => o.batch).map(o => o.batch)).size);
  const act = status.activity30 || { orders: all.filter(o => now - Date.parse(o.at) < 30 * 864e5 && o.status !== 'rejected').length, fills: recent.length, turnoverPct: null, batches: new Set(recent.filter(o => o.batch).map(o => o.batch)).size };
  const blocked = {}; for (const r of status.runs || []) for (const [k, v] of Object.entries(r.blockedReasons || {})) blocked[k] = (blocked[k] || 0) + v;
  const blockedTop = Object.entries(blocked).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const findings = [];
  if (days < 5) findings.push({ key: 'short', tone: 0, text: `운용 ${days}일. 규칙을 평가하기엔 짧습니다(최소 20거래일).`, suggest: null });
  if (days >= 2) findings.push({ key: 'change', tone: change >= 0 ? 1 : -1, text: `총자산 ${(change * 100).toFixed(1)}%${indexPct !== null ? ` (같은 기간 지수 ${indexPct >= 0 ? '+' : ''}${(indexPct * 100).toFixed(1)}%)` : ''} · 최악의 하루 ${(worstDay * 100).toFixed(2)}%`, suggest: null });
  if (days >= 5) findings.push({ key: 'dailyLoss', tone: dailyBreaches ? -1 : 1, text: `하루 손실 한도(${rules.dailyLoss}%)를 넘은 날 ${dailyBreaches}일 / ${days - 1}일`, suggest: dailyBreaches / Math.max(1, days - 1) > 0.1 ? '한도를 넘는 날이 10%를 넘습니다. 허용 손실을 한 단계 낮추거나(비중 축소) 그 수준을 받아들일지 정하십시오.' : dailyBreaches === 0 && days >= 20 ? '20거래일 넘게 한 번도 안 넘었습니다. 한도가 느슨한 편일 수 있습니다.' : null });
  findings.push({ key: 'trades', tone: trades30 > rules.maxTrades30 ? -1 : 1, text: `최근 30일 매매 결정 ${trades30}회 (상한 ${rules.maxTrades30}회${act.batches ? ` · 재조정 묶음 ${act.batches}개는 각 1회` : ''}) · 실제 주문 ${act.orders}건 · 체결 ${act.fills}건${act.turnoverPct !== null && act.turnoverPct !== undefined ? ` · 회전율 ${act.turnoverPct}%` : ''}`, suggest: blocked['30일 매매 횟수'] ? `매매 상한 때문에 막힌 주문 ${blocked['30일 매매 횟수']}건. 점검 주기를 늘리거나(월 1회) 상한을 올리십시오.` : null });
  if (cashAvgPct !== null) findings.push({ key: 'cash', tone: cashAvgPct < rules.minCash ? -1 : 0, text: `현금 평균 ${cashAvgPct.toFixed(0)}% (최소 ${rules.minCash}%)`, suggest: cashAvgPct > rules.minCash + 25 ? '현금이 최소보다 25%p 넘게 많습니다. 계획 비중 합을 올리거나 현금 최소를 그대로 두고 받아들이십시오(수익 기회는 줄고 손실도 줄어듭니다).' : null });
  if (blockedTop.length) findings.push({ key: 'blocked', tone: 0, text: `막힌 주문 이유: ${blockedTop.map(([k, v]) => `${k} ${v}건`).join(' · ')}`, suggest: null });
  const hist = (status.prefsHistory || []).filter(x => !(x.changed || []).includes('init'));
  if (hist.length) { const lastAt = hist.at(-1).at, since = Math.round((now - Date.parse(lastAt)) / 864e5); findings.push({ key: 'changes', tone: since < 28 ? 0 : 1, text: `규칙 변경 ${hist.length}회 · 마지막 ${String(lastAt).slice(0, 10)} (${since}일 전) · 근거: ${hist.at(-1).reason || '(없음)'}`, suggest: since < 28 ? '바꾼 뒤 20거래일이 지나기 전의 성과는 새 규칙의 평가가 아닙니다. 그 전엔 다시 바꾸지 마십시오.' : null }); }
  const sys = status.integrity; if (sys) findings.push({ key: 'system', tone: sys.ok ? 1 : -1, text: `시스템 점검: ${(sys.items || []).map(i => `${i.label} ${i.count}건`).join(' · ')}`, suggest: sys.ok ? null : '0건이어야 합니다. 장부와 서버 로그를 확인하십시오.' });
  return { days, change, worstDay, dailyBreaches, trades30, activity: act, cashAvgPct, blockedTop, findings };
}
