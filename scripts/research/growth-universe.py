# 생존·선택 편향 점검: 98개 기업이 아니라 그해 SEC에 연간 재무를 낸 미국 기업 전부(이후 상장폐지·인수된 기업 포함)에서도
# 다음 해 매출 성장 순위를 구분할 수 있었나? 입력 .research/sec-universe.json(build-sec-universe.mjs) → data/growth-universe.json
# 설계: 연 1회 단면(회계연도 y 실적 공개 뒤, 대략 y+1년 4월). 재무 특징만(상장폐지 기업은 무료 시세가 없음).
#       학습은 y-1년 특징까지(그 목표 = y년 매출, y+1년 봄에 공개). 기준선 = 올해 성장률 그대로.
# 한계: frames는 같은 기간의 '가장 나중 제출값'이라 재작성(사업 매각 반영 등)이 섞인다 → 98개 중 미국 49개의 최초 제출값과 비교해 크기를 잰다.
# 실행: .venv-ml/Scripts/python.exe scripts/research/growth-universe.py
import json, os, warnings
import numpy as np, pandas as pd
from scipy.stats import rankdata
warnings.filterwarnings('ignore')
import lightgbm as lgb
from sklearn.linear_model import Ridge

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
U = json.load(open(os.path.join(ROOT, '.research/sec-universe.json'), encoding='utf-8'))
F = json.load(open(os.path.join(ROOT, '.research/factor-data.json'), encoding='utf-8'))
PARAMS = dict(n_estimators=300, learning_rate=0.03, num_leaves=7, min_child_samples=40, subsample=0.8, subsample_freq=1, colsample_bytree=0.8, reg_lambda=5.0, verbose=-1, random_state=7)
MIN_REV = 50e6

rows = {}
for y, concepts in U['data'].items():
    y = int(y)
    for key, arr in concepts.items():
        if not arr:
            continue
        k2 = 'rev' if key.startswith('rev') else key
        for cik, val, end, accn in arr:
            r = rows.setdefault((cik, y), {'cik': cik, 'y': y})
            if k2 == 'rev':
                if val is not None and (r.get('rev') is None or val > r['rev']):
                    r['rev'], r['end'], r['accn'] = val, end, accn
            elif r.get(k2) is None:
                r[k2] = val
d = pd.DataFrame(rows.values()).sort_values(['cik', 'y'])
d = d.set_index(['cik', 'y'])
g = lambda col, lag: d.groupby(level=0)[col].shift(lag)
d['rev1'], d['rev2'], d['revN'] = g('rev', 1), g('rev', 2), g('rev', -1)
d['oi1'], d['ni1'] = g('oi', 1), g('ni', 1)
# 연도가 끊긴 경우(shift가 다른 해를 잡음) 막기
yrs = d.reset_index()['y'].values
d['y1'] = d.reset_index().groupby('cik')['y'].shift(1).values
d['yN'] = d.reset_index().groupby('cik')['y'].shift(-1).values
d['y2'] = d.reset_index().groupby('cik')['y'].shift(2).values
d = d.reset_index()
d.loc[d['y1'] != d['y'] - 1, ['rev1', 'oi1', 'ni1']] = np.nan
d.loc[d['y2'] != d['y'] - 2, ['rev2']] = np.nan
d.loc[d['yN'] != d['y'] + 1, ['revN']] = np.nan
pos = lambda x: x.where(x > 0)
d['revG'] = d['rev'] / pos(d['rev1']) - 1
d['revGPrev'] = d['rev1'] / pos(d['rev2']) - 1
d['accel'] = d['revG'] - d['revGPrev']
d['oiG'] = d['oi'] / pos(d['oi1']) - 1
d['niG'] = d['ni'] / pos(d['ni1']) - 1
d['margin'] = d['oi'] / pos(d['rev'])
d['marginChg'] = d['margin'] - d['oi1'] / pos(d['rev1'])
d['roe'] = d['ni'] / pos(d['eq'])
d['ocfMargin'] = d['ocf'] / pos(d['rev'])
d['logRev'] = np.log(pos(d['rev']))
d['fwdRevG'] = d['revN'] / pos(d['rev']) - 1
d['stopped'] = d['revN'].isna() & (d['y'] <= 2024)
FEATS = ['revG', 'revGPrev', 'accel', 'oiG', 'niG', 'margin', 'marginChg', 'roe', 'ocfMargin', 'logRev']
uni = d[(d['rev'] >= MIN_REV) & (d['rev1'] >= 10e6) & d['revG'].notna() & (d['y'] >= 2011) & (d['y'] <= 2024)].copy()
for c in FEATS:  # 그해 단면 안 순위(미래 정보 없음)
    uni[c + '_r'] = uni.groupby('y')[c].rank(pct=True) - 0.5
