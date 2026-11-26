// 월급 적립 설계(결정 41 · 2026-11-16 사용자: "규칙 말이 너무 어렵고, 왜 중요한지 모르고, ISA·수수료·ETF를 일반인이 다 찾기 어렵다").
// 입력 세 개(매달 넣을 돈 · 연봉 · 그중 55세까지 안 꺼낼 돈)와 섞는 비율 → 넣는 곳(계좌 순서) · 사는 것(같은 지수 중 비용이 낮은 상품) ·
// 신경 쓰지 않아도 되는 것 · 내 규칙 한 문장. 숫자는 전부 data/dca-guide.json(출처·기준일)에서 읽는다.
// 세법과 공시 비용으로 하는 산수이지 수익 예측이 아니며, 매수·매도 권유가 아니다. 예시 수익률은 화면에 '예시'로만 쓴다.

export const DCA_GUIDE_VERSION = 'DG1-2026-11-16';

const won = v => Math.max(0, Math.round(Number(v) || 0));

/** 화면 입력 → 계산 입력. salaryMan 은 만 원 단위. mix 는 { 범주 id: % } (합이 100이 아니면 비율로 맞춘다). */
export function normalizeInput(raw = {}, guide) {
  const monthly = won(raw.monthly);
  const salary = won(raw.salaryMan) * 10000;
  const oldAge = Math.min(monthly, won(raw.oldAge));
  const ids = (guide?.categories || []).map(c => c.id);
  const mix = {};
  for (const id of ids) mix[id] = Math.max(0, Number(raw.mix?.[id]) || 0);
  const sum = Object.values(mix).reduce((a, b) => a + b, 0);
  if (!sum && ids.length) mix[ids[0]] = 100;
  else if (sum) for (const id of ids) mix[id] = Math.round(mix[id] / sum * 1000) / 10;
  return { monthly, salary, oldAge, mix };
}

/** 연금저축 공제율(지방세 포함). 월급이 없으면 0. */
export function pensionRate(salary, tax) {
  if (!(salary > 0)) return 0;
  return salary <= tax.pension.lowSalary ? tax.pension.rateLow : tax.pension.rateHigh;
}

/**
 * 넣는 곳. 노후용 돈은 연금저축(연 한도까지) → IRP(합산 한도까지), 그 밖의 돈은 ISA(연 한도까지) → 일반 계좌.
 * 월급이 없으면 공제가 0원이라 노후용 돈도 ISA 로 보낸다(월급이 생긴 해부터 연금저축이 1순위).
 * 반환 rows: [{ id, monthly, refundMax }] — refundMax 는 1년 최대 환급액(낸 소득세가 그보다 적으면 그만큼만).
 */
export function accountPlan({ monthly, salary, oldAge }, tax) {
  const rate = pensionRate(salary, tax);
  const pensionCap = Math.floor(tax.pension.cap / 12), irpCap = Math.floor((tax.pension.capWithIrp - tax.pension.cap) / 12), isaCap = Math.floor(tax.isa.yearCap / 12);
  const pension = rate ? Math.min(oldAge, pensionCap) : 0;
  const irp = rate ? Math.min(oldAge - pension, irpCap) : 0;
  const isa = Math.min(monthly - pension - irp, isaCap);
  const general = monthly - pension - irp - isa;
  const rows = [
    { id: 'pension', monthly: pension, refundMax: Math.round(pension * 12 * rate) },
    { id: 'irp', monthly: irp, refundMax: Math.round(irp * 12 * rate) },
    { id: 'isa', monthly: isa, refundMax: 0 },
    { id: 'general', monthly: general, refundMax: 0 }
  ];
  return { rate, rows, refundMax: rows.reduce((s, r) => s + r.refundMax, 0), noSalary: !(salary > 0), isaLow: salary > 0 && salary <= tax.isa.lowSalary };
}

/** 같은 지수 안에서 비용이 가장 낮은 '큰' 상품(순자산 기준이 있으면 그 이상만)과, 같은 기준의 가장 비싼 상품과의 1,000만 원당 1년 비용 차이. */
export function categoryPick(cat) {
  const big = cat.items.filter(i => !(cat.minAumEok > 0) || !(i.aumEok > 0) || i.aumEok >= cat.minAumEok);
  const sorted = [...big].sort((a, b) => a.cost - b.cost);
  const pick = sorted[0] || null, dear = sorted.at(-1) || null;
  return { pick, dear, small: cat.items.length - big.length, per10m: pick && dear ? Math.round((dear.cost - pick.cost) / 100 * 1e7) : 0, sorted };
}

