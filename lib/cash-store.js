// 직접 기록한 현금(예수금·CMA·투자용 통장)을 PC 사용자 데이터 폴더에 쌓는다. Vercel·공개 폴더에는 저장하지 않는다.
// 기록은 덮어쓰지 않고 이어 붙인다(나중에 현금 흐름·소비 관리로 확장할 바탕). 계좌번호 등은 받지 않는다.
import { mkdir, readFile, open, rename, unlink } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { historyDirectory } from './history-store.js';

export class CashError extends Error { constructor(message) { super(message); this.name = 'CashError'; } }
const inside = (parent, child) => { const r = relative(resolve(parent), resolve(child)); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
const MAX_ENTRIES = 2000, MAX_BYTES = 1_000_000;

export function validateCashInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['amount', 'note'].includes(k))) throw new CashError('현금 기록 형식을 확인하십시오.');
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1e13) throw new CashError('현금은 0원 이상, 10조원 이하 숫자로 적어 주십시오.');
  const note = body.note == null ? '' : String(body.note).trim();
  if (note.length > 60 || /[\u0000-\u001f]/.test(note)) throw new CashError('메모는 60자 이내로 적어 주십시오.');
  return { amount: Math.round(amount), note };
}

export function createCashStore({ directory = join(historyDirectory(), 'cash'), env = process.env, publicRoots = [], now = () => new Date() } = {}) {
  const root = resolve(directory), file = join(root, 'cash-ledger.json');
  function guard() { if (env.VERCEL || publicRoots.some(p => inside(p, root))) throw new CashError('현금 기록은 공개 폴더나 클라우드에 저장할 수 없습니다.'); }
  async function readLedger() {
    guard();
    let bytes; try { bytes = await readFile(file); } catch (e) { if (e.code === 'ENOENT') return { schema: 1, entries: [] }; throw e; }
    if (bytes.length > MAX_BYTES) throw new CashError('현금 기록 파일이 너무 큽니다.');
    let d; try { d = JSON.parse(bytes); } catch { throw new CashError('현금 기록 파일을 읽지 못했습니다. 원본은 그대로 둡니다.'); }
    if (d?.schema !== 1 || !Array.isArray(d.entries)) throw new CashError('현금 기록 파일 형식이 다릅니다. 원본은 그대로 둡니다.');
    return d;
  }
  const view = d => ({ latest: d.entries.at(-1) || null, entries: d.entries.slice(-24) });
  return {
    async get() { return view(await readLedger()); },
    async set(body) {
      const input = validateCashInput(body), d = await readLedger();
      if (d.entries.length >= MAX_ENTRIES) throw new CashError('현금 기록이 2,000건을 넘었습니다. PC 파일을 정리하십시오.');
      d.entries.push({ ...input, currency: 'KRW', recordedAt: new Date(now()).toISOString() });
      await mkdir(root, { recursive: true, mode: 0o700 });
      const temp = join(root, `.cash-${randomUUID()}.tmp`); let h;
      try { h = await open(temp, 'wx', 0o600); await h.writeFile(JSON.stringify(d)); await h.sync(); await h.close(); h = null; await rename(temp, file); }
      finally { if (h) await h.close().catch(() => {}); await unlink(temp).catch(() => {}); }
      return view(d);
    }
  };
}
