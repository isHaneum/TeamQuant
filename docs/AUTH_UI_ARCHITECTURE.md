# TeamQuant 인증·UI 아키텍처 개편안 — 2026-11-02

상태: UI 통합 1단계 구현. 정식 회원·MFA·회원별 금융정보 접근·지속 계좌 연결은 미구현. 아래는 설계 기준이며 구현 완료 선언이 아니다.

## 1. 코드와 변경 지점
- app.js: sessionStorage의 teamQuantSession과 localStorage의 teamQuantUsers/PIN 해시 및 teamQuant:user:*를 사용. 이는 체험 프로필이며 금융 인증으로 승격하지 않는다. 향후 UI 상태 저장과 회원 세션을 분리한다.
- overview-ui.js / planner-ui.js / performance-ui.js / asset-hub-ui.js / journey-ui.js: 각 화면을 직접 생성. 새 workspace-ui.js가 기존 노드·ID·이벤트를 유지하며 두 메뉴의 세부 화면으로 조합한다. 계산 엔진을 재작성하지 않는다.
- bridge-client.js / lib/local-bridge.js: 탭 메모리 capability, 1회 코드·1시간 만료, 정확한 Host/Origin 검사. PC 권한은 체험 프로필과 독립적이며 PC별 장부 전체 범위다. UI 이전이 이 권한을 변경하지 않는다.
- lib/private-account.js / account-ui.js: 한투 단일 소유자 조회 암호는 회원별 인증이 아니다. 미래 다중 사용자 제품에서는 소유자 암호 경로를 폐지·비활성화하고 회원 소유 connection_id 검증으로 교체한다. 이번 단계에서 동작이나 권한을 확대하지 않는다.
- lib/history-store.js / performance-store.js / investment-store.js: PC 파일 저장. 서버 사용자별 DB가 아니므로 브라우저 프로필을 바꿔도 금융 데이터 격리가 되지 않는다.

## 2. 화면 구조
메인 메뉴는 내 자산 / Strategy Lab 두 개다. 기존 화면은 삭제하지 않는다.
- 내 자산: 자산 현황, 보유 종목·거래(종목별 뉴스 포함), 과거 투자 성과, 목표·ETF 적립, 판단 기록. 손익 기여도 전체 자동 분석은 데이터 범위가 확보될 때 추가한다. 현금·입출금 미확인 값을 만들지 않는다.
- Strategy Lab: 투자 원칙 변환·승인, 백테스트·시장 비교, 적립·배분 시뮬레이션, 모의 운용, 시장 뉴스, 로컬 모델 연구(기존 배포 차이 유지).
- 우측 설정: 체험 프로필/로그아웃, 증권사·PC 연결, 보안 범위, 데이터 관리, FAQ. 연결코드 폼은 여기로 이동. 각 자료의 JSON/CSV 내보내기와 보관함은 원래 화면에도 유지.
긴 기간의 기존 엔진·자료 선택은 유지하지만 새로운 장기 검증 파이프라인을 구현했다고 표시하지 않는다.

## 3. 인증 및 계좌 연결 목표 구조
검증된 IdP(Auth0 OIDC를 설계 후보로 선택) + BFF + 서버 세션 저장소 + 소유자 제약 DB를 제안한다. 공급자 계정/설정은 아직 없다.
브라우저 → BFF → IdP Authorization Code/PKCE → issuer/audience/state/nonce 검증 → 내부 user UUID 생성. 외부 sub는 (issuer,subject) unique mapping. MFA 등록·challenge·복구는 IdP의 검증된 흐름을 사용한다. 금융 연결·내보내기·삭제에는 재인증/MFA step-up을 요구한다.
브라우저에는 불투명 세션 ID의 Secure/HttpOnly/SameSite 쿠키만 제공. IdP access/refresh 토큰은 서버 측 암호화 저장; localStorage/sessionStorage/URL에 토큰·비밀번호·증권사 키 금지. 쿠키는 JS 접근 불가이며 금융 API 토큰 자체가 아니다. 세션 회전, idle/absolute 만료, CSRF 토큰+Origin, 로그인 rate limit, logout의 서버 세션 폐기 및 전체 장치 세션 철회가 필요하다. 클라이언트 user_id를 신뢰하지 않는다.

금융 연결은 두 경로로 분리한다.
A. 제휴 허용이 확인된 경우: 회원 → 연결 동의/범위 기록 → 금융사 공식 위임 → 서버 adapter → KMS envelope-encrypted secret store. 회원과 connection UUID를 연결하고 모든 조회를 소유권 검사한다. 고정 egress IP·공급자 허용 여부 검증 후에만 운영한다. 토큰 갱신은 잠금·중복 방지·만료 처리하며 로그에 키/계좌번호 금지. 조회 adapter에 주문 메서드를 넣지 않는다.
B. 제휴/서버 보관이 미확인인 현재: 키는 PC에 유지. 장기 대안은 OS 보안 저장소의 장치 키 + 사용자 승인된 장치 등록 + 회원에 결합된 공개키 + 단기 서명 challenge이다. 매 요청 audience/origin/nonce/expiry/replay 검증, PC 취소·기기 분실 철회, 명시적 허용 화면이 필요하다. 브라우저에 영구 bridge token을 저장하거나 기존 코드 만료를 늘리는 방식은 채택하지 않는다. 현재는 기존 일시 pairing만 유지한다. 지속 연결은 아직 구현하지 않는다.

