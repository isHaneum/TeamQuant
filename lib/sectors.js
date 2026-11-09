// 섹터 지도: 주요 섹터의 대표 회사, 정책·정치 이슈(날짜·출처 포함), 국가별 방향, 지켜볼 일정과
// 보유 종목 → 섹터 분류·집중도 계산. 브라우저와 Node 양쪽에서 쓴다(외부 의존 없음).
// 원칙: 이슈는 "무슨 일이 있었나"(사실)와 "어느 쪽에 영향을 주나"(노출)만 적고, 오를지 내릴지는 적지 않는다.
//   거시·정책 변수로 수익률 방향을 맞힌 근거가 없기 때문이다(Goyal–Welch–Zafirov, RFS 2024; 이 저장소 요인 연구 2026-11-06).
// 갱신: 이슈를 더할 때는 date·source(URL)를 반드시 넣는다. 검증되지 않은 수치는 unverified:true 로 표시한다.
export const SECTORS_VERSION = 'S1-2026-11-09';
export const SECTOR_ASOF = '2026-11-09';

const kr = (symbol, name) => ({ symbol, name, market: 'KR', currency: 'KRW' });
const us = (symbol, name) => ({ symbol, name, market: 'US', currency: 'USD' });

export const SECTORS = [
  {
    id: 'semi', name: '반도체', short: '반도체',
    desc: '메모리(HBM·D램)와 장비. 한국 수출과 코스피 시가총액의 가장 큰 축이라 미·중 정책과 AI 투자 사이클이 바로 반영된다.',
    etf: { KR: kr('091160.KS', 'KODEX 반도체'), US: us('SOXX', 'iShares 반도체 ETF') },
    companies: [kr('005930.KS', '삼성전자'), kr('000660.KS', 'SK하이닉스'), kr('042700.KS', '한미반도체'), us('NVDA', '엔비디아'), us('TSM', 'TSMC'), us('MU', '마이크론'), us('AMAT', '어플라이드 머티어리얼즈')],
    stances: {
      US: '첨단 칩·장비의 대중 수출통제를 유지하고, 반도체에 무역확장법 232조 관세(블로그 자료 기준 25%, 2026-01-15 시행 · 미확인)와 미국 내 공장 투자를 요구한다.',
      CN: '15차 5개년 계획(2026-03)에서 반도체를 4대 신흥 지주 산업으로 지정해 자립을 밀어붙인다. 밀수 HBM이 중국에서 개당 약 4,000달러에 거래된다는 보도(2026-11-03).',
      KR: '반도체특별법 국회 통과(2026-01-29, 찬성 199). 주 52시간 예외는 빠지고 클러스터 지정·특별회계(2036년까지)가 담겼다.',
      JP: '중국이 일본 기업 40곳을 이중용도 수출통제 대상에 올렸고(2026-02) 대일 산화이트륨 수출이 98% 줄었다. 일본의 반도체 소재 맞대응은 관측 단계.',
      EU: '직접 이슈는 적다. 미국 232조 관세와 EU 칩스법 2.0 논의는 이 자료에 포함하지 않았다.'
    },
    issues: [
      { date: '2026-11-06', actor: 'US', kind: '정치', title: '민주당 상·하원 장악 뒤 데이터센터 규제 우려로 코스피 −6.0%', text: '11월 5~6일 외국인이 이틀간 6조원 넘게 팔았고 필라델피아 반도체지수가 12% 넘게 빠졌다. 반도체 업황 악화가 아니라 "규제가 어느 정도일지 모른다"는 불확실성이 원인이라는 해석이 많다.', effect: '−', hits: ['005930.KS', '000660.KS', 'NVDA', 'MU'], source: 'https://www.fnnews.com/news/202611061559461085' },
      { date: '2026-11-03', actor: 'CN', kind: '무역', title: 'HBM 밀수 시장 보도: 중국에서 개당 약 4,000달러', text: '저가 서버 CPU와 함께 패키징해 수출통제를 우회한다는 보도. 자사 칩이 중국산 AI 칩에서 발견되면 미국 제재 대상이 될 수 있어 삼성·SK가 주시.', effect: '±', hits: ['005930.KS', '000660.KS'], source: 'https://www.fnnews.com/news/202611032016082818' },
      { date: '2026-10-19', actor: 'KR', kind: '실적', title: 'SK하이닉스 3분기 영업이익 83.3조원(전년 대비 +632%)', text: '6개 분기 연속 최대 실적. 삼성은 3분기 HBM4 매출이 전 분기의 3배, HBM 매출 중 HBM4 비중 60%라고 밝혔다. D램 판가는 4분기에도 10~20% 상승 전망(증권사).', effect: '+', hits: ['000660.KS', '005930.KS'], source: 'https://counterpointresearch.com/cn/insights/sk-hynix-q3-2026-record-profit' },
      { date: '2026-03-20', actor: 'CN', kind: '정책', title: '15차 5개년 계획: 반도체·AI·로봇을 국가 전략 산업으로', text: '범용 소부장 수출은 줄 수 있지만 첨단 장비·고성능 소재 수요는 이어질 것이라는 KOTRA 분석. 증권가는 "청사진만으로 중국 섹터 매수는 이르다"고 평가.', effect: '±', hits: ['005930.KS', '000660.KS', 'AMAT'], source: 'https://economychosun.com/site/data/html_dir/2026/03/20/2026032000027.html' },
      { date: '2026-01-29', actor: 'KR', kind: '정책', title: '반도체특별법 국회 본회의 통과', text: '클러스터 지정, 기반시설 지원, 예타 면제, 2036년까지 특별회계. 쟁점이던 주 52시간 예외는 빠졌고 상임위에서 계속 논의한다는 부대의견.', effect: '+', hits: ['005930.KS', '000660.KS'], source: 'https://www.wowtv.co.kr/NewsCenter/News/Read?articleId=A202601290525' },
      { date: '2026-01-16', actor: 'US', kind: '무역', title: '엔비디아 H200 대중 수출에 25% 관세, SK에 미국 공장 압박', text: '중국산 반도체 추가 관세는 2027년 6월로 시행이 미뤄졌다는 보도. 반도체 관세는 "대만보다 불리하지 않게"가 한미 합의.', effect: '±', hits: ['NVDA', '000660.KS'], source: 'https://v.daum.net/v/20260116070325049' },
      { date: '2026-01-01', actor: 'US', kind: '정책', title: '미국 반도체 규제 투트랙: 관세는 미루고 HBM·장비는 통제', text: 'HBM과 장비의 대중 수출통제는 유지·강화, 관세는 시행 시점을 뒤로. 중국 공장 장비 반입은 건별 승인.', effect: '±', hits: ['005930.KS', '000660.KS', 'AMAT'], source: 'https://zdnet.co.kr/view/?no=20260101171746' }
    ],
    watch: [
      { when: '2026-11 ~ 12', what: '미 의회 데이터센터·전력 규제 법안 윤곽(민주당 다수 의회는 2027-01 개원)' },
      { when: '2027-06', what: '중국산 반도체 추가 관세 시행 예정(연기된 일정 · 보도 기준)' },
      { when: '분기마다', what: '삼성·SK 실적과 HBM4 공급 비중, D램 가격' }
    ]
  },
  {
    id: 'auto', name: '자동차', short: '자동차',
    desc: '완성차·부품. 미국 232조 관세 15%와 현지 생산 비중, EU 2035년 내연기관 규제, 중국 전기차 가격 경쟁이 핵심 변수다.',
    etf: { KR: kr('091180.KS', 'KODEX 자동차'), US: us('CARZ', 'First Trust 미래차 ETF') },
    companies: [kr('005380.KS', '현대차'), kr('000270.KS', '기아'), kr('012330.KS', '현대모비스'), kr('204320.KS', 'HL만도'), us('TSLA', '테슬라'), us('GM', 'GM'), us('TM', '도요타(ADR)')],
    stances: {
      US: '한국산 자동차 232조 관세 15%(2025-11-01 인하 적용). 대법원이 상호관세를 무효화(2026-02-20)했어도 232조는 그대로. 중간선거 뒤에도 단기 완화는 어렵다는 전망.',
      EU: '2035년 100% 감축을 90%로 완화하는 집행위안(2025-12-16). 프랑스·독일은 "유럽산 우대"와 묶어 90% 감축에 합의(2026-10-16). 의회·이사회 협상 진행 중.',
      CN: 'EU와 최저가격 약속(price undertaking)으로 관세를 대체하는 틀에 합의(2026-01-12). 저가 전기차 수출 확대.',
      KR: '현대차그룹은 2029년까지 미국 현지 생산 80% 이상 목표. 관세 비용은 2025년 약 7조원, 2026년 상반기 3조원 이상(나이스신용평가).',
      JP: '도요타 등 일본차도 같은 15% 체계. 중국의 대일 희토류 통제(2026)가 전동화 부품 공급망 변수.'
    },
    issues: [
      { date: '2026-10-16', actor: 'EU', kind: '정책', title: '프랑스·독일, 2035년 규제 완화와 "유럽산 우대"를 묶는 합의', text: '2035년 90% 감축(남는 10% 상쇄 불허)에 합의. 의회 보고관 초안은 더 느슨한 쪽. 2026년 재검토 조항이 있어 최종안도 바뀔 수 있다.', effect: '±', hits: ['005380.KS', '000270.KS', 'TM'], source: 'https://www.euronews.com/2026/10/16/france-and-germany-strike-car-industry-deal-linking-2035-engine-rules-to-made-in-europe-pu' },
      { date: '2026-10-04', actor: 'US', kind: '무역', title: '관세 근거가 세 번 바뀌어도 자동차는 15%… 현대차·기아 부담 10조원', text: 'IEEPA 무효화 뒤에도 232조 15%는 유지. 301조 조사 결과는 아직. 관세가 25%로 돌아가면 연 3~4조원 추가 부담 추정.', effect: '−', hits: ['005380.KS', '000270.KS', '012330.KS', '204320.KS'], source: 'https://www.khan.co.kr/article/202610041552001/' },
      { date: '2026-01-12', actor: 'EU', kind: '무역', title: 'EU, 중국 전기차에 관세 대신 최저가격 약속 허용', text: '모델·사양별 최저가격을 지키면 반보조금 관세(최대 35.3%)를 면제. 유럽에서 중국차와의 가격 경쟁이 다시 세진다.', effect: '−', hits: ['005380.KS', '000270.KS'], source: 'https://www.caixinglobal.com/2026-01-13/china-eu-reach-breakthrough-to-end-ev-tariffs-102403228.html' },
      { date: '2025-12-16', actor: 'EU', kind: '정책', title: '집행위, 2035년 내연기관 전면 금지를 90% 감축으로 완화 제안', text: '남는 10%는 e-연료·바이오연료·유럽산 저탄소 철강으로 상쇄 가능. 2030~2032년 55% 감축 창도 제시.', effect: '±', hits: ['005380.KS', '000270.KS', 'TSLA'], source: 'https://www.cnn.com/2025/12/16/business/eu-combustion-engine-ban-changed-intl' },
      { date: '2025-10-29', actor: 'KR', kind: '무역', title: '한미 정상회담에서 자동차 관세 15% 타결', text: '25%에서 15%로. 현대차·기아는 "브랜드 경쟁력으로 내실"을 밝혔다.', effect: '+', hits: ['005380.KS', '000270.KS'], source: 'https://newspim.com/news/view/20251029001498' }
    ],
    watch: [
      { when: '2026-12 ~ 2027', what: 'EU 2035년 규제 3자 협상 결과(90% 감축 · 유럽산 조건)' },
      { when: '미정', what: '미국 301조 조사 결과와 전기차 세액공제 복원 여부' },
      { when: '2029', what: '현대차그룹 미국 현지 생산 80% 목표 달성 여부' }
    ]
  },
  {
    id: 'ship', name: '조선', short: '조선',
    desc: '상선·함정 건조. 미국의 조선 재건(MASGA) 협력, 중국 선박 견제, IMO 탄소 규제가 수주와 선가를 움직인다.',
    etf: { KR: kr('494670.KS', 'TIGER 조선TOP10'), US: null },
    companies: [kr('329180.KS', 'HD현대중공업'), kr('042660.KS', '한화오션'), kr('010140.KS', '삼성중공업'), kr('009540.KS', 'HD한국조선해양'), us('HII', '헌팅턴 잉걸스')],
    stances: {
      US: '한미 조선 협력(MASGA, 약 1,500억 달러 펀드 기반). 중국 선박 입항 수수료는 미·중 합의로 1년 유예(2025-11-10 ~ 2026-11-09), 2개월 추가 유예 제안 중.',
      CN: '미국 수수료에 맞대응 수수료를 같은 기간 유예. 세계 수주 점유율 1위.',
      KR: '한화오션은 필리조선소(2024-12 인수) 확장, HD현대는 키윗과 합작 조선소(2027 착공·2029 가동 목표). 한미조선협력센터 개소(2026-07, MOU 15건).',
      EU: 'IMO 넷제로 프레임워크를 지지하는 쪽. 친환경 선박 교체 수요의 근거.',
      JP: '일본 조선은 점유율이 낮아져 직접 경쟁은 제한적.'
    },
    issues: [
      { date: '2026-11-05', actor: 'US', kind: '무역', title: '중국 선박 입항 수수료 1년 유예 만료 임박, 2개월 추가 유예 제안', text: '2025-11-10부터 1년 유예. 4월 예정이던 인상(톤당 50→80달러)도 시행되지 않았다. 해운업계는 영구 철회를 요구.', effect: '±', hits: ['329180.KS', '042660.KS', '010140.KS'], source: 'https://www.wfw.com/articles/suspension-and-amendments-to-us-and-china-port-fees-current-status/' },
      { date: '2026-10-25', actor: 'KR', kind: '정책', title: 'HD현대, 미국 키윗과 합작 조선소 설립 계약', text: '기존 산업부지에 스마트 조선소를 새로 지어 2027년 착공·2029년 가동 목표. 부지·투자 규모는 미정. 한화(필리조선소)와 미 해군 함정 물량을 두고 경쟁.', effect: '+', hits: ['329180.KS', '009540.KS', '042660.KS'], source: 'https://www.fnnews.com/news/202610251820482662' },
      { date: '2026-07-24', actor: 'KR', kind: '정책', title: '워싱턴 한미조선협력센터 개소, 팀 코리아 MOU 15건', text: 'HD현대는 AI 조선소, 한화는 군함에 무게. 1차 승부처는 미 해군 함정 물량.', effect: '+', hits: ['329180.KS', '042660.KS'], source: 'https://m.news.nate.com/view/20260724n25836' },
      { date: '2026-05-01', actor: 'IMO', kind: '정책', title: 'MEPC 84: 넷제로 프레임워크 지지 55개국 vs 재개정 51개국', text: '2025-10 채택이 1년 미뤄진 뒤 다시 지지가 우세해졌지만 채택(3분의 2 필요)은 불확실. 발효는 빨라야 2028-03.', effect: '±', hits: ['329180.KS', '042660.KS', '010140.KS', '009540.KS'], source: 'https://www.hellenicshippingnews.com/the-imo-pendulum-swings-back-towards-the-net-zero-framework-as-agreed-text-gets-further-support-but-path-forward-remains-uncertain/' },
      { date: '2025-11-10', actor: 'US', kind: '무역', title: '미·중 무역 합의로 USTR 301조 항만 수수료 1년 유예', text: '중국도 미국 선박에 대한 맞대응 수수료를 같은 기간 유예.', effect: '−', hits: ['329180.KS', '042660.KS', '010140.KS'], source: 'https://gcaptain.com/white-house-confirms-one-year-suspension-of-ustr-port-fees-in-u-s-china-trade-deal/' }
    ],
    watch: [
      { when: '2026-11-09 전후', what: 'USTR 항만 수수료 유예 연장 확정 여부' },
      { when: '2026 하반기 ~ 2027', what: 'IMO MEPC 85 넷제로 프레임워크 채택 표결(일정 미확인)' },
      { when: '2027', what: 'HD현대 미국 조선소 착공 · 미 해군 함정 발주' }
    ]
  },
  {
    id: 'robot', name: '로봇', short: '로봇',
    desc: '산업용·휴머노이드 로봇과 자동화. 매출보다 기대가 먼저 반영돼 변동이 크고, 한·중·미 정부 지원과 양산 시점이 핵심이다.',
    etf: { KR: kr('445290.KS', 'KODEX K-로봇액티브'), US: us('BOTZ', 'Global X 로봇·AI ETF') },
    companies: [kr('277810.KQ', '레인보우로보틱스'), kr('454910.KS', '두산로보틱스'), kr('117730.KQ', '티로보틱스'), kr('108490.KQ', '로보티즈'), us('TSLA', '테슬라(옵티머스)'), us('ISRG', '인튜이티브 서지컬'), us('ROK', '로크웰 오토메이션')],
    stances: {
      KR: '산업부 주도 K-휴머노이드 연합(40여 기업·대학)이 2028년 로봇 AI 기반 모델·양산을 목표. 2026-10 국감에서 "피지컬 AI 투자가 턱없이 부족했다"고 정부가 인정하고 3대 메가 프로젝트를 예고.',
      CN: '2026 양회에서 AI·로봇을 15차 5개년 전략 산업에 포함, 휴머노이드를 국가급 산업으로 격상. 2026년 상반기 휴머노이드 4만 대 생산 보도(미확인).',
      US: '테슬라 옵티머스 양산 시점은 자료마다 다르고(2026 프리몬트 소량 → 2027 텍사스 전용 공장) 상무부가 로봇·산업기계 수입 232조 조사를 열었다는 보도(미확인).',
      EU: '직접 이슈 적음. 산업용 로봇 수요는 자동차·기계 투자에 좌우.',
      JP: '화낙·야스카와 등 산업용 로봇 강국. 중국 희토류 통제가 모터 공급망 변수.'
    },
    issues: [
      { date: '2026-10-06', actor: 'KR', kind: '정치', title: '국감에서 중국 휴머노이드 시연… "한국 피지컬 AI 투자 부족"', text: '배경훈 부총리가 기존 투자 부족을 인정하고 산업부·과기부 공동 3대 메가 프로젝트로 본격 투자하겠다고 밝혔다. 예산 규모는 미정.', effect: '+', hits: ['277810.KQ', '454910.KS', '117730.KQ', '108490.KQ'], source: 'https://view.asiae.co.kr/article/2026100612211838316' },
      { date: '2026-10', actor: 'KR', kind: '실적', title: '로보월드 2026: 레인보우로보틱스 "산업용 휠형 휴머노이드 내년 양산"', text: '티로보틱스는 자체 개발 산업용 휴머노이드를 처음 공개. 연구실에서 현장으로 넘어가는 단계이나 판매 대수는 아직 두 자릿수.', effect: '±', hits: ['277810.KQ', '117730.KQ'], source: 'https://www.irobotnews.com/news/articleView.html?idxno=49437' },
      { date: '2026-04-15', actor: 'KR', kind: '정책', title: 'KIEP: K-휴머노이드 연합, 2028년 기반 모델·양산 목표, 2030년까지 민관 1조원 투자 기대', text: '레인보우·두산·LG전자·현대차 등 참여. 미국 정책 동향 보고서.', effect: '+', hits: ['277810.KQ', '454910.KS'], source: 'https://www.kiep.go.kr/galleryDownload.es?bid=0005&list_no=12364&seq=1' },
      { date: '2026-03-20', actor: 'CN', kind: '정책', title: '양회: AI·로봇을 15차 5개년 전략 산업으로, 휴머노이드 국가급 산업 격상', text: '중국은 공장·물류·도시에 "물리적 AI"를 가장 빨리 실현하는 나라라는 평가.', effect: '±', hits: ['277810.KQ', '454910.KS', 'TSLA'], source: 'https://economychosun.com/site/data/html_dir/2026/03/20/2026032000027.html' },
      { date: '2026-02-22', actor: 'KR', kind: '실적', title: '레인보우로보틱스: 3년 연속 적자인데 주가 급등, PER 업계 평균 크게 상회', text: '실적 개선 없이 테마 랠리가 겹친 결과라는 분석. 삼성전자가 인수 뒤 자사 AI와 결합 계획.', effect: '−', hits: ['277810.KQ'], source: 'https://www.fntimes.com/html/view.php?ud=202602221452452718dd55077bc2_18' }
    ],
    watch: [
      { when: '2027', what: '레인보우로보틱스 산업용 휴머노이드 양산 공급 · 테슬라 텍사스 공장' },
      { when: '2027 예산', what: '피지컬 AI 메가 프로젝트 예산 규모' },
      { when: '2028', what: 'K-휴머노이드 연합 기반 모델·양산 목표' }
    ]
  },
  {
    id: 'bio', name: '의료·바이오', short: '바이오',
    desc: '바이오시밀러·CDMO·신약. 미국 약가(MFN)와 의약품 관세, 생물보안법이 수요와 마진을 가른다.',
    etf: { KR: kr('266420.KS', 'KODEX 헬스케어'), US: us('XLV', 'Health Care Select ETF') },
    companies: [kr('207940.KS', '삼성바이오로직스'), kr('068270.KS', '셀트리온'), kr('000100.KS', '유한양행'), kr('196170.KQ', '알테오젠'), kr('326030.KS', 'SK바이오팜'), us('LLY', '일라이 릴리'), us('JNJ', '존슨앤드존슨'), us('PFE', '화이자')],
    stances: {
      US: '특허 의약품 232조 관세 시행(2026-09-29), 한국산 15%. 제네릭·바이오시밀러는 제외됐지만 1년 안에 재검토. MFN 약가(최혜국 가격) 초과분 환수. 생물보안법으로 중국 CDMO 거래 제한.',
      KR: 'CDMO(삼성바이오)는 고객사 단계에서 관세 적용, 셀트리온은 바이오시밀러 제외와 미국 현지 생산으로 "영향 해소" 입장. SK바이오팜은 자체 신약이라 15% 직접 영향.',
      EU: 'MFN 참조국에 포함돼 약가 인하 압력. 직접 수치는 이 자료에 없음.',
      CN: '생물보안법 대상(우시 등). 한국 CDMO의 반사 수혜 기대.',
      JP: '직접 이슈 적음.'
    },
    issues: [
      { date: '2026-09-30', actor: 'US', kind: '무역', title: '미국 의약품 관세 시행(9월 29일), 한국산 15%… 영향은 제각각', text: '제네릭·바이오시밀러는 제외. MFN 협정을 맺고 미국에 생산시설을 둔 기업은 면제 가능. 상무장관이 1년 안에 제외 품목 조정 필요성을 보고.', effect: '±', hits: ['326030.KS', '207940.KS', '068270.KS', 'PFE', 'LLY'], source: 'https://www.g-enews.com/article/Bio-Pharma/2026/09/202609301552053609b065b72042_1' },
      { date: '2026-04-06', actor: 'KR', kind: '실적', title: '셀트리온 "현지 생산 체제로 미국 관세 영향 완전 해소"', text: '미국 매출 대부분인 바이오시밀러가 관세 대상에서 빠졌고 록빌 공장 인수로 현지 생산을 늘렸다.', effect: '+', hits: ['068270.KS'], source: 'https://www.etnews.com/20260406000053' },
      { date: '2026-04', actor: 'US', kind: '정책', title: 'MFN 약가: 관세를 피했더니 약가 복병', text: '메디케어 약값이 MFN 기준을 넘으면 초과분을 미국 정부에 환수. 한국도 참조국에 포함돼 관세와 별개의 약가 리스크.', effect: '−', hits: ['LLY', 'JNJ', 'PFE', '326030.KS'], source: 'https://www.dailian.co.kr/news/view/1701477/' },
      { date: '2026-01-02', actor: 'US', kind: '정책', title: '생물보안법 발효 기대… 국내 CDMO 수혜 전망', text: '중국 바이오 기업과의 거래 제한. 삼성바이오로직스·셀트리온·에스티팜 등 CDMO와 소부장 수혜 예측(증권가).', effect: '+', hits: ['207940.KS', '068270.KS'], source: 'https://www.newsis.com/view/NISX20260102_0003463577' }
    ],
    watch: [
      { when: '2027-09까지', what: '제네릭·바이오시밀러 관세 제외의 1년 재검토' },
      { when: '수시', what: 'MFN 약가 협정 체결 기업 목록과 환수 규모' }
    ]
  },
  {
    id: 'battery', name: '2차전지', short: '2차전지',
    desc: '배터리 셀·소재. 미국 IRA 세액공제 축소와 전기차 수요 둔화로 ESS 전환 중. 중국 소재 관세·공급망이 변수다.',
    etf: { KR: kr('305720.KS', 'KODEX 2차전지산업'), US: us('LIT', 'Global X 리튬·배터리 ETF') },
    companies: [kr('373220.KS', 'LG에너지솔루션'), kr('006400.KS', '삼성SDI'), kr('003670.KS', '포스코퓨처엠'), kr('247540.KQ', '에코프로비엠'), kr('051910.KS', 'LG화학'), us('TSLA', '테슬라'), us('ALB', '앨버말')],
    stances: {
      US: '전기차 세액공제 종료, IRA 생산세액공제(AMPC) 조기 폐지 논의(공화당 지도부, 2028년까지). 우려국(중국) 광물 사용 시 공제 배제. 중국산 음극재 93.5% 반덤핑 예비판정(총 160%).',
      EU: '전기차 의무화 속도 조절(2035년 90% 완화안). 배터리 제조사 수요에 부담.',
      CN: '흑연·음극재 공급 지배. 미국 관세로 한국 기업은 호주(시라) 등으로 공급망 이전.',
      KR: '3사 모두 ESS로 전환. LG에너지솔루션은 AMPC 제외 시 적자(2026-01 보도), 삼성SDI·SK온은 AMPC 포함해도 적자.',
      JP: '파나소닉 등 경쟁. 직접 정책 이슈 적음.'
    },
    issues: [
      { date: '2026-01-20', actor: 'KR', kind: '실적', title: 'IRA 거품 걷어내니 빈 수레… 3사 ESS·로봇 전환 사활', text: '전기차 세액공제 종료 뒤 LG엔솔은 한 달에 13.5조원 규모 전기차 배터리 공급 계약을 취소. 3사 모두 ESS 시장으로.', effect: '−', hits: ['373220.KS', '006400.KS', '003670.KS', '247540.KQ'], source: 'https://m.news.nate.com/view/20260120n31816' },
      { date: '2026-01-17', actor: 'US', kind: '정책', title: '미 세액공제 폐지·유럽 전기차 속도 조절에 배터리 3사 시름', text: '살아나던 LG엔솔 주가도 하락. 유럽 2035년 규제 완화가 배터리 수요 전망을 낮췄다.', effect: '−', hits: ['373220.KS', '006400.KS'], source: 'https://news.nate.com/view/20260117n01268' },
      { date: '2025', actor: 'US', kind: '무역', title: '중국산 음극재 93.5% 반덤핑 예비판정(기본 관세 합산 160%)', text: 'LG에너지솔루션은 호주 시라에서 미국 내 천연흑연을 공급받기로. 탈중국 공급망 비용 상승.', effect: '±', hits: ['373220.KS', '003670.KS'], source: 'https://edaily.co.kr/News/Read?mediaCodeNo=257&newsId=03837606642236816' }
    ],
    watch: [
      { when: '2027 미 의회', what: 'AMPC 폐지 일정(민주당 다수 의회에서 재논의 가능 · 추론)' },
      { when: '분기마다', what: 'ESS 매출 비중과 AMPC 제외 영업이익' }
    ]
  },
  {
    id: 'defense', name: '방산', short: '방산',
    desc: '지상무기·항공·유도무기 수출. 폴란드 등 유럽 재무장과 EU SAFE의 역외 제한, 현지 생산 전환이 핵심이다.',
    etf: { KR: kr('449450.KS', 'PLUS K방산'), US: us('ITA', 'iShares 항공우주·방산 ETF') },
    companies: [kr('012450.KS', '한화에어로스페이스'), kr('064350.KS', '현대로템'), kr('047810.KS', '한국항공우주'), kr('079550.KS', 'LIG넥스원'), us('LMT', '록히드마틴'), us('RTX', 'RTX'), us('NOC', '노스럽그러먼')],
    stances: {
      EU: 'SAFE(우대 금리 국방 대출)는 역외(EU·EFTA·우크라이나 외) 부품 35% 상한. 폴란드 SAFE 75조원 중 역외 업체 접근 가능액은 약 11%(폴란드 매체 분석).',
      KR: '폴란드 누적 수주 한화 18.6조원. 단품 수출에서 현지 생산(천무 유도로켓 폴란드 생산, 2030 공급 개시)으로 전환. 1분기 한화 지상방산 영업이익 −31%(2026).',
      US: 'NATO 국방비 목표 상향과 미국 방산 우선 조달. 유럽 시장에서 한국과 경쟁.',
      CN: '직접 이슈 적음(수출 경쟁국).',
      JP: '방산 수출 규제 완화 추진. 직접 경쟁 제한적.'
    },
    issues: [
      { date: '2026-11-05', actor: 'KR', kind: '정책', title: '한화, 폴란드에서 천무 유도로켓 현지 생산… 유럽 탄약 기지 구축', text: '2030년 공급 개시 목표. 폴란드 공장 생산분이 곧바로 NATO 전체에 가는 것은 아니며 제3국 수출은 별도 계약·수출통제 필요.', effect: '+', hits: ['012450.KS'], source: 'https://www.asiatoday.co.kr/kn/view.php?key=20261105010001940' },
      { date: '2026-09-11', actor: 'EU', kind: '정치', title: 'MSPO 2026: 폴란드 국방비 GDP 4.8%, K2·천무·FA-50 유럽 수주전', text: '현대로템 폴란드형 K2, 한화 K9 전시. 폴란드의 자국 우선 조달 기조와 SAFE 유럽산 기준이 장벽.', effect: '±', hits: ['064350.KS', '012450.KS', '047810.KS'], source: 'https://www.newsway.co.kr/news/view?ud=2026091110234494445' },
      { date: '2026-07-09', actor: 'KR', kind: '실적', title: '현대로템 폴란드 K2 3차 계약(210대) 윤곽', text: '연내 체결 시 2026~2034년 납품, 폴란드 K2 총 570대. 체결 여부는 확인 필요.', effect: '+', hits: ['064350.KS'], source: 'https://www.fnnews.com/news/202607091020398407' },
      { date: '2026-04-17', actor: 'EU', kind: '정책', title: 'EU SAFE 역외 부품 35% 상한… 폴란드 SAFE 중 역외 접근 가능 약 11%', text: '"단품 수출은 끝났다": NATO·폴란드가 현지 생산·공동 개발을 요구. 1분기 한화 지상방산 영업이익 31% 감소와 연결 짓는 분석.', effect: '−', hits: ['012450.KS', '064350.KS', '079550.KS'], source: 'https://newsway.co.kr/news/view?ud=2026041714552216977' }
    ],
    watch: [
      { when: '2026 연내', what: '폴란드 K2 3차(EC3)·K9 3차 실행계약 체결 여부' },
      { when: '2027 이후', what: '페루 K2 등 신규 수주와 수출 마진 회복' }
    ]
  },
  {
    id: 'finance', name: '금융', short: '금융',
    desc: '은행·금융지주. 상법 개정·배당소득 분리과세 같은 주주환원 정책과 금리, 부동산 규제가 수익과 배당을 움직인다.',
    etf: { KR: kr('091170.KS', 'KODEX 은행'), US: us('XLF', 'Financial Select ETF') },
    companies: [kr('105560.KS', 'KB금융'), kr('055550.KS', '신한지주'), kr('086790.KS', '하나금융지주'), kr('138040.KS', '메리츠금융지주'), us('JPM', 'JP모건'), us('BAC', '뱅크오브아메리카'), us('GS', '골드만삭스')],
    stances: {
      KR: '상법 개정(이사 충실의무 주주 확대)과 배당소득 분리과세(최고세율 45%→30%, 배당성향 40% 이상 등 기준). 6·3 지방선거 광역단체장 민주 12·국힘 4로 여당이 지방권력도 장악해 정책 지속성 높음. 연 세수 감소 약 3,800억원 추산.',
      US: '중간선거로 민주당이 상·하원 장악(2027-01 개원). 금융 규제 완화 흐름은 느려질 수 있다(추론).',
      EU: '직접 이슈 적음.', CN: '직접 이슈 적음.', JP: '금리 정상화가 은행 수익에 우호적(일반론 · 출처 없음).'
    },
    issues: [
      { date: '2026-06-04', actor: 'KR', kind: '정치', title: '6·3 지방선거: 광역단체장 민주 12곳·국힘 4곳', text: '서울은 오세훈 5선, 부산은 민주 전재수. 여당이 지방권력도 장악해 증시 활성화·주주환원 정책의 지속 가능성이 커졌다(추론).', effect: '±', hits: ['105560.KS', '055550.KS', '086790.KS', '138040.KS'], source: 'https://www.newsis.com/view/NISX20260604_0003656115' },
      { date: '2026-01-22', actor: 'KR', kind: '정책', title: '코스피 5000: 상법 개정·배당소득 분리과세 "정책 드라이브 통했다"', text: '코리아 디스카운트 해소 대책과 반도체 호황이 맞물린 결과. 배임죄 남용 우려로 경영판단 원칙 명문화 등 보완 입법 논의.', effect: '+', hits: ['105560.KS', '055550.KS', '086790.KS', '138040.KS'], source: 'https://v.daum.net/v/20260122090445085' },
      { date: '2025-07-07', actor: 'KR', kind: '정책', title: '배당소득 분리과세: 최고세율 30%, 고배당 기업 기준 배당성향 40% 이상', text: '수혜주로 금융지주 등 고배당주가 거론. 세수 감소·부자 감세 논란 병존.', effect: '+', hits: ['105560.KS', '055550.KS', '086790.KS', '138040.KS'], source: 'https://www.fnnews.com/news/202507071130474062' }
    ],
    watch: [
      { when: '2026 정기국회', what: '3차 상법 개정·경영판단 원칙 명문화' },
      { when: '2027-01', what: '미국 민주당 다수 의회 개원 뒤 금융·AI 규제 방향' }
    ]
  },
  {
    id: 'platform', name: '인터넷·플랫폼', short: '플랫폼',
    desc: '포털·메신저·클라우드와 미국 빅테크. AI 투자 규모와 데이터센터·전력 규제, 플랫폼 규제가 변수다.',
    etf: { KR: kr('157490.KS', 'TIGER 소프트웨어'), US: us('QQQ', '나스닥100 ETF') },
    companies: [kr('035420.KS', 'NAVER'), kr('035720.KS', '카카오'), us('GOOGL', '알파벳'), us('MSFT', '마이크로소프트'), us('AMZN', '아마존'), us('META', '메타')],
    stances: {
      US: '빅테크의 AI 설비투자는 2026년 9개월간 약 4,967억 달러(보도). 중간선거 뒤 데이터센터 신규 건설 유예·전력 규제 강화 우려(샌더스 상원의원 등)가 기술주 급락 요인.',
      KR: 'AI 기본법 시행과 소버린 AI 투자. 플랫폼 규제(독점) 논의 지속(세부 출처 없음).',
      EU: 'DMA·AI법 집행(세부 출처 없음).',
      CN: '15차 5개년 계획에서 AI를 전략 산업으로. 미국 칩 통제 아래 자체 모델 경쟁.',
      JP: '직접 이슈 적음.'
    },
    issues: [
      { date: '2026-11-06', actor: 'US', kind: '정치', title: '민주당 의회 장악 뒤 AI 데이터센터·전력 규제 우려로 기술주 급락', text: '"규제가 있을 것 같은데 어느 정도일지 모른다"는 불안이 급락을 키웠다는 평가. 다음 변수는 미국 물가지표.', effect: '−', hits: ['GOOGL', 'MSFT', 'AMZN', 'META', '035420.KS'], source: 'https://www.fnnews.com/news/202611061559461085' },
      { date: '2026-11', actor: 'US', kind: '실적', title: '미 빅테크 9개월간 AI 투자 4,967억 달러… 삼성·SK 향방', text: 'AI 설비투자가 메모리 수요의 원천. 투자 속도가 꺾이면 반도체·플랫폼이 함께 흔들린다.', effect: '±', hits: ['GOOGL', 'MSFT', 'AMZN', 'META', '000660.KS', '005930.KS'], source: 'https://www.topstarnews.net/news/articleView.html?idxno=16271186' }
    ],
    watch: [
      { when: '2027-01 이후', what: '미 의회 데이터센터·전력 규제 법안' },
      { when: '분기마다', what: '빅테크 설비투자 가이던스' }
    ]
  },
  {
    id: 'power', name: '전력·원전', short: '전력',
    desc: '발전설비·원전·전력망. AI 데이터센터 전력 수요가 수주를 끌었고, 같은 이유로 미국 전력 규제 논의에 민감하다.',
    etf: { KR: kr('434730.KS', 'HANARO 원자력iSelect'), US: null },
    companies: [kr('034020.KS', '두산에너빌리티'), kr('015760.KS', '한국전력'), kr('052690.KS', '한전기술'), us('GEV', 'GE 버노바'), us('CEG', '컨스텔레이션 에너지')],
    stances: {
      US: '데이터센터 전력 수요로 가스터빈·원전 수주 급증. 중간선거 뒤 데이터센터 건설 유예·전력 사용 규제 논의가 변수.',
      KR: '체코 원전 수주 이후 추가 수출 추진, 전력망 확충(세부 출처 없음). 한전은 요금·부채 구조가 핵심.',
      EU: '원전을 녹색 분류에 포함, 각국 신규 원전 추진(세부 출처 없음).',
      CN: '원전 건설 세계 최다(세부 출처 없음).', JP: '원전 재가동 확대(세부 출처 없음).'
    },
    issues: [
      { date: '2026-11-06', actor: 'US', kind: '정치', title: '데이터센터 규제 우려가 전력 설비 수요 전망에도 영향', text: '반도체와 같은 뉴스에 묶여 움직인다. 규제의 실제 범위는 아직 법안이 없다.', effect: '±', hits: ['034020.KS', 'GEV', 'CEG'], source: 'https://www.fnnews.com/news/202611061559461085' }
    ],
    watch: [
      { when: '2027-01 이후', what: '미 의회 전력·데이터센터 법안' },
      { when: '수시', what: '원전 수출 계약(체코 후속 · 기타)' }
    ]
  }
];