/** ISA 예시: 3년 동안 매달 isa 원, 연 rate 수익(예시 · 예측 아님), 3년 뒤 한 번에 판다고 볼 때 일반 계좌 대비 아끼는 세금. 국내 주식 ETF 몫은 일반 계좌에서도 매매 이익 세금이 없어 0으로 둔다. */
export function isaExample({ isaMonthly, abroadShare, isaLow }, tax, { rate = 0.06, years = tax.isa.years } = {}) {
  if (!(isaMonthly > 0) || !(abroadShare > 0)) return { saved: 0, profit: 0, years, rate };
  const r = Math.pow(1 + rate, 1 / 12) - 1, n = years * 12;
  const fv = isaMonthly * (Math.pow(1 + r, n) - 1) / r, profit = (fv - isaMonthly * n) * abroadShare;
  const free = isaLow ? tax.isa.taxFreeLow : tax.isa.taxFree;
  const general = profit * tax.general.rate, inIsa = Math.max(0, profit - free) * tax.isa.overRate;
  return { saved: Math.round(general - inIsa), profit: Math.round(profit), years, rate };
}

const fmt = v => `${Math.round(v).toLocaleString('ko-KR')}원`;
const ACCOUNT_NAMES = { pension: '연금저축', irp: 'IRP', isa: 'ISA', general: '일반 계좌' };

/** 내 규칙 한 문장(질문형 없이, 사용자가 그대로 따라 할 수 있는 말). */
export function ruleText(input, plan, picks, guide) {
  const parts = plan.rows.filter(r => r.monthly > 0).map(r => `${ACCOUNT_NAMES[r.id]} ${fmt(r.monthly)}`);
  const buys = guide.categories.filter(c => input.mix[c.id] > 0).map(c => { const p = picks[c.id]?.pick; return `${c.label} ${input.mix[c.id]}%${p ? `(${p.name})` : ''}`; });
  // 2026-11-17(교차 검증 F25): IRP 는 위험자산(주식형) 비중이 법으로 70%까지라, IRP 몫까지 위 비율 그대로 주식형을 사라고 쓰면 틀린 규칙이 된다.
  const irp = plan.rows.find(r => r.id === 'irp')?.monthly > 0, risky = guide.tax?.irp?.riskyMax;
  const lines = [
    `월급이 들어오면 다음 날 ${fmt(input.monthly)}을 넣는다${parts.length ? ` — ${parts.join(', ')}` : ''}.`,
    `${buys.join(', ')}를 산다.`,
    irp && risky > 0 && risky < 1 ? `IRP에서는 ${Math.round((1 - risky) * 100)}% 이상을 예금이나 채권형으로 둔다(주식형은 법으로 ${Math.round(risky * 100)}%까지).` : null,
    buys.length > 1 ? '비율이 어긋나면 새로 넣는 돈으로 모자란 쪽부터 산다.' : null,
    '값이 떨어져도 팔지 않고, 떨어지길 기다리지도 않는다.',
    `이 규칙은 ${guide.lockDays}일 동안 바꾸지 않는다.`
  ];
  return lines.filter(Boolean).join(' ');
}

/** 화면 한 벌에 필요한 계산 전부. */
export function planGuide(raw, guide) {
  const input = normalizeInput(raw, guide), tax = guide.tax;
  const plan = accountPlan(input, tax);
  const picks = Object.fromEntries(guide.categories.map(c => [c.id, categoryPick(c)]));
  const abroadShare = guide.categories.reduce((s, c) => s + (c.abroad ? (input.mix[c.id] || 0) / 100 : 0), 0);
  const isaRow = plan.rows.find(r => r.id === 'isa');
  const isa = isaExample({ isaMonthly: isaRow.monthly, abroadShare, isaLow: plan.isaLow }, tax);
  const used = guide.categories.filter(c => input.mix[c.id] > 0);
  const costPer10m = used.reduce((s, c) => s + picks[c.id].per10m * input.mix[c.id] / 100, 0);
  const brokerMonthly = Math.round(input.monthly * guide.fees.broker * 100) / 100;
  return { version: DCA_GUIDE_VERSION, input, plan, picks, abroadShare, isa, costPer10m: Math.round(costPer10m), brokerMonthly, rule: ruleText(input, plan, picks, guide) };
}