XF = [c + '_r' for c in FEATS]
uni[XF] = uni[XF].fillna(0)
uni['yRank'] = uni.groupby('y')['fwdRevG'].rank(pct=True)


def spear(p, a):
    m = ~(np.isnan(p) | np.isnan(a))
    p, a = p[m], a[m]
    if len(p) < 8:
        return np.nan
    return float(np.corrcoef(rankdata(p), rankdata(a))[0, 1])


uni['p_lgbm'] = np.nan
uni['p_ridge'] = np.nan
for Y in range(2013, 2025):
    tr = uni[(uni['y'] <= Y - 1) & uni['fwdRevG'].notna()]
    te = uni.index[uni['y'] == Y]
    if len(tr) < 1000:
        continue
    m = lgb.LGBMRegressor(**PARAMS).fit(tr[XF], tr['yRank'])
    uni.loc[te, 'p_lgbm'] = m.predict(uni.loc[te, XF])
    uni.loc[te, 'p_ridge'] = Ridge(alpha=10.0).fit(tr[XF], tr['yRank']).predict(uni.loc[te, XF])


def yearly(sub, col):
    out = {}
    for Y, gY in sub.groupby('y'):
        s = gY.dropna(subset=[col, 'fwdRevG'])
        if len(s) < 30:
            continue
        k = max(2, len(s) // 5)
        top = s.nlargest(k, col)
        lo, hi = s['fwdRevG'].quantile(0.05), s['fwdRevG'].quantile(0.95)
        a = s['fwdRevG'].clip(lo, hi)
        allY = gY.dropna(subset=[col])
        topAll = allY.nlargest(max(2, len(allY) // 5), col)
        botAll = allY.nsmallest(max(2, len(allY) // 5), col)
        out[int(Y)] = {'n': int(len(s)), 'ic': round(spear(s[col].values, s['fwdRevG'].values), 3), 'topHit': int(round((top['fwdRevG'] > s['fwdRevG'].median()).mean() * 100)),
                       'topMinusAll': round(float((a.loc[top.index].mean() - a.mean()) * 100), 1),
                       'stoppedTop': round(float(topAll['stopped'].mean() * 100), 1), 'stoppedBottom': round(float(botAll['stopped'].mean() * 100), 1), 'stoppedAll': round(float(allY['stopped'].mean() * 100), 1)}
    return out


def summ(yr, lo, hi):
    v = [x for Y, x in yr.items() if lo <= Y <= hi]
    if not v:
        return {}
    ics = np.array([x['ic'] for x in v])
    return {'years': len(v), 'avgCompanies': int(np.mean([x['n'] for x in v])), 'ic': round(float(ics.mean()), 3), 'icMin': round(float(ics.min()), 3), 'icMax': round(float(ics.max()), 3),
            't': round(float(ics.mean() / (ics.std(ddof=1) / np.sqrt(len(ics)))), 2) if len(ics) > 2 else None,
            'topHit': int(round(np.mean([x['topHit'] for x in v]))), 'topMinusAll': round(float(np.mean([x['topMinusAll'] for x in v])), 1),
            'stoppedTop': round(float(np.mean([x['stoppedTop'] for x in v])), 1), 'stoppedBottom': round(float(np.mean([x['stoppedBottom'] for x in v])), 1)}


def boot_years(sub, cols, lo, hi, reps=1000, seed=5):
    """기업 단위 부트스트랩(해마다 같은 기업 표본을 공유하도록 CIK를 복원 추출)."""
    rng = np.random.default_rng(seed)
    s = sub[(sub['y'] >= lo) & (sub['y'] <= hi)].dropna(subset=cols + ['fwdRevG'])
    ciks = s['cik'].unique()
    idx = {c: i for i, c in enumerate(ciks)}
    per = [(gY['cik'].map(idx).values, gY['fwdRevG'].values, [gY[c].values for c in cols]) for _, gY in s.groupby('y')]
    dist = np.zeros((reps, len(cols)))
    for r in range(reps):
        w = np.bincount(rng.integers(0, len(ciks), len(ciks)), minlength=len(ciks))
        acc = [[] for _ in cols]
        for ci_, a, ps in per:
            k = w[ci_]
            m = k > 0
            aa = np.repeat(a[m], k[m])
            for j, p in enumerate(ps):
                acc[j].append(spear(np.repeat(p[m], k[m]), aa))
        dist[r] = [np.nanmean(x) for x in acc]
    q = lambda x: [round(float(np.percentile(x, 2.5)), 3), round(float(np.percentile(x, 97.5)), 3)]
    return {c: {'ci95': q(dist[:, j])} for j, c in enumerate(cols)} | {'lgbmMinusPersist': {'mean': round(float((dist[:, 0] - dist[:, 2]).mean()), 3), 'ci95': q(dist[:, 0] - dist[:, 2])}}


uni['p_persist'] = uni['revG']
res = {'version': 'U1-2026-11-06', 'note': 'SEC frames 연간(가장 나중 제출값). 매출 ≥ 5천만 달러. 특징은 재무만. 학습: 그 전 해 특징까지. 단면 = 한 해의 모든 기업.', 'minRevenue': MIN_REV,
       'firmYears': int(uni['fwdRevG'].notna().sum()), 'firms': int(uni['cik'].nunique()), 'models': {}}
for name in ['p_lgbm', 'p_ridge', 'p_persist']:
    yr = yearly(uni, name)
    res['models'][name[2:]] = {'byYear': yr, 'pick': summ(yr, 2013, 2019), 'check': summ(yr, 2020, 2024)}
res['bootstrapCheck'] = boot_years(uni, ['p_lgbm', 'p_ridge', 'p_persist'], 2020, 2024)

# 98개 중 미국 기업만 같은 방법으로(같은 frames 자료) → 종목군 차이만 비교
us_ciks = {}
src = open(os.path.join(ROOT, 'scripts/research/universe.mjs'), encoding='utf-8').read()
import re
m = re.search(r'export const US = \{([^}]*)\}', src)
for t, c in re.findall(r'(\w+): (\d+)', m.group(1)):
    us_ciks[int(c)] = t
sub98 = uni[uni['cik'].isin(us_ciks)]
res['sameMethod98US'] = {n[2:]: summ(yearly(sub98.assign(), n), 2020, 2024) | {'pick': summ(yearly(sub98, n), 2013, 2019)} for n in ['p_lgbm', 'p_persist']}
# 여기서 IC는 49개 안의 순위가 아니라 전체 단면에서 나온 예측을 49개 안에서 다시 순위 매긴 것

# 재작성 크기: 미국 49개의 최초 제출 연간 매출(4분기 합)과 frames(가장 나중 값) 비교
diffs = []
for t, s in F['us'].items():
    cik = next((c for c, tt in us_ciks.items() if tt == t), None)
    q = sorted(s.get('revenue') or [], key=lambda x: x['end'])
    if cik is None or len(q) < 4:
        continue
    fr = uni[uni['cik'] == cik].set_index('end')['rev'] if 'end' in uni else None
    allfr = d[d['cik'] == cik].set_index('end')['rev']
    for i in range(3, len(q)):
        win = q[i - 3:i + 1]
        if (pd.Timestamp(win[-1]['end']) - pd.Timestamp(win[0]['end'])).days > 300:
            continue
        first = sum(x['val'] for x in win)
        e = win[-1]['end']
        if e in allfr.index and first > 0:
            diffs.append(abs(allfr.loc[e] / first - 1))
diffs = np.array(diffs)
res['restatement'] = {'firmYears': int(len(diffs)), 'over1pct': round(float((diffs > 0.01).mean() * 100), 1), 'over5pct': round(float((diffs > 0.05).mean() * 100), 1), 'median': round(float(np.median(diffs) * 100), 2) if len(diffs) else None}
json.dump(res, open(os.path.join(ROOT, 'data/growth-universe.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('기업-연도', res['firmYears'], '기업', res['firms'])
for n, v in res['models'].items():
    print(n, '고르기', v['pick'], '\n   확인', v['check'])
print('부트스트랩', res['bootstrapCheck'])
print('같은 방법 98개 중 미국', res['sameMethod98US'])
print('재작성', res['restatement'])
for Y, x in res['models']['lgbm']['byYear'].items():
    print(Y, x['n'], 'IC', x['ic'], '기준', res['models']['persist']['byYear'][Y]['ic'], '상위 적중', x['topHit'], '보고 중단(상위/하위/전체)', x['stoppedTop'], x['stoppedBottom'], x['stoppedAll'])
