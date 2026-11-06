# 기업 성장 예측 연구(걷기식 검증) G2. 입력 .research/growth-panel.csv → 출력 data/growth-study.json, data/company-history.json의 pred·model
# 질문: 그 시점에 공개된 자료만으로 (1) 다음 1년 매출·영업이익 성장 (2) 다음 1년 지수 대비 초과수익을 미리 구분할 수 있었나?
# G1 → G2 점검(팀 검토 2026-11-06):
#   A0  G1 그대로(전체 기간 분위수로 자르기 + 표준화, '날짜 < 전년 1월 1일' 금지 구간, 모든 단면 평가) — 재현 확인용
#   A1  A0 + 결과가 80% 이상 공개된 '완결 단면'만 평가(2026년 1월처럼 일찍 낸 기업만 남은 단면 제외)
#   A2  A1 + 날짜별 순위로 바꾸기(미래 분위수 안 씀) + 학습 행은 '그 결과가 재학습일 전에 실제 공개된 행'만
#   B   A2에서 시가총액 관련 특징(PSR·이익수익률·규모) 제외
#   C   A2에서 시가총액을 '그때 공개된 주식 수'로 다시 계산
#   D   재무 특징만(가격 관련 전부 제외)
#   운영 모델: 깨끗한 C·D 중 고르기 기간(~2020) 성적이 나은 쪽. 확인 기간(2021~) 성적은 고른 뒤에만 본다.
# 신뢰구간: 기업 단위 부트스트랩(시장별로 기업을 복원 추출, 1,000회) + 월별 IC의 뉴이-웨스트 t(시차 11개월, 12개월 목표가 겹치는 것 반영).
# 실행: .venv-ml/Scripts/python.exe scripts/research/growth-model.py
import json, os, sys, hashlib, platform, warnings
import numpy as np, pandas as pd
from scipy.stats import spearmanr, rankdata
warnings.filterwarnings('ignore')
import lightgbm as lgb, sklearn
from sklearn.linear_model import Ridge

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PANEL = os.path.join(ROOT, '.research/growth-panel.csv')
df = pd.read_csv(PANEL)
df['date'] = pd.to_datetime(df['date'])
for c in ['fwdKnown', 'fwd2yKnown']:
    df[c] = pd.to_datetime(df[c])
df['retKnown'] = df['date'] + pd.Timedelta(days=365)
FIN = ['revG', 'revGPrev', 'accel', 'oiG', 'niG', 'margin', 'marginChg', 'roe', 'ocfMargin']
PRICE = ['mom', 'vol', 'dd52']
CAP_NOW, CAP_PIT = ['ey', 'psr', 'logCap'], ['eyPit', 'psrPit', 'logCapPit']
VARIANTS = {'A0': FIN + CAP_NOW + PRICE, 'A1': FIN + CAP_NOW + PRICE, 'A2': FIN + CAP_NOW + PRICE, 'B': FIN + PRICE, 'C': FIN + CAP_PIT + PRICE, 'D': FIN}
TARGETS = {'fwdRevG': ('다음 1년 매출 성장', 'fwdKnown'), 'fwdOiG': ('다음 1년 영업이익 성장', 'fwdKnown'), 'fwdEx12': ('다음 1년 지수 대비 초과수익', 'retKnown')}
YEARS = list(range(2017, 2027))
PICK_END, CHECK_START = 2020, 2021
PARAMS = dict(n_estimators=300, learning_rate=0.03, num_leaves=7, min_child_samples=40, subsample=0.8, subsample_freq=1, colsample_bytree=0.8, reg_lambda=5.0, verbose=-1, random_state=7)
BOOT = 1000


def old_prep(d, cols):  # G1 방식(재현용): 전체 기간 2~98% 분위수로 자른 뒤 날짜별 표준화
    out = d.copy()
    for c in cols:
        lo, hi = out[c].quantile(0.02), out[c].quantile(0.98)
        out[c] = out[c].clip(lo, hi)
        g = out.groupby(['market', 'date'])[c]
        out[c] = (out[c] - g.transform('mean')) / g.transform('std').replace(0, np.nan)
    return out.fillna({c: 0 for c in cols})