### 공식 API 확인과 미확정 사항
- 토스 공식 가이드 https://developers.tossinvest.com/docs : OAuth2 토큰 발급 및 허용 IP 등록 안내 확인. 기존 adapter는 client credentials와 expires_in 기반 메모리 재사용을 사용한다. 문서 본문은 JS 렌더링이며 llms.txt 원문을 이번 검토 도구로 가져오지 못했다. 고정 만료 시간, refresh 지원, 제3자 서버 보관·상업 제공 허용, 조회 전용 scope 분리 가능 여부는 승인 미정이다. 개인 키 보유를 제3자 위임 동의로 취급하지 않는다. 공식 약관 목록 https://p.tossinvest.com/en/business 의 Open API 약관 원문/서면 확인이 필요하다.
- 한투 https://apiportal.koreainvestment.com/about-howto : 개인 App Key/Secret, access token 24시간 안내 및 제휴 서비스의 별도 계약 요구 확인. 비제도권 핀테크 제휴 제한이 안내되어 있다. https://file.koreainvestment.com/updata/namo/오픈API서비스이용약관_전문.pdf 는 제휴 이용기관 사용자용 약관이며 개인 계약과 혼동하지 않는다. 고객 키의 제3자 서버 보관, 개인 고객 IP 정책, 읽기 전용 권한 발급과 갱신 세부사항은 계정 유형별 공식 확인 전 미확정으로 둔다. Vercel 고정 출구 IP를 가정하지 않는다.
- Auth0 토큰 보관 근거 https://auth0.com/docs/secure/security-guidance/data-security/token-storage : backend가 있는 구조에서 서버가 토큰을 취급하는 방식을 참고. 구체 세션 수명·MFA 요금/플랜·데이터 보관지역은 선정 검토 대상이다.
이는 제품 설계 검토이며 법적 허용 판단 완료가 아니다. 실제 주문은 현 범위에 포함하지 않는다.

## 4. 데이터 모델과 이전
users(id), identities(user_id,issuer,subject), devices(user_id,public_key,revoked_at), connections(user_id,broker,secret_ref,scope,status), portfolios(user_id,connection_id,kind), observations, flows, transactions, goals, allocations, strategy_versions, approvals, paper_runs, decisions, sessions, audit_events를 분리한다. 모든 금융 테이블에 user_id와 owner 제약을 두고 RLS/서버 소유권 검증을 함께 시험한다. kind는 ACTUAL / BACKTEST / PAPER / FORECAST로 고정하며 원천 시각·수집 시각·통화·자료 완전성·해시를 보존한다.
브라우저의 프로필 ID를 서버 UUID로 자동 전환하지 않는다. 인증 완료 후 사용자가 선택한 로컬 기록의 미리보기·원천 확인·중복 해시 점검·이전 동의·건수/잔고 대조를 거쳐 import receipt를 만든다. PIN 해시는 이전하지 않는다. 계좌번호나 API 키를 일반 import에 포함하지 않는다. PC 파일은 동의 전 업로드하지 않는다. 원본은 백업하고 새 저장소로 복사하며 원본 삭제는 별도 명시적 요청/보존 정책을 따른다. 실패 시 새 import만 롤백하고 재시도는 멱등 처리한다. 거래 이력만으로 현금·입출금·배당을 복원했다고 간주하지 않는다.
계정 삭제는 재인증 후 sessions/devices/connection 권한 즉시 철회 → 진행 작업 차단 → 공급자 토큰 폐기 가능 여부 확인 → 대상 데이터 삭제 큐 → 보존 의무/백업 만료 안내와 완료 증빙. 계좌 연결 해제와 거래 원장 삭제는 별도 선택이다. PC 오프라인 원본 삭제는 서버에서 완료했다고 주장하지 않는다. 복구는 IdP 검증 경로만 사용하며 금융 권한 복원에는 추가 재인증을 요구한다.

## 5. 단계와 종료 조건
1. UI 조합: 두 메인 메뉴와 설정, 기존 ID/이벤트·PIN 자료 보존, demo 경로 및 주요 화면 전환 확인. 현재 구현 범위.
2. 인증 기반: 개발용 IdP·세션 DB 설정 후 로그인/로그아웃/MFA/복구/세션 철회·CSRF·만료 시험. 금융 조회는 기본 deny.
3. 회원 소유 데이터: schema/RLS·서비스 계정 경계·교차 사용자 403 시험, 명시적 선택 import·실패 복구·중복 시험.
4. 계좌 연결: 약관/제휴·키 보관 승인과 egress 검증 후 한 가지 broker 또는 PC 장치 연결만 pilot. 기기 철회·IP 변경·토큰 만료·공급자 오류 시험.
5. 통합 pilot: 합성 데이터 후 제한된 본인 계좌 읽기만 시험, 삭제/복구·감사·누출 검토 후 확대. 실제 주문은 별도 프로젝트 승인과 설계 필요.

## 6. 위험과 검증
IDOR/BOLA(다른 user/connection UUID 조회·export 차단), XSS(금융 화면 escape/CSP/외부 스크립트 축소), CSRF/Origin 우회, 세션 고정·재사용·철회, MFA bypass/recovery 탈취, 공용 PC 프로필 오인, 로그/오류/번들/백업의 비밀 유출, KMS 권한 과다, 장치 도난·nonce 재사용, 로컬 네트워크 rebinding, 토큰 갱신 경합, 삭제 큐 실패, 자료 중복·통화 혼합·누락 현금·가상 성과 혼동을 시험한다. 합성 fixtures만 테스트/화면 증빙에 사용한다. UI에서 항목을 숨기는 것은 접근 제어가 아니다. 기존 PC bridge 및 한투 소유자 암호는 회원별 보안 아키텍처를 충족하지 않으며 다음 단계의 교체 대상이다.
