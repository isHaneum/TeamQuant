// 한투 모의계좌 실행 CLI(PC 전용). .env.local 과 키 파일을 읽어(값 출력 없음) 상태 조회·미리보기·실행·정지를 한다.
//   node scripts/kis-paper.mjs status
//   node scripts/kis-paper.mjs preview --plan 005930:20,000660:20,069500:20,035420:20   (보내지 않음)
//   node scripts/kis-paper.mjs run --plan ... --yes [--rebalance]                       (통과한 주문만 모의계좌에 지정가로 보냄 · --rebalance: 계획까지 맞추는 재조정 묶음)
//   node scripts/kis-paper.mjs kill on|off · cancel
//   node scripts/kis-paper.mjs publish [--push]   (켜져 있는 PC 서버에 공개 스냅샷을 쓰게 한다 · --push: 저장소에 커밋·푸시)
//   node scripts/kis-paper.mjs verify [path]      (공개 파일(기본 data/paper-live-public.json)의 기록 해시 체인을 다시 계산하고 표시 숫자(marks·total)를 봉인 값과 대조 · 장부·서버·키를 건드리지 않음)
// 규칙은 --rules '{"maxSingle":25,...}' 로 바꿀 수 있고 기본은 lib/core-rules DEFAULT_RULES. 한도는 PAPER_LIVE_LIMITS(JSON) 환경 변수.
import { join, resolve, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyKeyFiles } from '../lib/key-files.js';
import { createKisClient } from '../lib/kis-orders.js';
import { createPaperLive, createLedgerStore, ledgerDir } from '../lib/paper-live.js';
import { fetchHeldMarketSeries } from '../lib/market.js';
import { DEFAULT_RULES } from '../lib/core-rules.js';
import { verifyChain, verifyAgainstMarks, TOTAL_DEFINITION } from '../lib/paper-chain.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// verify 는 키·.env·장부·서버 어느 것도 읽지 않는다(공개 파일만으로 검증된다는 것이 이 명령의 뜻). 그래서 환경 적재보다 먼저 처리하고 끝낸다.
if (process.argv[2] === 'verify') {
  const given = process.argv[3] && !process.argv[3].startsWith('--') ? resolve(process.argv[3]) : join(root, 'data/paper-live-public.json');
  let pub; try { pub = JSON.parse(readFileSync(given, 'utf8')); } catch (e) { console.log(`공개 파일을 읽지 못했습니다: ${e.message}`); process.exit(2); }
  const chain = Array.isArray(pub.chain) ? pub.chain : [], marks = Array.isArray(pub.marks) ? pub.marks : [], v = verifyChain(chain), breaks = Array.isArray(pub.chainBreaks) ? pub.chainBreaks.length : 0;
  // 체인만 다시 계산하면 화면이 읽는 marks·total 을 고친 파일도 '정상'이 된다 → 표시 숫자도 봉인 값과 대조한다(2026-11-12 검토). 공개 total 은 마지막 평가점 총자산이므로 마지막 항목과 날짜가 같을 때만 본다.
  const x = verifyAgainstMarks(chain, marks), lastE = chain.at(-1), lastM = marks.at(-1);
  if (lastE && lastM && lastE.date === lastM.date && Number(pub.total) !== lastE.payload?.total && !x.mismatches.some(m => m.date === lastE.date)) x.mismatches.push({ date: lastE.date, keys: ['total(공개 total)'] });
  console.log(v.ok ? `해시 체인 ${v.days}일 · 정상${breaks ? ` · 봉인 뒤 바뀐 지난 평가점 ${breaks}건(항목은 그대로)` : ''}` : `해시 체인 ${v.days}일 · 깨짐: ${v.brokenAt ?? '—'} · ${v.reason}`);
  console.log(x.mismatches.length ? `표시 숫자와 봉인 값 불일치 ${x.mismatches.length}건(${x.mismatches.map(m => `${m.date}: ${m.keys.join(',')}`).join(' · ')})` : `표시 숫자 대조 ${x.compared}건 일치`);
  console.log(TOTAL_DEFINITION);
  process.exit(v.ok && !x.mismatches.length ? 0 : 1);
}
for (const f of ['.env', '.env.local']) { try { process.loadEnvFile(join(root, f)); } catch { } }
const keys = applyKeyFiles(process.env);
const args = process.argv.slice(2), cmd = args[0] || 'status';
const opt = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };
const won = v => Number.isFinite(v) ? `${Math.round(v).toLocaleString('ko-KR')}원` : '—';
let names = {}; try { names = JSON.parse(readFileSync(join(root, 'data/stock-names.json'), 'utf8')); } catch { }
const plan = Object.fromEntries((opt('plan') || '').split(',').filter(Boolean).map(x => { const [c, p] = x.split(':'); return [c.trim(), { pct: Number(p), name: names[c.trim()] || c.trim() }]; }));
const rules = { ...DEFAULT_RULES, ...(opt('rules') ? JSON.parse(opt('rules')) : {}) };
let limits = {}; try { limits = process.env.PAPER_LIVE_LIMITS ? JSON.parse(process.env.PAPER_LIVE_LIMITS) : {}; } catch { }

