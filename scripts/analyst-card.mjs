// 하락 매수 검증 카드 쓰기/보기(결정 45). 카드는 사람이(Claude Code 분석 루틴) 쓰고, 엔진은 읽기만 한다.
// node scripts/analyst-card.mjs list
// node scripts/analyst-card.mjs set <symbol> <card.json>   (card.json: {asOf, verdict, cause, reason, until, facts:[{text,url,date}], watch:[]})
// node scripts/analyst-card.mjs remove <symbol>
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..'), file = join(root, 'data/dip-cards.json');
const db = JSON.parse(readFileSync(file, 'utf8')); db.cards = db.cards || {};
const [cmd, sym, path] = process.argv.slice(2);
const VERDICTS = ['allow', 'hold', 'forbid'], CAUSES = ['market', 'sector', 'customer', 'company', 'none'];
if (cmd === 'list') { for (const [k, c] of Object.entries(db.cards)) console.log(`${k.padEnd(7)} ${c.verdict.padEnd(6)} ${c.cause || '-'} ${c.asOf} → ${c.until || '-'} · ${c.reason}`); }
else if (cmd === 'set' && sym && path) {
  const c = JSON.parse(readFileSync(path, 'utf8'));
  if (!VERDICTS.includes(c.verdict)) throw new Error('verdict 는 allow|hold|forbid');
  if (c.cause && !CAUSES.includes(c.cause)) throw new Error('cause 는 market|sector|customer|company|none');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.asOf || '')) throw new Error('asOf YYYY-MM-DD');
  if (!(c.facts?.length >= 2) || c.facts.some(f => !f.text || !f.url || !f.date)) throw new Error('facts 는 2개 이상이고 text·url·date 가 있어야 한다');
  if (!c.reason) throw new Error('reason 필요');
  if (c.verdict === 'allow' && !c.until) throw new Error('allow 는 until(재확인 기한) 필요');
  db.cards[String(sym).toUpperCase()] = { asOf: c.asOf, verdict: c.verdict, cause: c.cause || null, reason: String(c.reason).slice(0, 400), until: c.until || null, facts: c.facts, watch: c.watch || [] };
  writeFileSync(file, JSON.stringify(db, null, 2) + '\n'); console.log('saved', sym, c.verdict);
}
else if (cmd === 'remove' && sym) { delete db.cards[String(sym).toUpperCase()]; writeFileSync(file, JSON.stringify(db, null, 2) + '\n'); console.log('removed', sym); }
else { console.log('usage: list | set <symbol> <card.json> | remove <symbol>'); process.exit(1); }
