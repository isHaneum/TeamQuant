# 2026-11-12 조사: 더 나은 매매·규칙 설정 방법 (리포트 · 논문 · GitHub)

검색일 2026-11-12. 사실(출처 있음) / 추론 / 미확인을 구분한다. 2차 자료(블로그·기사 요약)에서 온 수치는 그렇게 적었다. 원문 PDF 를 직접 연 것은 없다 — 검색 요약 기준이다.

## 1. 결론
- 수익을 더 내는 새 기법은 찾지 못했다. 찾은 것은 **규칙을 정하고 검증하는 방법**과 **지금 규칙에서 고칠 곳 몇 군데**다.
- 가장 큰 개선 여지는 종목군이다(지금 98개 → 위성 9종목). 개별 종목 수익은 소수의 큰 승자에 몰려 있어, 적은 종목을 고르면 지수에 뒤질 확률이 높다.
- 언어 모델이 매매를 결정하는 방식(에이전트)은 정직한 검증에서 살아남지 못했다. 쓸 곳은 분류(뉴스 오탐 줄이기)까지다.

## 2. 찾은 것

| 주제 | 사실 | 출처 | 우리 규칙에 주는 뜻 |
|---|---|---|---|
| LLM 매매 에이전트 | TradingAgents 논문의 검증은 2024-01~03, 3종목. 저장소 이슈는 모델이 검증 기간을 이미 학습했을 수 있다고 지적 | arXiv 2412.20138, GitHub TauricResearch/TradingAgents #805 | 근거로 쓰기엔 기간·종목이 너무 적다 |
| | 20년·100종목 이상으로 넓히면 LLM 전략의 우위가 크게 줄고, 상승장에서 너무 보수적·하락장에서 큰 손실 | FINSABER, arXiv 2505.07078 (KDD 2026 채택) | 결정권을 주지 않는다 |
| | 누수를 막고 탐색 횟수를 반영하면 발견한 전략 중 운과 구분되는 것이 없음(최고 +0.37 → 표본 외 −0.23) | arXiv 2608.27734 (2026-08) | 같은 원칙을 우리 기준 변경에도 적용 |
| | 표본 내·외 비교 벤치마크에서 한 모델 전략의 초과수익이 연 +20.7% → −1.0% (2차 요약 수치) | Look-Ahead-Bench arXiv 2601.13770 | 과거 검증보다 앞으로의 기록이 우선 |
| 뉴스 제목 분류 | 제목을 호재/악재로 분류한 신호가 초기 주가 반응을 맞힘. 소형주·악재에서 표류가 큼. 최근 약해졌다는 수치는 2차 자료라 미확인 | Lopez-Lira·Tang, arXiv 2304.07619 v6 (2025-10) | 예측이 아니라 분류 용도로는 근거가 있다 |
| 과최적화 | 여러 변형을 시험하면 최고 성과는 우연으로도 나온다. 시험 횟수·왜도·첨도를 반영해 깎는 방법(Deflated Sharpe), 표본 내 1등이 표본 외에서 실망하는 확률(PBO) | Bailey·López de Prado; Bailey·Borwein·López de Prado·Zhu (SSRN 2326253) | 기준을 바꿀 때 시험 횟수를 적고, t 2 로는 바꾸지 않는다 |
| 실적 발표 뒤 표류 | 미국 대형주에서는 2006년 무렵 거의 사라짐(Martineau 2022 인용). 중소형에는 남음 | 검색 요약(Martineau 2022, Mondello 2025) | 미국 대형주 위성에는 실적 뒤 추격 매수 근거가 약하다 |
| | 한국에는 있고 크기가 미국과 비슷(2000년 이후). 개인이 서프라이즈 반대로 거래해 생긴다는 설명 | Eom·Hahn·Sohn 2010, 2019 (Pacific-Basin Finance Journal) | 국내 위성은 "새 분기 실적 확인 뒤 추가 매수"(2단계)가 근거와 맞다 |
| 한국의 모멘텀 | 1983~2023 개별 종목은 모멘텀이 아니라 반전이 우세. 단기(약 2개월) 반전이 반복 확인됨. KOSPI 200 안에서는 모멘텀이 유의하다는 연구도 있음 | Kang·Ryu·Webb 2024, JDQS 논문, arXiv 1211.6517 | 국내 종목에 추세 조건(200일선)을 쓰지 않는 지금 설정과 맞다 |
| 한국의 실적 팩터 | 증권사 자료는 이익조정비율·컨센서스 변화 같은 실적 모멘텀이 국내에서 가장 유효하다고 봄(오래된 자료). 2026-04 월간 퀀트: 실적·주가 모멘텀·사이즈 강세, 밸류·퀄리티 약세 | 유진투자증권 2023-04, 교보증권 월간 퀀트 2026-04-06 | 우리 카드에는 컨센서스 변화가 없다(자료 없음) |
| 종목 수와 쏠림 | 미국 1926~2025, 약 3만 종목 중 46개 기업이 전체 부 창출의 절반. 절반 넘는 종목이 단기 국채보다 못함. 종목별 보유 수익 중앙값 −6.9% (2026 초안, 심사 전) | Bessembinder 2026 갱신 (검색 요약) | 9종목 위성은 큰 승자를 놓칠 확률이 높다 → 종목 수를 늘리고, 오른 종목을 줄이지 않는다 |
| 재조정 | 달력보다 임계값 방식이 낫다. 목표에서 2%p 벗어나면 1.75%p 까지만 되돌림. 이득은 연 0.05~0.22%p | Vanguard "The Rebalancing Edge" 2024-12 | 이득이 작다. 목표까지가 아니라 밴드 안쪽까지만 되돌리면 회전이 준다 |
| 행동 격차 | 미국 펀드 투자자는 10년(~2025) 연 8.7%, 펀드 자체는 9.9% → 연 1.2%p 차이. 자동 배분형(타깃데이트)이 격차가 가장 작음 | Morningstar Mind the Gap 2025·2026 | 자동 집행의 근거 |
| | 반대 근거: "나쁜 타이밍은 수익을 깎지 않는다"는 논문(제목만 확인, 내용 미확인) | Financial Analysts Journal 2026 | 미확인 — 읽어야 함 |
| 손절 | 손절 주문은 손실 회피 성향을 줄이지만, 수익을 높이지는 않고 위험만 줄임 | Richards 외 2017, Fischbacher 외 2017 (2차 요약) | 가격 손절 대신 "근거 깨짐" 매도를 쓰는 지금 방식과 충돌 없음 |
| 유상증자 공시 | 주주배정은 공시 다음 날 음(−)의 초과수익, 제3자배정은 공시 당일 양(+). 연구마다 다르다고 스스로 밝힘 | 국내 사건연구(earticle A263091 등) | 유상증자를 한 등급으로 묶지 말고 방식별로 나눈다 |
| 주주환원 | 2025년 밸류업 지수 +89.4% vs 코스피 +75.6%. 자사주 소각 2025년 21.4조(2023년 4.8조). 소각 의무화 2026-03, 배당소득 분리과세 2026-01 | 서울경제 2026-01-08, SK증권 2026-08 | 국내 질 기준에 주주환원을 넣을지 시험할 만하다 |
| 2027 전망 | 증권사 코스피 밴드: KB 5,100~9,000 · 대신 5,200~8,200 · 한화 6,000~9,300 · 현대차 6,000~10,500. 11-10 종가 5,239 | 아시아투데이 2026-11-11, 세계일보 2026-11-03, 대신증권 2026-10 | 밴드 폭이 지수의 절반 — 전망으로 비중을 정하지 않는다는 지금 방침 유지 |
| 도구 | 한투 공식 저장소에 전략 빌더 · Lean 기반 백테스터 · MCP(주문 가능)가 있음. vectorbt 는 일봉 팩터 연구에 빠름, qlib 은 ML 연구용, Lean·NautilusTrader 는 실거래 지향 | github.com/koreainvestment/open-trading-api, 비교 글(2차) | 우리 엔진 결과를 독립 엔진으로 한 번 교차 확인할 가치 |
| 자료 | 전 종목 재무는 OpenDART(키 있음), 시세·종목 목록은 pykrx·FinanceDataReader. FDR 은 최근 릴리스가 뜸함 | PyPI·GitHub | 종목군 확대는 지금 자산으로 가능 |