// 섹터 공통(거시) 이슈: 모든 섹터 화면에 같이 보여 준다.
export const COMMON_ISSUES = [
  { date: '2026-11-04', actor: 'US', kind: '정치', title: '중간선거: 민주당이 상원(54석 전망)·하원 모두 장악', text: '새 의회는 2027-01 개원. 관세 입법·AI 규제·IRA 재논의 가능성이 생겼지만 결과는 미정. 선거 뒤 주가지수 선물은 올랐고 이틀 뒤 코스피는 급락했다(각각의 원인은 위 섹터 이슈 참고).', effect: '±', source: 'https://www.nbcnews.com/politics/2026-elections/senate-results' },
  { date: '2026-02-20', actor: 'US', kind: '무역', title: '대법원, IEEPA 상호관세 무효(6대3)… 122조 15% 관세로 대체 뒤 7월 24일 만료', text: '자동차·반도체·의약품 같은 232조 관세는 영향 없이 유지. 그 뒤 한국의 일반 품목 관세율은 자료마다 달라 확인 필요(301조 체계 보도).', effect: '±', source: 'https://globaltradealert.org/blog/from-ieepa-to-section-122' },
  { date: '2026-11-09', actor: 'KR', kind: '시장', title: '코스피 한 주 −11.7%, 외국인 닷새 10조원 순매도', text: '순매도의 72.9%가 두 종목(삼성전자·SK하이닉스)에 집중. 지수가 반도체에 얼마나 기대고 있는지 보여 준다.', effect: '−', source: 'https://www.seoul.co.kr/news/economy/securities/2026/11/09/20261109029001' }
];