def rank_prep(d, cols):  # 날짜·시장 안 순위(−0.5~0.5). 그날 단면만 보므로 미래 정보가 없다.
    out = d.copy()
    for c in cols:
        out[c] = out.groupby(['market', 'date'])[c].rank(pct=True) - 0.5
    return out.fillna({c: 0 for c in cols})


def spear(p, a):
    rp, ra = rankdata(p), rankdata(a)
    if rp.std() == 0 or ra.std() == 0:
        return np.nan
    return float(np.corrcoef(rp, ra)[0, 1])


def complete_sections(tgt):
    # 공개 완결성은 '결과 재무가 나왔나'로 판단(영업이익이 없는 은행 등 정의 불가 행과 구분). 수익률 목표는 그 자체로.
    base = 'fwdEx12' if tgt == 'fwdEx12' else 'fwdRevG'
    g = df.groupby(['market', 'date'])
    cov = g[base].count() / g['sym'].count()
    n = g[tgt].count()
    ok = cov[(cov >= 0.8) & (n >= 8)].index
    return set(ok)


def walk_forward(tgt, feats, prep, embargo, contrib=False):
    known_col = TARGETS[tgt][1]
    d = df.dropna(subset=[tgt]).copy()
    full = df.copy()
    X = (old_prep if prep == 'old' else rank_prep)(full, feats)
    pred_l = pd.Series(index=full.index, dtype=float)
    pred_r = pd.Series(index=full.index, dtype=float)
    imp, contribs = {}, {}
    for Y in YEARS:
        test_idx = full.index[full['date'].dt.year == Y]
        if len(test_idx) == 0:
            continue
        if embargo == 'old':
            tr = d.index[d['date'] < pd.Timestamp(f'{Y - 1}-01-01')]
        else:  # 재학습일(그해 1월 1일) 전에 결과가 실제로 공개된 행만
            tr = d.index[d[known_col] < pd.Timestamp(f'{Y}-01-01')]
        if len(tr) < 300:
            continue
        y = d.loc[tr].groupby(['market', 'date'])[tgt].rank(pct=True)
        m = lgb.LGBMRegressor(**PARAMS).fit(X.loc[tr, feats], y)
        pred_l.loc[test_idx] = m.predict(X.loc[test_idx, feats])
        if contrib:
            cm = m.predict(X.loc[test_idx, feats], pred_contrib=True)[:, :-1]
            for ix, row in zip(test_idx, cm):
                contribs[ix] = row
        r = Ridge(alpha=10.0).fit(X.loc[tr, feats], y)
        pred_r.loc[test_idx] = r.predict(X.loc[test_idx, feats])
        imp[Y] = dict(zip(feats, [int(v) for v in m.feature_importances_]))
    return (pred_l, pred_r, imp, contribs) if contrib else (pred_l, pred_r, imp)


def sections(pred, tgt, only_complete):
    t = pd.DataFrame({'market': df['market'], 'date': df['date'], 'sym': df['sym'], 'sector': df['sector'], 'p': pred, 'a': df[tgt], 'revG': df['revG']}).dropna(subset=['p', 'a'])
    if only_complete:
        ok = complete_sections(tgt)
        t = t[[k in ok for k in zip(t['market'], t['date'])]]
    return t