## 3. 우리 자료로 확인한 것 (scripts/thesis-variants.mjs · data/thesis-variants.json)
카드 기준을 요소별로 쪼개 과거 매달 말에 적용(통과 − 같은 시장 전체, 다음 달, 월평균 %p). 32칸을 한꺼번에 본 탐색이라 t 2 근처는 우연과 구분되지 않는다.

| 변형 | 2021~ 국내 | 2021~ 미국 |
|---|---|---|
| 전체 기준(지금) | +0.58 (t 0.56) | +0.93 (t 1.96) |
| 성장만 | +0.40 (t 0.57) | +0.44 (t 1.10) |
| 성장 + 질 | +0.83 (t 0.83) | +0.42 (t 1.07) |
| 가격만 | +0.14 (t 0.60) | +0.09 (t 0.58) |
| 전체 기준 + 6개월 주가 오름 | −0.84 (t −0.67) | +1.06 (t 1.44) |
| 전체 기준 + 6개월 주가 내림 | +1.95 (t 1.49) | −0.12 (t −0.15) |

- 가격 조건 하나로는 아무 일도 하지 않는다. 성장·질과 합칠 때만 숫자가 커진다(미국).
- 국내는 떨어진 통과 종목이, 미국은 오른 통과 종목이 나았다. 문헌(한국 반전 · 미국 모멘텀)과 같은 방향이다. 유의하지 않다.

