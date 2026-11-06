// 이슈 봇 결과 읽기(서버 전용). 봇은 GitHub의 issue-data 브랜치에 JSON을 올리고, 화면은 /api/issues로 읽는다.
// 허용한 파일 이름만 읽는다. 로컬 개발 때는 .issue-data 폴더가 있으면 그것을 먼저 쓴다.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const ISSUE_DATA_BASE = 'https://raw.githubusercontent.com/isHaneum/TeamQuant/issue-data';
export class IssueFeedError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

export function issuePath(params) {
  const file = String(params.get?.('file') ?? params.file ?? 'latest');
  if (file === 'latest') return 'latest.json';
  if (file === 'briefings') return 'briefings/index.json';
  if (file === 'briefing') { const id = String(params.get?.('id') ?? params.id ?? ''); if (!/^\d{4}-\d{2}-\d{2}-(pre|close|us)$/.test(id)) throw new IssueFeedError('브리핑 번호 형식이 올바르지 않습니다.'); return `briefings/${id}.json`; }
  if (file === 'events') { const month = String(params.get?.('month') ?? params.month ?? ''); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new IssueFeedError('월 형식은 YYYY-MM입니다.'); return `events/${month}.jsonl`; }
  throw new IssueFeedError('지원하지 않는 파일입니다.');
}

function parse(path, text) {
  if (!path.endsWith('.jsonl')) return JSON.parse(text);
  const rows = text.split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  return { events: rows.slice(-400).reverse(), total: rows.length };
}

export async function readIssueFeed(params, { base = process.env.ISSUE_DATA_BASE || ISSUE_DATA_BASE, localDir = null, fetchImpl = fetch } = {}) {
  const path = issuePath(params);
  if (localDir) { try { return { source: 'local', data: parse(path, await readFile(join(localDir, path), 'utf8')) }; } catch {} }
  let r;
  try { r = await fetchImpl(`${base}/${path}`, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'TeamQuantIssueFeed/1.0' } }); }
  catch { throw new IssueFeedError('이슈 봇 저장소에 연결하지 못했습니다.', 502); }
  if (r.status === 404) return { source: 'github', data: null };
  if (!r.ok) throw new IssueFeedError(`이슈 봇 자료를 받지 못했습니다 (${r.status}).`, 502);
  return { source: 'github', data: parse(path, await r.text()) };
}