def ic_rows(t):
    rows = []
    for (m, d), g in t.groupby(['market', 'date']):
        if len(g) < 8:
            continue
        k = max(2, len(g) // 5)
        top = g.nlargest(k, 'p')
        lo, hi = g['a'].quantile(0.05), g['a'].quantile(0.95)
        a = g['a'].clip(lo, hi)
        rows.append({'market': m, 'date': d, 'year': d.year, 'n': len(g), 'ic': spear(g['p'].values, g['a'].values),
                     'topMinusAll': a.loc[top.index].mean() - a.mean(), 'topHit': (top['a'] > g['a'].median()).mean()})
    return pd.DataFrame(rows)


def nw_t(x, L=11):
    x = np.asarray(x, float)
    n = len(x)
    if n < 6:
        return None
    e = x - x.mean()
    s = e @ e / n
    for l in range(1, min(L, n - 1) + 1):
        s += 2 * (1 - l / (L + 1)) * (e[l:] @ e[:-l]) / n
    return round(float(x.mean() / np.sqrt(s / n)), 2)


def summarize(r):
    if r.empty:
        return {'months': 0}
    monthly = r.groupby('date')['ic'].mean()
    return {'sections': int(len(r)), 'months': int(r['date'].nunique()), 'avgCompanies': round(float(r['n'].mean()), 1), 'ic': round(float(r['ic'].mean()), 3),
            'tNaive': round(float(r['ic'].mean() / (r['ic'].std(ddof=1) / np.sqrt(len(r)))), 2) if len(r) > 2 else None, 'tNW': nw_t(monthly.values),
            'positive': int(round((r['ic'] > 0).mean() * 100)), 'topMinusAll': round(float(r['topMinusAll'].mean() * 100), 1), 'topHit': int(round(r['topHit'].mean() * 100))}


def boot(tabs, reps=BOOT, seed=11):
    """tabs: {name: sections DataFrame(같은 행 집합)} → 기업 단위 부트스트랩 IC 평균 분포(같은 추출을 모든 모델에 써서 차이도 구함)."""
    rng = np.random.default_rng(seed)
    names = list(tabs)
    base = tabs[names[0]]
    pre = {}
    for m, g in base.groupby('market'):
        syms = np.array(sorted(g['sym'].unique()))
        idx = {s: i for i, s in enumerate(syms)}
        secs = []
        for d, gd in g.groupby('date'):
            if len(gd) < 8:
                continue
            si = gd['sym'].map(idx).values
            secs.append((si, gd['a'].values, [tabs[nm].loc[gd.index, 'p'].values for nm in names]))
        pre[m] = (len(syms), secs)
    dist = np.zeros((reps, len(names)))
    for r in range(reps):
        acc = [[] for _ in names]
        for m, (ns, secs) in pre.items():
            w = np.bincount(rng.integers(0, ns, ns), minlength=ns)
            for si, a, ps in secs:
                k = w[si]
                mask = k > 0
                if mask.sum() < 8:
                    continue
                aa = np.repeat(a[mask], k[mask])
                for j, p in enumerate(ps):
                    acc[j].append(spear(np.repeat(p[mask], k[mask]), aa))
        dist[r] = [np.nanmean(x) for x in acc]
    return names, dist


def ci(x):
    return [round(float(np.percentile(x, 2.5)), 3), round(float(np.percentile(x, 97.5)), 3)]


def sector_checks(t):
    """업종 쏠림 점검: 업종 평균을 뺀 순위끼리의 상관(업종 중립 IC), 업종 평균 성장률만으로 예측한 IC, 업종별 상위 20% 적중."""
    neutral, sector_only, picks = [], [], []
    for (m, d), g in t.groupby(['market', 'date']):
        if len(g) < 8:
            continue
        rp, ra = g['p'].rank(pct=True), g['a'].rank(pct=True)
        rp_res = rp - rp.groupby(g['sector']).transform('mean')
        ra_res = ra - ra.groupby(g['sector']).transform('mean')
        if rp_res.std() > 0 and ra_res.std() > 0:
            neutral.append(float(np.corrcoef(rp_res, ra_res)[0, 1]))
        so = g['revG'].rank(pct=True).groupby(g['sector']).transform('mean')
        sector_only.append(spear(so.values, g['a'].values))
        k = max(2, len(g) // 5)
        top = g.nlargest(k, 'p')
        for _, r in top.iterrows():
            picks.append({'sector': r['sector'], 'hit': r['a'] > g['a'].median()})
    pk = pd.DataFrame(picks)
    by = pk.groupby('sector')['hit'].agg(['count', 'mean']).sort_values('count', ascending=False) if not pk.empty else pd.DataFrame()
    return {'sectorNeutralIc': round(float(np.nanmean(neutral)), 3), 'sectorOnlyIc': round(float(np.nanmean(sector_only)), 3),
            'topPicksBySector': {s: {'picks': int(r['count']), 'hit': int(round(r['mean'] * 100))} for s, r in by.iterrows()}}


def annual_snapshots(t):  # 겹치지 않는 표본: 시장별로 해마다 6월 말 단면 하나
    out = []
    for (m, y), g in t.groupby(['market', t['date'].dt.year]):
        june = g[g['date'].dt.month == 6]
        if june.empty:
            continue
        d = june['date'].max()
        s = june[june['date'] == d]
        if len(s) >= 8:
            out.append({'market': m, 'date': d.strftime('%Y-%m-%d'), 'n': int(len(s)), 'ic': round(spear(s['p'].values, s['a'].values), 3)})
    return out


results = {'version': 'G2-2026-11-06', 'generatedAt': pd.Timestamp.utcnow().isoformat(), 'rows': int(len(df)), 'companies': int(df['sym'].nunique()),
           'companiesByMarket': {m: int(n) for m, n in df.groupby('market')['sym'].nunique().items()}, 'variants': {k: v for k, v in VARIANTS.items()},
           'years': YEARS, 'pickEnd': PICK_END, 'checkStart': CHECK_START, 'targets': {}, 'notes': [
    'IC: 같은 달·같은 시장의 기업들 사이에서 예측 순위와 실제 순위의 상관(스피어만). 한 달의 한 시장 = 단면 1개. 단면 IC를 평균.',
    '상위 20% 적중: 예측 상위 1/5 기업 중 실제 값이 같은 단면(같은 달·같은 시장, 결과가 있는 기업) 중앙값보다 큰 비율.',
    '상위 20% − 전체: 같은 단면의 실제 값을 5~95% 범위로 자른 뒤 상위 1/5 평균 − 전체 평균(%p).',
    '완결 단면: 그 단면 기업의 80% 이상이 결과(다음 4개 분기 재무)를 공개한 경우만 평가. 2026년 단면은 결과 미공개로 평가에서 빠짐.',
    '금지 구간: 해마다 1월 1일에 다시 학습하며, 그 시점까지 결과가 실제로 공개된 행만 학습(한국은 법정 기한, 미국은 SEC 제출일 기준).',
    '신뢰구간: 기업 단위 부트스트랩(시장별로 기업을 복원 추출, 1,000회). t(NW): 월별 IC 평균의 뉴이-웨스트 t(시차 11). 같은 기업의 이웃한 달은 목표 기간이 겹쳐 독립 표본이 아님.',
    '종목군: 2026년에 고른 98개 기업(한국 49·미국 49)이라 생존 편향·선택 편향이 남아 있음(꺾인 기업을 넣어 줄였지만 상장폐지 기업은 없음). IC는 이 98개 안의 상대 순위 구분력.',
    '한국 재무는 2015년부터라 한국 단면은 2018년부터.']}

preds_store, contrib_store = {}, {}
for tgt, (label, _) in TARGETS.items():
    out = {'label': label, 'models': {}, 'importance': {}}
    tabs_check = {}
    persist = df['revG'] if tgt != 'fwdEx12' else df['mom']
    plan = [('A0', 'old', 'old', False), ('A1', 'old', 'old', True), ('A2', 'rank', 'known', True), ('B', 'rank', 'known', True), ('C', 'rank', 'known', True), ('D', 'rank', 'known', True)]
    if tgt != 'fwdRevG':
        plan = [p for p in plan if p[0] in ('A0', 'A2', 'C', 'D')]
    preds = {}
    for name, prep, emb, comp in plan:
        if name == 'C':
            pl, pr, imp, contrib_store[tgt] = walk_forward(tgt, VARIANTS[name], prep, emb, contrib=True)
        else:
            pl, pr, imp = walk_forward(tgt, VARIANTS[name], prep, emb)
        preds[name] = (pl, pr, comp)
        out['importance'][name] = imp.get(max(imp), {}) if imp else {}
    # 기준선은 모델과 같은 행(모델 예측이 있는 행)에서 평가
    any_pred = preds['A2'][0]
    variants_eval = {'persist': (persist.where(any_pred.notna()), True)}
    for name, (pl, pr, comp) in preds.items():
        variants_eval[name] = (pl, comp)
        if name in ('A2', 'C', 'D'):
            variants_eval[name + '_ridge'] = (pr, comp)
    for name, (p, comp) in variants_eval.items():
        t = sections(p, tgt, comp)
        r = ic_rows(t)
        if r.empty:
            continue
        out['models'][name] = {'all': summarize(r), 'pick': summarize(r[r['year'] <= PICK_END]), 'check': summarize(r[r['year'] >= CHECK_START]),
                               'byMarket': {m: {'pick': summarize(r[(r['market'] == m) & (r['year'] <= PICK_END)]), 'check': summarize(r[(r['market'] == m) & (r['year'] >= CHECK_START)])} for m in ['KR', 'US']},
                               'byYear': {int(y): {'ic': round(float(g['ic'].mean()), 3), 'sections': int(len(g)), 'avgCompanies': round(float(g['n'].mean()), 1)} for y, g in r.groupby('year')}}
        if comp:
            tc = t[t['date'].dt.year >= CHECK_START]
            tabs_check[name] = tc
    # 운영 모델 선택: C·D 중 고르기 기간 IC가 높은 쪽(확인 기간은 보지 않고 고름)
    clean = [v for v in ('C', 'D') if v in out['models']]
    chosen = max(clean, key=lambda v: out['models'][v]['pick'].get('ic', -9))
    out['chosen'] = chosen
    out['models']['lgbm'] = out['models'][chosen]
    # 부트스트랩: 확인 기간, 같은 행 집합(모든 모델 예측이 있는 행)으로 맞춘 뒤
    names = [n for n in ['persist', 'A2', 'B', 'C', 'D', chosen + '_ridge'] if n in tabs_check]
    common = None
    for n in names:
        ix = set(tabs_check[n].index)
        common = ix if common is None else common & ix
    common = sorted(common)
    aligned = {n: tabs_check[n].loc[common] for n in names}
    bn, dist = boot(aligned)
    ci_out = {n: {'ic': round(float(np.nanmean(dist[:, j])), 3), 'ci95': ci(dist[:, j])} for j, n in enumerate(bn)}
    jp = bn.index('persist')
    for j, n in enumerate(bn):
        if n != 'persist':
            ci_out[n]['minusPersist'] = {'mean': round(float(np.nanmean(dist[:, j] - dist[:, jp])), 3), 'ci95': ci(dist[:, j] - dist[:, jp]), 'shareAbove': int(round(float((dist[:, j] > dist[:, jp]).mean()) * 100))}
    out['bootstrapCheck'] = {'rows': len(common), 'reps': BOOT, 'models': ci_out}
    ch = aligned[chosen]
    out['sectorCheck'] = sector_checks(ch)
    out['sectorCheck']['persist'] = sector_checks(aligned['persist'])
    out['annualSnapshots'] = {n: annual_snapshots(aligned[n]) for n in ['persist', chosen]}
    results['targets'][tgt] = out
    preds_store[tgt] = preds[chosen][0]
    print(f"[{label}] 운영 모델 {chosen}")
    for n, m in out['models'].items():
        if n == 'lgbm':
            continue
        print(f"  {n:9s} 고르기 IC {m['pick'].get('ic')}  확인 IC {m['check'].get('ic')} (단면 {m['check'].get('sections')}, NW t {m['check'].get('tNW')}, 적중 {m['check'].get('topHit')}%)")
    print('  부트스트랩', json.dumps(ci_out, ensure_ascii=False))
    print('  업종', json.dumps(out['sectorCheck'], ensure_ascii=False)[:600])

# 성장 예측 + 싼 가격(그때 주식 수 기준 PSR) → 초과수익?
d = df.copy()
sig = pd.DataFrame({'market': d['market'], 'date': d['date'], 'sym': d['sym'], 'pg': preds_store['fwdRevG'], 'psr': d['psrPit'], 'ex': d['fwdEx12']}).dropna()
ok = complete_sections('fwdEx12')
sig = sig[[k in ok for k in zip(sig['market'], sig['date'])]]
sig['pgRank'] = sig.groupby(['market', 'date'])['pg'].rank(pct=True)
sig['cheapRank'] = 1 - sig.groupby(['market', 'date'])['psr'].rank(pct=True)
sig['combo'] = sig['pgRank'] + sig['cheapRank']
combo = {}
for name, col in [('growthOnly', 'pgRank'), ('cheapOnly', 'cheapRank'), ('growthAndCheap', 'combo')]:
    r = ic_rows(pd.DataFrame({'market': sig['market'], 'date': sig['date'], 'sym': sig['sym'], 'p': sig[col], 'a': sig['ex']}))
    combo[name] = {'pick': summarize(r[r['year'] <= PICK_END]), 'check': summarize(r[r['year'] >= CHECK_START])}
results['valuationCombo'] = combo
print('[성장+가격 → 초과수익]', json.dumps({k: (v['pick'].get('ic'), v['check'].get('ic'), v['check'].get('tNW')) for k, v in combo.items()}, ensure_ascii=False))


def sha(p):
    if not os.path.exists(p):
        return None
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()[:16]


results['manifest'] = {'inputs': {'growth-panel.csv': sha(PANEL), 'factor-data.json': sha(os.path.join(ROOT, '.research/factor-data.json')), 'shares-pit.json': sha(os.path.join(ROOT, '.research/shares-pit.json'))},
                       'software': {'python': platform.python_version(), 'lightgbm': lgb.__version__, 'sklearn': sklearn.__version__, 'pandas': pd.__version__, 'numpy': np.__version__},
                       'lgbmParams': PARAMS, 'ridgeAlpha': 10.0, 'bootstrap': {'reps': BOOT, 'seed': 11}, 'refit': '해마다 1월 1일', 'panelDates': [df['date'].min().strftime('%Y-%m-%d'), df['date'].max().strftime('%Y-%m-%d')],
                       'rebuild': ['node scripts/research/build-factor-data.mjs', 'node scripts/research/build-shares.mjs', 'node scripts/research/build-growth-panel.mjs', '.venv-ml/Scripts/python.exe scripts/research/growth-model.py']}

# 화면용: 기업별 월별 모델 판단(운영 모델의 표본 외 예측, 그 달 같은 시장 안의 순위 0~1)
hist_path = os.path.join(ROOT, 'data/company-history.json')
hist = json.load(open(hist_path, encoding='utf-8'))
score = pd.DataFrame({'sym': df['sym'], 'market': df['market'], 'date': df['date'].dt.strftime('%Y-%m-%d'), 'g': preds_store['fwdRevG'], 'x': preds_store['fwdEx12']})
score['gRank'] = score.groupby(['market', 'date'])['g'].rank(pct=True)
score['xRank'] = score.groupby(['market', 'date'])['x'].rank(pct=True)
for c in hist['companies'].values():
    c['pred'] = {}
FEAT_C = VARIANTS['C']
use_contrib = results['targets']['fwdRevG']['chosen'] == 'C'


def top3(ix):
    row = contrib_store['fwdRevG'].get(ix) if use_contrib else None
    if row is None:
        return []
    order = np.argsort(-np.abs(row))[:3]
    return [[int(i), round(float(row[i]), 3)] for i in order]


for sym, g in score.dropna(subset=['gRank']).groupby('sym'):
    if sym in hist['companies']:
        hist['companies'][sym]['pred'] = {r.date: [round(float(r.gRank), 2), round(float(r.xRank), 2) if pd.notna(r.xRank) else None, top3(r.Index)] for r in g.itertuples()}

G, X = results['targets']['fwdRevG'], results['targets']['fwdEx12']
hist['model'] = {'version': results['version'], 'variant': G['chosen'], 'features': VARIANTS[G['chosen']], 'growth': G['models']['lgbm'], 'growthCi': G['bootstrapCheck']['models'].get(G['chosen']),
                 'persist': G['models']['persist'], 'persistCi': G['bootstrapCheck']['models'].get('persist'), 'excess': X['models']['lgbm'], 'excessCi': X['bootstrapCheck']['models'].get(X['chosen']),
                 'sector': G['sectorCheck'], 'combo': combo, 'companiesByMarket': results['companiesByMarket']}
hist['model']['featureNames'] = FEAT_C if use_contrib else []

# ── 지금 시점 전망(운영 모델 C를 오늘까지 공개된 결과로 다시 학습) + 기록부 ──
# 범위: 확인 기간 표본 외 예측에서 같은 시장·같은 예측 순위 구간(5등분) 기업들의 실제 1년 매출 성장 25·50·75% 값.
TODAY = pd.Timestamp.now().normalize()
LABEL = {'revG': '최근 1년 매출 성장', 'revGPrev': '1년 전 매출 성장', 'accel': '성장 가속', 'oiG': '영업이익 성장', 'niG': '순이익 성장', 'margin': '영업이익률', 'marginChg': '영업이익률 변화',
         'roe': 'ROE', 'ocfMargin': '영업현금흐름/매출', 'eyPit': '이익수익률(1/PER)', 'psrPit': 'PSR(시장이 매긴 매출 배수)', 'logCapPit': '회사 규모', 'mom': '12개월 주가 흐름', 'vol': '주가 변동성', 'dd52': '52주 고점 대비'}
outlook = {'version': results['version'], 'variant': 'C', 'createdAt': pd.Timestamp.utcnow().isoformat(), 'features': FEAT_C, 'labels': LABEL, 'companies': {}}
Xall = rank_prep(df, FEAT_C)
live = {}
for tgt in ['fwdRevG', 'fwdOiG']:
    dd = df.dropna(subset=[tgt])
    tr = dd.index[dd['fwdKnown'] < TODAY]
    y = dd.loc[tr].groupby(['market', 'date'])[tgt].rank(pct=True)
    m = lgb.LGBMRegressor(**PARAMS).fit(Xall.loc[tr, FEAT_C], y)
    last = df.groupby('market')['date'].transform('max')
    te = df.index[df['date'] == last]
    live[tgt] = (te, pd.Series(m.predict(Xall.loc[te, FEAT_C]), index=te), m.predict(Xall.loc[te, FEAT_C], pred_contrib=True)[:, :-1], dd.loc[tr, 'fwdKnown'].max())
calib = {}
oos = pd.DataFrame({'market': df['market'], 'date': df['date'], 'p': preds_store['fwdRevG'], 'a': df['fwdRevG']}).dropna()
okc = complete_sections('fwdRevG')
oos = oos[np.array([k in okc for k in zip(oos['market'], oos['date'])]) & (oos['date'].dt.year >= CHECK_START).values]
oos['q'] = (oos.groupby(['market', 'date'])['p'].rank(pct=True) * 5).clip(upper=4.999).astype(int)
oos['med'] = oos.groupby(['market', 'date'])['a'].transform('median')
for (mk, q), g in oos.groupby(['market', 'q']):
    calib.setdefault(mk, {})[int(q)] = {'p25': round(float(g['a'].quantile(0.25)), 3), 'p50': round(float(g['a'].quantile(0.5)), 3), 'p75': round(float(g['a'].quantile(0.75)), 3), 'n': int(len(g)),
                                        'aboveMedian': int(round(float((g['a'] > g['med']).mean()) * 100))}
outlook['calibration'] = calib
teG, pG, cG, knownG = live['fwdRevG']
teO, pO, cO, _ = live['fwdOiG']
outlook['trainedOnOutcomesThrough'] = knownG.strftime('%Y-%m-%d')
posG = {ix: k for k, ix in enumerate(teG)}
for mk in ['KR', 'US']:
    ix = [i for i in teG if df.at[i, 'market'] == mk]
    rg = pG.loc[ix].rank(pct=True)
    ro = pO.reindex(ix).rank(pct=True)
    vol_r = df.loc[ix, 'vol'].rank(pct=True)
    for i in ix:
        r = df.loc[i]
        q = min(4, int(rg[i] * 5))
        row = cG[posG[i]]
        order = np.argsort(-np.abs(row))[:4]
        flags = []
        if pd.isna(r['psrPit']):
            flags.append('그때 주식 수 자료가 없어 PSR·규모를 중간값으로 둠')
        if vol_r[i] >= 0.9:
            flags.append('주가 변동성이 같은 시장 상위 10%')
        if pd.notna(r['revG']) and abs(r['revG']) > 0.6:
            flags.append('최근 성장률이 매우 커서(±60% 초과) 다음 해 되돌림 가능성')
        recent = sorted(hist['companies'].get(r['sym'], {}).get('pred', {}).items())[-7:-1]
        if recent and max(abs(v[0] - rg[i]) for _, v in recent) > 0.4:
            flags.append('최근 6개월 사이 판단 순위가 크게 바뀜')
        sec_hit = results['targets']['fwdRevG']['sectorCheck']['topPicksBySector'].get(r['sector'])
        if sec_hit and sec_hit['picks'] >= 10 and sec_hit['hit'] < 55:
            flags.append(f"{r['sector']} 업종은 과거 상위 판단 적중률이 {sec_hit['hit']}%로 낮았음")
        outlook['companies'][r['sym']] = {'market': mk, 'sector': r['sector'], 'asOf': r['date'].strftime('%Y-%m-%d'), 'lastQuarterEnd': r['lastEnd'], 'groupSize': len(ix),
                                          'growthRank': round(float(rg[i]), 2), 'oiRank': round(float(ro[i]), 2) if pd.notna(ro[i]) else None, 'bucket': q, 'range': calib.get(mk, {}).get(q),
                                          'drivers': [[FEAT_C[k], round(float(row[k]), 3), None if pd.isna(r[FEAT_C[k]]) else round(float(r[FEAT_C[k]]), 4)] for k in order], 'flags': flags}
G2 = results['targets']['fwdRevG']
outlook['validation'] = {'growth': hist['model']['growthCi'], 'persist': hist['model']['persistCi'], 'growthCheck': hist['model']['growth']['check'], 'oi': results['targets']['fwdOiG']['bootstrapCheck']['models'].get('C'),
                         'financialOnly': G2['bootstrapCheck']['models'].get('D'), 'excess': hist['model']['excessCi'], 'byYear': {y: v['ic'] for y, v in G2['models']['C']['byYear'].items()}}
json.dump(outlook, open(os.path.join(ROOT, 'data/growth-outlook.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

# 기록부: 한 번 적은 판단은 고치지 않는다(같은 기준일·같은 모델 버전이면 건너뜀). 결과가 공개되면 actual만 채운다.
ledger_path = os.path.join(ROOT, 'data/growth-ledger.json')
ledger = json.load(open(ledger_path, encoding='utf-8')) if os.path.exists(ledger_path) else {'note': '성장 전망 기록부. 예측 칸은 적은 뒤 고치지 않고, 결과가 공개되면 actual만 채운다.', 'entries': []}
have = {(e['asOf'], e['modelVersion'], e['sym']) for e in ledger['entries']}
for sym, o in outlook['companies'].items():
    if (o['asOf'], results['version'], sym) in have:
        continue
    ledger['entries'].append({'asOf': o['asOf'], 'recordedAt': outlook['createdAt'][:10], 'modelVersion': results['version'], 'variant': 'C', 'trainedOnOutcomesThrough': outlook['trainedOnOutcomesThrough'],
                              'sym': sym, 'market': o['market'], 'group': f"{o['market']} {o['groupSize']}개 연구 기업", 'lastQuarterEnd': o['lastQuarterEnd'], 'growthRank': o['growthRank'], 'oiRank': o['oiRank'],
                              'expected': o['range'], 'actual': None})
pan = df.set_index(['sym', df['date'].dt.strftime('%Y-%m-%d')])
for e in ledger['entries']:
    if e['actual'] is None and (e['sym'], e['asOf']) in pan.index:
        v = pan.loc[(e['sym'], e['asOf'])]
        if pd.notna(v['fwdRevG']) and pd.notna(v['fwdKnown']) and v['fwdKnown'] <= TODAY:
            e['actual'] = {'revGrowth': round(float(v['fwdRevG']), 4), 'knownAt': v['fwdKnown'].strftime('%Y-%m-%d'), 'filledAt': TODAY.strftime('%Y-%m-%d')}
json.dump(ledger, open(ledger_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('지금 전망', len(outlook['companies']), '기준일', sorted({o['asOf'] for o in outlook['companies'].values()}), '학습에 쓴 결과 공개일 최댓값', outlook['trainedOnOutcomesThrough'], '기록부', len(ledger['entries']))
json.dump(hist, open(hist_path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

json.dump(results, open(os.path.join(ROOT, 'data/growth-study.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('저장 data/growth-study.json, data/company-history.json')
