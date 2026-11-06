import test from 'node:test';
import assert from 'node:assert/strict';
import { tokensOf, similarity, clusterArticles, topicRate, spikeZ, assess, dedupeUrgent, worthRecording, shouldAlert, matchKnown, composeBriefing, eventRecord, relatedToHoldings, marketMove, slotOf } from '../lib/issue-bot.js';

const NOW = Date.parse('2026-11-05T06:00:00Z'); // 한국 15시
const at = h => new Date(NOW - h * 3600000).toISOString();
const art = (title, host, h, link = `https://${host}/${encodeURIComponent(title)}`) => ({ title, description: '', link, sourceHost: host, publishedAt: at(h) });

test('제목 낱말: 조사·괄호·숫자를 뗀다', () => {
  assert.deepEqual(tokensOf('[속보] 코스피 급락에 매도 사이드카 발동…올해만 56번째'), ['코스피', '급락', '매도', '사이드카', '발동', '올해', '56번째']);
  assert.ok(similarity('코스피 급락에 매도 사이드카 발동', '한국거래소, 코스닥 급락에 매도 사이드카 발동') > 0.5);
  assert.ok(similarity('코스피 급락에 매도 사이드카 발동', '한은 기준금리 동결') < 0.2);
});

test('비슷한 제목은 한 사건으로 묶고 출처 수를 센다', () => {
  const items = [art('코스피 급락에 매도 사이드카 발동', 'a.kr', 3), art('코스닥 급락에 매도 사이드카 발동', 'b.kr', 2.5), art('매도 사이드카 발동…코스피 5% 급락', 'c.kr', 2),
    art('한은 기준금리 동결 결정', 'd.kr', 1), art('오래된 기사', 'e.kr', 30), { title: '링크 없음', publishedAt: at(1) }];
  const c = clusterArticles(items, { now: NOW });
  assert.equal(c.length, 2);
  const side = c.find(x => x.title.includes('사이드카'));
  assert.equal(side.count, 3); assert.equal(side.sources, 3); assert.ok(side.critical.includes('market')); assert.ok(side.topics.includes('market'));
  assert.equal(side.firstSeen, at(3));
});

test('기사 급증: 검색어별 포화 비율과 지난 기록 대비 표준점수', () => {
  const full = Array.from({ length: 20 }, (_, i) => art('t' + i, 'x.kr', i * 0.1));
  const slow = Array.from({ length: 20 }, (_, i) => art('s' + i, 'x.kr', i * 3));
  const r = topicRate([full, slow], NOW);
  assert.equal(r.saturated, 1); assert.equal(r.queries, 2);
  assert.equal(spikeZ(r, []), 3);
  assert.equal(spikeZ(topicRate([slow], NOW), []), 0);
  assert.ok(spikeZ(10, [1, 1.2, 0.8, 1, 1.1, 0.9, 1, 1]) >= 3);
});

const move = (symbol, z, change = z) => ({ symbol, label: symbol, unit: '%', available: true, z, change });
const cluster = (extra = {}) => ({ id: 'c1', title: '이란 공습 개시', firstSeen: at(1), lastSeen: at(0.2), count: 4, sources: 3, topics: ['war'], critical: ['war'], links: [{ title: '이란 공습 개시', link: 'https://a.kr/1', host: 'a.kr' }], ...extra });

test('심각도: 기사 신호와 시장 신호가 함께면 긴급, 기사만이면 주의', () => {
  assert.equal(assess(cluster(), { moves: [move('CL=F', 3.1)], now: NOW }).level, 'urgent');
  assert.equal(assess(cluster(), { moves: [move('CL=F', 0.5)], now: NOW }).level, 'caution');
  assert.equal(assess(cluster({ critical: [], sources: 1 }), { moves: [move('CL=F', 0.5)], now: NOW }).level, 'watch');
  assert.equal(assess(cluster({ firstSeen: at(20) }), { moves: [move('CL=F', 3.1)], now: NOW }).level, 'caution', '오래된 사건은 긴급이 아니다');
  assert.equal(assess(cluster(), { moves: [move('^KS11', 4)], now: NOW }).level, 'caution', '관련 없는 시장 움직임은 쓰지 않는다');
});