export const ACTOR_NAME = { US: '미국', EU: 'EU', KR: '한국', CN: '중국', JP: '일본', IMO: 'IMO' };

// ── 보유 종목 → 섹터 ─────────────────────────────────────────
const EXTRA = { // 대표 회사 밖의 흔한 종목
  '005935.KS': 'semi', '009150.KS': 'semi', '058470.KQ': 'semi', 'AVGO': 'semi', 'AMD': 'semi', 'INTC': 'semi', 'ASML': 'semi', 'QCOM': 'semi', 'ARM': 'semi',
  '011200.KS': 'ship', '010620.KS': 'ship', '267250.KS': 'ship',
  '028300.KQ': 'bio', '302440.KS': 'bio', '128940.KS': 'bio', '000120.KS': null, 'ABBV': 'bio', 'MRK': 'bio', 'NVO': 'bio', 'UNH': 'bio', 'ISRG': 'robot',
  '096770.KS': 'battery', 'SKON': 'battery', '066970.KQ': 'battery', '086520.KQ': 'battery',
  '272210.KS': 'defense', '003570.KS': 'defense', 'GD': 'defense', 'HII': 'ship', 'BA': 'defense',
  '316140.KS': 'finance', '024110.KS': 'finance', '071050.KS': 'finance', '323410.KS': 'finance', '032830.KS': 'finance', '000810.KS': 'finance', 'WFC': 'finance', 'MS': 'finance', 'C': 'finance', 'V': 'finance', 'MA': 'finance', 'BRK-B': 'finance', 'BRK.B': 'finance',
  '259960.KS': 'platform', '036570.KS': 'platform', '263750.KQ': 'platform', 'AAPL': 'platform', 'NFLX': 'platform', 'CRM': 'platform', 'ORCL': 'platform', 'PLTR': 'platform',
  '010120.KS': 'power', '112610.KS': 'power', '267260.KS': 'power', 'VST': 'power', 'NEE': 'power', 'SMR': 'power'
};
const KEYWORDS = [[/반도체|semicon/i, 'semi'], [/자동차|automo|auto parts/i, 'auto'], [/조선|shipbuild/i, 'ship'], [/로봇|robot|automation/i, 'robot'], [/제약|바이오|의료|헬스|health|pharma|biotech/i, 'bio'], [/2차전지|배터리|전지|battery|lithium/i, 'battery'], [/방산|방위|항공우주|defense|aerospace/i, 'defense'], [/은행|금융|보험|증권|bank|financ|insur|capital markets/i, 'finance'], [/소프트웨어|인터넷|포털|게임|플랫폼|software|internet|interactive|media/i, 'platform'], [/전력|원자력|원전|에너지|유틸|electric|utilit|power|nuclear/i, 'power']];
const INDEX_ETF = /^(069500|102110|229200|360750|133690|379800|458730|SPY|VOO|IVV|QQQ|VTI|DIA|IWM|VEA|VWO|EFA|SCHD|VIG)$/;
const BOND_ETF = /^(TLT|IEF|SHY|BND|AGG|LQD|HYG|TIP|148070|114260|305080|439870)$/;
const LEVERAGE = /레버리지|인버스|2X|3X|^(TQQQ|SQQQ|SOXL|SOXS|UPRO|SPXL|TMF|TMV|122630|252670|233740|251340)$/i;