console.log(`키: DART ${keys.dart.configured ? '설정됨' : '없음' + (keys.dart.reason ? ' (' + keys.dart.reason + ')' : '')} · KIS ${keys.kis.mode} ${keys.kis.configured ? '설정됨 ' + keys.kis.accountMasked : '없음 (' + keys.kis.reason + ')'}`);
if (!keys.kis.configured) process.exit(2);
process.on('unhandledRejection', e => { console.error(`실패: ${e?.message || e}${e?.code ? ' (' + e.code + ')' : ''}`); process.exit(1); });
const client = createKisClient({ tokenFile: join(ledgerDir(), 'kis-vps-token.json') });
const pl = createPaperLive({ client, store: createLedgerStore(ledgerDir()), readMarket: fetchHeldMarketSeries, limits });
const showItems = items => { for (const i of items) console.log(`  ${i.ok ? '통과' : '차단'} ${i.name}(${i.symbol}) ${i.side === 'BUY' ? '매수' : '매도'} ${i.qty ?? '—'}주 @${i.currency === 'USD' ? '$' + (i.price ?? 0).toFixed(2) : won(i.price)} = ${won(i.amountKrw)} · ${i.why}${i.blocks.length ? '\n      - ' + i.blocks.join('\n      - ') : ''}${i.warnings?.length ? '\n      ! ' + i.warnings.join(' / ') : ''}`); };

if (cmd === 'status') {
  const s = await pl.status();
  console.log(`모의계좌 ${s.account} · 장 ${s.market.open ? '열림' : '닫힘(' + s.market.reason + ')'} · 킬 스위치 ${s.killSwitch ? '켜짐' : '꺼짐'} · 한도 1회 ${won(s.limits.maxOrderKrw)} / 하루 ${won(s.limits.maxDailyKrw)}`);
  if (s.balance) { console.log(`예수금 ${won(s.balance.cash)} · 평가 ${won(s.balance.total)} · 주식 ${won(s.balance.stock)} · 보유 ${s.balance.positions.length}종목`); for (const p of s.balance.positions) console.log(`  ${p.name}(${p.symbol}) ${p.qty}주 ${won(p.valueKrw)}`); }
  if (s.error) console.log('오류:', s.error);
  console.log(`오늘 주문 ${s.ordersToday.length}건${s.ordersToday.length ? ':' : ''}`); for (const o of s.ordersToday) console.log(`  ${o.at.slice(11, 19)} ${o.name} ${o.side} ${o.qty}주 @${won(o.price)} → ${o.status}${o.odno ? ' #' + o.odno : ''}${o.filledQty ? ' 체결 ' + o.filledQty : ''}${o.error ? ' · ' + o.error : ''}`);
  console.log(`장부: ${s.ledgerPath}`);
} else if (cmd === 'preview' || cmd === 'run') {
  if (!Object.keys(plan).length) { try { const d = JSON.parse(readFileSync(join(root, 'data/paper-plan.json'), 'utf8')); for (const [k, v] of Object.entries(d.weights || {})) plan[k] = { pct: v.pct, name: v.name, currency: v.currency }; console.log(`계획: data/paper-plan.json (${d.version}) · ${Object.keys(plan).length}종목 · 현금 ${d.cashPct}%`); } catch { console.log('--plan 005930:20,000660:20 처럼 계획 비중을 주거나 data/paper-plan.json 을 만드십시오.'); process.exit(2); } }
  const dry = cmd === 'preview' || opt('yes') === null && !args.includes('--yes');
  if (cmd === 'run' && dry) console.log('(--yes 가 없어 미리보기만 합니다)');
  const rebalance = args.includes('--rebalance'); if (rebalance) console.log('재조정 모드: 오른 종목 두기 규칙을 끄고 계획까지 맞추며, 이 묶음은 30일 매매 횟수에 1회로 셉니다.');
  const r = await pl.run({ rules, plan, dryRun: dry, rebalance });
  console.log(`${r.at} · 예수금 ${won(r.balance.cash)} · 평가 ${won(r.balance.total)} · 규칙 ${r.evaluation.okCount}/${r.evaluation.known} · 할 일 ${r.items.length}건 · 장 ${r.market.open ? '열림' : '닫힘(' + r.market.reason + ')'}${r.skipped.length ? ' · 뺀 종목(해외) ' + r.skipped.join(',') : ''}${r.noData.length ? ' · 시세 부족 ' + r.noData.join(',') : ''}`);
  showItems(r.items);
  if (!dry) { console.log(`보냄 ${r.sent.length}건${r.note ? ' · ' + r.note : ''}`); for (const o of r.sent) console.log(`  ${o.name} ${o.side} ${o.qty}주 @${o.currency === 'USD' ? '$' + Number(o.price).toFixed(2) : won(o.price)} → ${o.status}${o.odno ? ' #' + o.odno : ''}${o.error ? ' · ' + o.error : ''}`); }
} else if (cmd === 'kill') { const r = await pl.kill(args[1] !== 'off'); console.log(`킬 스위치 ${r.killSwitch ? '켜짐' : '꺼짐'} · 취소 ${r.cancelled.length}건`); }
else if (cmd === 'cancel') { const r = await pl.cancelOpen(); console.log(`취소 요청 ${r.length}건`, r); }
else if (cmd === 'publish') { const port = process.env.PORT || 8766; const r = await fetch(`http://127.0.0.1:${port}/api/bridge/paper-live-public`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${port}`, 'X-TeamQuant-Action': 'bridge-local' }, body: JSON.stringify({ push: args.includes('--push') }) }).catch(() => { throw new Error('PC 서버가 켜져 있어야 합니다(start-personal-server.cmd).'); }); const d = await r.json(); if (!r.ok) throw new Error(d.error || '실패'); console.log(`공개 스냅샷 ${d.asOf} · 보유 ${d.balance?.positions?.length ?? 0}종목 · 기록 ${d.days}일 · 파일 ${d.written}개 · ${d.pushed ? d.pushed.note : '푸시 안 함'}`); }
else console.log('사용: status | preview --plan ... | run --plan ... --yes | kill on|off | cancel | publish [--push] | verify [path]');