## 4. 제안
지금 바꿀 것(비용이 작고 근거가 규칙 설정 방법에 관한 것):
1. **기준 변경 절차:** 기준을 바꿀 때 ① 바꾸기 전에 기대 효과를 적고 ② 그때까지 시험한 변형 수를 적고 ③ 과거 검증 t 3 미만이면 "근거 없음, 선호로 정함"이라고 적는다. 판정은 모의계좌의 앞으로 기록으로 한다.
2. **유상증자 등급 분리:** 주주배정·일반공모 = 주의, 제3자배정 = 관찰.
3. **재조정은 밴드 안쪽까지만.**

시험할 것(결과를 모르는 것):
4. **종목군 확대**(98 → 공개 재무가 있는 상장사 수백 개)와 위성 12~15종목. 한화에어로스페이스처럼 자료가 없어 빠진 종목을 다시 심사한다.
5. **미국 위성에만 6개월 주가 조건**을 동점 처리 기준으로. 앞으로 기록으로 판정.
6. **국내 질 기준에 주주환원**(자사주 소각·배당). DART 공시로 만들 수 있는지부터.
7. **뉴스 판정에 언어 모델**(분류만). 오탐률을 지금 낱말 규칙과 비교. API 비용 필요.
8. **독립 엔진 교차 확인:** 카드 과거 검증 한 건을 vectorbt 로 다시 계산.

하지 않을 것:
- 언어 모델 에이전트에 매매 결정을 맡기는 것, 증권사 지수 전망으로 비중을 정하는 것, 가격 손절, 뉴스를 보고 사는 것.

## 5. 출처
- https://arxiv.org/abs/2412.20138 · https://github.com/TauricResearch/TradingAgents/issues/805
- https://arxiv.org/html/2505.07078v5 · https://arxiv.org/html/2608.27734v1 · https://arxiv.org/pdf/2601.13770 · https://arxiv.org/abs/2304.07619v6
- https://papers.ssrn.com/abstract=2326253
- https://accounting.wharton.upenn.edu/wp-content/uploads/2026/04/Presidential_PEAD-Mar-2026.pdf · https://archives.kdischool.ac.kr/handle/11125/31123?mode=full · https://www.earticle.net/Article/A242833
- https://emerald.com/insight/content/doi/10.1108/JDQS-02-2021-0005/full/html · https://arxiv.org/pdf/1211.6517
- https://www.eugenefn.com/common/files/amail//20230411_B_likeram28_10.pdf · https://www.iprovest.com/upload/research/report/invtstg/20260406/20260406_B_20250035_13.pdf
- https://www.evidenceinvestor.com/post/the-case-for-indexing-just-got-stronger · https://wpcarey.asu.edu/department-finance/faculty-research/do-stocks-outperform-treasury-bills
- https://corporate.vanguard.com/content/dam/corp/research/pdf/the_rebalancing_edge_optimizing_target_date_fund_rebalancing_through_threshold_based_strategies.pdf
- https://www.morningstar.com/lp/mind-the-gap?con=20404 · https://rpc.cfainstitute.org/research/financial-analysts-journal/2026/bad-timing-does-not-cost-investors-funds-returns
- https://oro.open.ac.uk/44069 · https://m.earticle.net/Article/A263091
- https://news.nate.com/view/20260108n26287 · https://www.sks.co.kr/data1/research/qna_file/20260824181600440_0_ko.pdf
- https://www.asiatoday.co.kr/kn/view.php?key=20261111010003932 · https://m.segye.com/ampView/20261103503619 · https://money2.daishin.com/PDF/Out/intranet_data/Product/ResearchCenter/Report/2026/10/59850_Daishin_2027_Strategy.pdf
- https://github.com/koreainvestment/open-trading-api · https://apiportal.koreainvestment.com/toolkit-backtest · https://github.com/FinanceData/FinanceDataReader