const BY_SYMBOL = new Map();
for (const s of SECTORS) { for (const c of s.companies) BY_SYMBOL.set(c.symbol, s.id); if (s.etf.KR) BY_SYMBOL.set(s.etf.KR.symbol, s.id); if (s.etf.US) BY_SYMBOL.set(s.etf.US.symbol, s.id); }
for (const [k, v] of Object.entries(EXTRA)) if (v && !BY_SYMBOL.has(k)) BY_SYMBOL.set(k, v);

export const sectorById = id => SECTORS.find(s => s.id === id) || null;
export const sectorName = id => ({ index: '지수 ETF', bond: '채권 ETF', other: '기타', unknown: '분류 없음' })[id] || sectorById(id)?.name || '분류 없음';

/** 종목 하나를 섹터로 분류한다. hint는 지표 API가 준 업종 문자열(있으면). 반환: 섹터 id | 'index' | 'bond' | 'other' | 'unknown' */
export function classify(symbol = '', name = '', hint = '') {
  const sym = String(symbol).toUpperCase(), code = sym.split('.')[0];
  if (BY_SYMBOL.has(sym)) return BY_SYMBOL.get(sym);
  for (const [k, v] of BY_SYMBOL) if (k.split('.')[0] === code && /^\d{6}$/.test(code)) return v;
  if (INDEX_ETF.test(code) || /^KODEX 200|^TIGER 200|S&P ?500|나스닥 ?100|코스피 ?200/i.test(name)) return 'index';
  if (BOND_ETF.test(code) || /국채|채권|bond|treasury/i.test(name)) return 'bond';
  const text = `${name} ${hint}`;
  for (const [re, id] of KEYWORDS) if (re.test(text)) return id;
  return hint ? 'other' : 'unknown';
}

