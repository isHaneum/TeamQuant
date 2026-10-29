# TeamQuant
자산 현황·승인 전략·3개월 검증·모의 운용·뉴스·적립 시뮬레이션. npm test, npm run dev.

## 본인 한국투자 계좌 조회
금융사 OAuth 간편 인증이 아닌 개인 Open API의 본인 잔고 조회. 다른 이용자에게 계좌를 공유하는 서비스가 아님.
Vercel Production 환경변수: KIS_APP_KEY, KIS_APP_SECRET, KIS_ACCOUNT_NO(앞 8자리), KIS_ACCOUNT_PRODUCT_CODE(뒤 2자리, 일반 01), KIS_MODE(prod 실제 계좌 / vps 한투 모의계좌), KIS_OWNER_ACCESS_TOKEN(32자 이상 무작위 암호).
키 발급·API 신청·본인 확인은 사용자가 한국투자증권에서 직접 수행. 서버에 키를 등록한 후 재배포, 사이트 내 계좌 버튼에 조회 암호만 입력.
조회 암호가 없거나 일치하지 않으면 상위 금융사 요청 금지. HTTP Authorization 헤더 사용, URL/브라우저 저장소에 암호 보관 금지. 실제 잔고는 화면 메모리에만 유지.
잔고 응답은 국내 주식+현금이며 금융사 전체 평가액과 다를 수 있음. 추가 조회 페이지가 있으면 불완전 결과 대신 오류. 주문 API 호출 없음. 금융사 키 자체가 조회 전용 권한이라는 의미는 아님.
현재 금융사 실키 미설정이므로 실제 계좌 실연동 검증 전. 서비스 PIN은 브라우저 체험용이며 금융사 인증과 별도.

## 데이터
NAVER_NEWS_PROVIDER=hub, NAVER_API_HUB_CLIENT_ID, NAVER_API_HUB_CLIENT_SECRET. DART_API_KEY는 종목 시장 확인에 사용. Yahoo 비공식 지연 일봉은 모의 검증용. DEMO 가격은 합성.
로컬 ML 연구는 운영 배포 제외. 비밀키와 개인 잔고는 Git에 올리지 말 것.


## Personal PC bridge
Vercel only serves UI; Toss keys and portfolio reads stay on localhost:8766. Set TOSS_KEY_FILE locally, npm run dev, log in to the local UI and issue a one-use code. Enter the code at https://teamquant.vercel.app in the same PC browser. Browser local-network permission may require manual approval. Codes expire in 2 minutes, sessions in 1 hour, and connections are lost on page reload. Assets refresh every 5 minutes while the tab is visible. Tokens and portfolios are memory-only; no financial data is added to cloud environment variables.
The local server binds 127.0.0.1, validates Host/Origin and pairs only the fixed production origin. POST read routes only; no brokerage orders. Actual holdings lack cash, so whole-account cash/concentration compliance is unavailable. Current-holdings historical comparison is a retrospective hypothesis with selection bias, not historical account performance or independent OOS proof. Symbol badges are identification marks, not official brand logos.