test('같은 시장 움직임에 긴급은 하나만', () => {
  const a = { ...cluster(), assess: assess(cluster(), { moves: [move('CL=F', 3)], now: NOW }) };
  const b = { ...cluster({ id: 'c2', title: '호르무즈 봉쇄 우려', count: 3 }), assess: assess(cluster({ id: 'c2', count: 3 }), { moves: [move('CL=F', 3)], now: NOW }) };
  const out = dedupeUrgent([a, b]);
  assert.deepEqual(out.map(i => i.assess.level).sort(), ['caution', 'urgent']);
  assert.ok(worthRecording(a));
  assert.equal(worthRecording({ count: 1, critical: [], assess: { level: 'watch' } }), false);
});

test('알림 조절: 새벽엔 긴급만, 같은 사건은 1시간에 한 번, 등급이 오르면 다시', () => {
  const night = Date.parse('2026-11-05T18:00:00Z'); // 한국 03시
  assert.equal(shouldAlert(null, { level: 'caution' }, night), false);
  assert.equal(shouldAlert(null, { level: 'urgent' }, night), true);
  assert.equal(shouldAlert({ alertedAt: at(0.5), alertedLevel: 'caution' }, { level: 'caution' }, NOW), false);
  assert.equal(shouldAlert({ alertedAt: at(0.5), alertedLevel: 'caution' }, { level: 'urgent' }, NOW), true);
  assert.equal(shouldAlert({ alertedAt: at(2), alertedLevel: 'caution' }, { level: 'caution' }, NOW), true);
  assert.equal(shouldAlert(null, { level: 'watch' }, NOW), false);
  assert.equal(matchKnown(cluster({ title: '이란 공습 개시…유가 급등' }), [{ id: 'k', title: '이란 공습 개시' }]).id, 'k');
});

test('브리핑: 시장 숫자와 출처 링크만, 매수·매도 지시 문장 없음', () => {
  const issue = { ...cluster(), assess: assess(cluster(), { moves: [move('CL=F', 3)], now: NOW }) };
  const b = composeBriefing({ now: NOW, moves: [move('^KS11', -2.5, -3.1), move('CL=F', 3, 6.2)], issues: [issue] });
  assert.equal(b.slot, 'close'); assert.equal(slotOf(Date.parse('2026-11-04T23:30:00Z')), 'pre');
  assert.match(b.text, /코스피|\^KS11/); assert.match(b.text, /https:\/\/a\.kr\/1/);
  assert.doesNotMatch(b.text.replace('매수·매도 권유가 아닙니다', ''), /매수하|매도하|사세요|파세요/);
  assert.equal(b.alerts.length, 1);
  const e = eventRecord(issue, [move('CL=F', 3, 6.2)], NOW);
  assert.equal(e.market['CL=F'].change, 6.2); assert.equal(e.links.length, 1);
});

test('내 종목 관련 사건은 이름·업종이 제목에 나올 때만', () => {
  const issues = [{ ...cluster({ title: '삼성전자 반도체 공장 화재' }), links: [] }, { ...cluster({ title: '유가 급등' }), links: [] }];
  const r = relatedToHoldings(issues, [{ name: '삼성전자', sector: '반도체' }, { name: '코카콜라', sector: '음료' }]);
  assert.equal(r.length, 1); assert.equal(r[0].holding, '삼성전자');
});

test('시장 움직임 표준점수', () => {
  const c = Array.from({ length: 60 }, (_, i) => ({ date: `2026-09-${String(i).padStart(2, '0')}`, close: 100 * (1 + (i % 2 ? 0.01 : -0.01)) }));
  c.push({ date: '2026-11-05', close: c.at(-1).close * 1.05 });
  const m = marketMove('^KS11', '코스피', '%', c);
  assert.ok(m.available && m.change > 4.9 && m.z > 2);
  assert.equal(marketMove('X', 'x', '%', c.slice(0, 5)).available, false);
});