export const SECTOR_CAP = { balanced: 40, growth: 50, value: 40, dividend: 35 }; // lib/portfolio-advice.js TARGETS와 같은 값

/**
 * 보유 종목의 섹터 분포와 집중도.
 * positions: [{symbol,name,valueKrw,hint?}] (hint = 지표 업종 문자열) · cashKrw: 원화 현금(모르면 null)
 * 반환: { stocks, rows:[{id,name,valueKrw,pct,symbols}], top, hhi, effective, cap, over:[{id,name,pct,cutKrw}], plan:[{id,name,nowPct,planPct}], cashToAdd }
 */
export function sectorExposure(positions = [], { cashKrw = null, style = 'balanced' } = {}) {
  const cap = SECTOR_CAP[style] ?? 40;
  const rows = new Map();
  let stocks = 0;
  for (const p of positions) {
    const v = Number(p.valueKrw); if (!Number.isFinite(v) || v <= 0) continue;
    const id = classify(p.symbol, p.name, p.hint); stocks += v;
    const r = rows.get(id) || { id, name: sectorName(id), valueKrw: 0, symbols: [] }; r.valueKrw += v; r.symbols.push({ symbol: p.symbol, name: p.name, valueKrw: v }); rows.set(id, r);
  }
  const list = [...rows.values()].map(r => ({ ...r, pct: stocks ? r.valueKrw / stocks * 100 : 0, symbols: r.symbols.sort((a, b) => b.valueKrw - a.valueKrw) })).sort((a, b) => b.valueKrw - a.valueKrw);
  // 집중도는 주식 안에서만 계산한다. 지수 ETF는 그 자체가 분산이라 상한을 적용하지 않는다.
  const capped = list.filter(r => r.id !== 'index' && r.id !== 'bond');
  const hhi = stocks ? list.reduce((a, r) => a + (r.pct / 100) ** 2, 0) : 0;
  const over = capped.filter(r => r.pct > cap).map(r => ({ id: r.id, name: r.name, pct: r.pct, cutKrw: Math.round(r.valueKrw - stocks * cap / 100) }));
  const cut = over.reduce((a, o) => a + o.cutKrw, 0);
  const plan = list.map(r => ({ id: r.id, name: r.name, nowPct: r.pct, planPct: over.some(o => o.id === r.id) ? cap : r.pct }));
  const total = stocks + (Number.isFinite(cashKrw) ? cashKrw : 0);
  return { stocks, total, rows: list, top: capped[0] || list[0] || null, hhi, effective: hhi ? 1 / hhi : 0, cap, over, cutKrw: cut, cutPctOfTotal: total ? cut / total * 100 : 0, plan, cashPct: Number.isFinite(cashKrw) && total ? cashKrw / total * 100 : null };
}

/** 보유 종목에 직접 걸린 이슈(hits에 종목이 있는 것). */
export function issuesFor(symbols = []) {
  const set = new Set(symbols.map(s => String(s).toUpperCase())), codes = new Set([...set].map(s => s.split('.')[0]));
  const out = [];
  for (const s of SECTORS) for (const i of s.issues) if (i.hits?.some(h => set.has(h) || codes.has(h.split('.')[0]))) out.push({ ...i, sector: s.id, sectorName: s.name });
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

// 수익률 계산(데이터 스크립트와 화면이 같이 쓴다): closes = [{date, close}] 오름차순
export function returnsFrom(closes = []) {
  const c = closes.filter(x => Number.isFinite(x.close) && x.close > 0); if (c.length < 2) return null;
  const last = c.at(-1), at = n => c[Math.max(0, c.length - 1 - n)].close, r = n => c.length > n ? last.close / at(n) - 1 : null;
  const year = last.date.slice(0, 4), prevYear = [...c].reverse().find(x => x.date < `${year}-01-01`), high = Math.max(...c.slice(-252).map(x => x.close));
  return { asOf: last.date, w1: r(5), m1: r(21), m3: r(63), m6: r(126), y1: r(252), ytd: prevYear ? last.close / prevYear.close - 1 : null, offHigh: last.close / high - 1, n: c.length };
}
