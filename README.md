# HLTI; Hyundai Leadership Type Indicator

> 나를 움직이는 리더십 코드

제조 현장 파트장(1선 관리자) 대상 리더십 유형 진단 웹앱입니다.
Node.js + Express + Firestore. 버셀(서버리스) 배포를 전제로 합니다.

---

## 1. 빠른 시작

Node.js 20.11 이상이 필요합니다. (개발·검증은 Node 24 에서 했습니다.)

```bash
npm install
```

`.env.example` 을 복사해 `.env` 를 만들고 값을 채웁니다.

```bash
copy .env.example .env
```

**Firebase 서비스 계정 키가 없으면 실행되지 않습니다.** 이 앱은 응답을
Firestore 에만 저장합니다.

### .env 에 채울 값

| 이름 | 설명 |
|---|---|
| `FIREBASE_PROJECT_ID` | 서비스 계정 JSON 의 `project_id` |
| `FIREBASE_CLIENT_EMAIL` | 같은 JSON 의 `client_email` |
| `FIREBASE_PRIVATE_KEY` | 같은 JSON 의 `private_key` (큰따옴표로 감싸기) |
| `HLTI_SECRET_KEY` | 세션 쿠키 서명 키 |
| `HLTI_ADMIN_PASSWORD` | 관리자 비밀번호 (직접 정하세요) |

서비스 계정 키는 Firebase 콘솔 →
**프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성** 에서 받습니다.
받은 JSON 에는 필드가 11개 있지만 위 3개만 있으면 됩니다.

> JSON 전체를 `FIREBASE_SERVICE_ACCOUNT` 한 줄에 넣는 방식도 지원하지만,
> 값 안에 따옴표와 쉼표가 많아 배포 플랫폼의 .env 가져오기가 이를
> 여러 변수로 잘못 읽는 일이 있습니다. 3개로 나누는 쪽을 권합니다.

`HLTI_SECRET_KEY` 는 이렇게 만듭니다.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

그다음 실행합니다.

```bash
npm run dev
```

- 진단 화면: http://localhost:3000
- 관리자 화면: http://localhost:3000/admin

`npm run dev` 는 파일이 바뀌면 서버가 자동으로 다시 뜹니다.

---

## 1-1. 버셀 배포

깃허브에 푸시하면 버셀이 자동으로 배포합니다. 처음 한 번만 설정하면 됩니다.

1. 버셀에서 이 저장소를 Import
2. **Settings → Environment Variables** 에서 `.env` 를 그대로 Import 하거나 아래를 넣습니다

   ```
   FIREBASE_PROJECT_ID
   FIREBASE_CLIENT_EMAIL
   FIREBASE_PRIVATE_KEY
   HLTI_SECRET_KEY            랜덤 64자
   HLTI_ADMIN_PASSWORD        관리자 비밀번호
   HLTI_SECURE_COOKIE         1
   HLTI_TRUST_PROXY           1
   ```

3. 배포 후 `/` 와 `/admin` 접속 확인

`vercel.json` 이 모든 요청을 `api/index.js` 로 보내고, 그 파일이
`server.js` 의 앱을 서버리스 함수로 감쌉니다.

---

## 2. 현장 운영 순서

1. 진행자가 `/admin` 에 로그인하고 **세션 코드를 생성**합니다.
   (예: 세션 이름 "3월 파트장 교육 1차" → 코드 `4821` 자동 발급)
2. 참여자에게 코드를 알려 줍니다.
3. 참여자는 첫 화면에서 **코드 + 이름**을 입력하고 진단을 진행합니다.
4. 교육이 끝나면 진행자가 세션을 **종료**합니다. 종료된 코드로는 로그인할 수 없습니다.
5. 관리자 화면에서 통계를 확인하고 **CSV 를 내려받습니다.**

같은 세션에 같은 이름이 이미 있으면 로그인이 막힙니다.
다시 응시하게 하려면 세션 목록에서 **재응시를 "허용"** 으로 바꿔 주세요.

### 같은 네트워크의 휴대폰에서 접속하기

서버 PC 의 IP 를 확인한 뒤(`ipconfig`), 휴대폰 브라우저에서
`http://<서버IP>:3000` 으로 접속합니다. 같은 Wi-Fi 에 있어야 하며,
Windows 방화벽에서 3000 포트 허용이 필요할 수 있습니다.

---

## 3. 문구·문항 수정 (비개발자용)

코드를 건드리지 않고 `data/` 폴더의 JSON 파일만 고치면 내용이 바뀝니다.
**수정 후에는 서버를 재시작**해야 반영됩니다(시작할 때 1회만 읽어 캐싱하기 때문).
`npm run dev` 로 실행 중이라면 자동으로 다시 뜹니다.

| 파일 | 바꿀 수 있는 것 |
|---|---|
| `texts.json` | 진단명, 슬로건, 소개 문구, 버튼 글자, 결과 라벨, 안내 문구, 오류 메시지 |
| `types.json` | 4개 유형 설명, 과용 설명, 역량 이름 |
| `questions_part1.json` | Part 1 문항 12개 + 동점 판별 문항 |
| `questions_part2.json` | 유형별 Part 2 문항 6개 + 동점 판별 문항 |
| `characters.json` | 캐릭터 14개의 이름·설명·팁·파트너 메시지 |

### 주의사항

- JSON 문법을 지켜야 합니다. 쉼표·따옴표를 빠뜨리면 서버가 시작되지 않습니다.
  다만 **시작 시점에 어느 파일 어디가 잘못됐는지 알려 줍니다.**
- `texts.json` 의 `{name}`, `{type_name}` 처럼 중괄호로 감싼 부분은
  값이 자동으로 채워지는 자리입니다. **그대로 두세요.**
- 문구 안에서 줄을 바꾸려면 `\n` 을 씁니다.
- `key`, `type`, `competency`, `image` 같은 영문 식별자는 바꾸지 마세요.
  화면 표시용이 아니라 내부 연결에 쓰입니다.

> 결과 화면 하단 안내 문구는 `texts.json` 의 `result.disclaimer` 에 있습니다.
> (`types.json` 의 `result_disclaimer` 는 원본 보존용으로 남아 있을 뿐,
> 화면에는 `texts.json` 값이 표시됩니다.)

### 캐릭터 이미지 교체

`static/images/characters/` 안의 파일을 같은 이름으로 덮어쓰면 됩니다.
파일명은 `characters.json` 의 `image` 값과 일치해야 합니다.
원본(한글 파일명)은 `characters/` 폴더에 그대로 보존되어 있습니다.

---

## 4. 폴더 구조

```
leadership-test/
├── server.js                 앱 구성 · 템플릿 엔진 · 보안 헤더 · 오류 처리
├── package.json
├── .env.example              설정 견본 (복사해서 .env 로)
├── .gitignore
├── lib/
│   ├── config.js             설정(환경변수 읽기)
│   ├── content.js            JSON 로딩·검증·메모리 캐싱
│   ├── scoring.js            채점 로직 (Express 비의존 · 테스트 대상)
│   ├── db.js                 Firestore 저장 계층
│   ├── security.js           CSRF · 입력 검증 · 시도 제한 · 비밀번호 해시
│   ├── render.js             결과 화면 렌더링(참여자·관리자 공용)
│   ├── errors.js             InvalidFlow / HttpError
│   └── async-route.js        async 핸들러 오류 전달
├── api/index.js              버셀(서버리스) 진입점
├── vercel.json               버셀 라우팅 설정
├── routes/
│   ├── participant.js        로그인 → 예측 → Part1 → Part2 → 결과
│   └── admin.js              세션 관리 · 통계 · CSV · 결과 다시 보기
├── templates/                Nunjucks 템플릿 10개
├── static/
│   ├── css/style.css
│   ├── js/                   quiz.js · predict.js · result.js · html2canvas
│   └── images/characters/    화면용 캐릭터 이미지 14장
├── data/                     문항·문구 JSON 5개
├── characters/               원본 캐릭터 이미지 (보존용)
└── tests/scoring.test.js     단위 테스트
```

---

## 5. 라우트

### 참여자

| 메서드 | 경로 | 역할 |
|---|---|---|
| GET·POST | `/` | 로그인 (세션 코드 + 이름) |
| GET·POST | `/predict` | 캐릭터 예측 선택 (건너뛰기 가능) |
| GET·POST | `/q/p1/:index` | Part 1 문항 (1~12) |
| GET | `/q/p1/done` | Part 1 채점 분기 |
| GET·POST | `/tie/p1` | 유형 동점 판별 |
| GET | `/interlude` | Part 1 → Part 2 전환 안내 |
| GET·POST | `/q/p2/:index` | Part 2 문항 (1~6) |
| GET | `/q/p2/done` | Part 2 채점 분기 |
| GET·POST | `/tie/p2` | 역량 동점 판별 |
| GET | `/result` | 결과 (산출 후 세션 응답 원본 정리) |

### 관리자

| 메서드 | 경로 | 역할 |
|---|---|---|
| GET·POST | `/admin` | 비밀번호 로그인 |
| POST | `/admin/logout` | 로그아웃 |
| GET | `/admin/dashboard` | 세션 생성 · 목록 |
| POST | `/admin/sessions` | 세션 코드 생성 |
| POST | `/admin/sessions/:id/toggle` | 세션 종료 / 재개 |
| POST | `/admin/sessions/:id/retake` | 재응시 허용 / 차단 |
| GET | `/admin/sessions/:id` | 응답자 목록 + 통계 |
| GET | `/admin/sessions/:id/export.csv` | CSV 다운로드 |
| GET | `/admin/participants/:id` | 개별 결과 다시 보기 |

Part 2 의 URL 에는 유형이 드러나지 않습니다(`/q/p2/3`). 유형은 서버 세션에서
읽으므로, 주소를 고쳐 다른 유형 세트로 들어갈 수 없습니다.

---

## 6. 진단 로직

### Part 1 — 유형 판정 (12문항, 4지선다)

각 문항에서 **가장 먼저 할 행동(+1)** 과 **가장 나중에 할 행동(−1)** 을 고릅니다.
선택지마다 유형이 하나씩 붙어 있어, 문항당 4개 유형이 정확히 한 번씩 등장합니다.
유형별로 합산해 최고점이 나의 유형입니다.

최고점이 둘 이상이면 **동점 판별 문항**이 나옵니다.
이때 동점인 유형의 선택지만 보여 주고, "가장 먼저"만 고릅니다.

### Part 2 — 대표 역량 판정 (6문항)

판정된 유형의 세트를 풉니다. 채점 방식은 Part 1 과 같고, 축이 유형 대신 역량입니다.

| 유형 | 선택지 수 | 역량 수 |
|---|---|---|
| 커넥터 | 4지선다 | 4 |
| 마스터 | 4지선다 | 4 |
| 크리에이터 | 3지선다 | 3 |
| 드라이버 | 3지선다 | 3 |

### 결과

`유형 + 대표 역량` 조합으로 14개 캐릭터 중 하나가 정해집니다.
동점이 있었다면 결과에 **"함께 나타난 성향"** 으로 다른 후보 캐릭터도 표시됩니다.

### 예측 vs 결과 비교

`characters.json` 의 `type` 값을 비교해 세 가지로 나뉩니다.

| 경우 | 판정 |
|---|---|
| 예측 캐릭터 = 결과 캐릭터 | 완전 일치 |
| 캐릭터는 다르지만 `type` 이 같음 | 같은 유형 |
| `type` 이 다름 | 다른 유형 |

예측을 건너뛴 경우 이 섹션은 표시되지 않습니다.

---

## 7. 테스트

```bash
npm test
```

`node --test` 로 60개 케이스가 돌아갑니다. 채점 규칙, 2·3·4중 동점,
동점 판별 문항 필터링, 위조 제출 방어, 입력 검증, 비밀번호 해시,
시도 횟수 제한, CSRF, 그리고 실제 `data/` 파일 정합성(문항 수, 선택지 수,
캐릭터 매칭, 이미지 존재 여부)까지 검증합니다.

---

## 8. 보안 설계

| 항목 | 처리 |
|---|---|
| CSRF | 모든 상태 변경 요청에 세션 기반 토큰. `timingSafeEqual` 로 상수 시간 비교 |
| XSS | Nunjucks 자동 이스케이프 + 이름 입력 화이트리스트 검증 |
| 인라인 JSON | `<script type="application/json">` 에 `<`, `>`, `&` 를 유니코드로 이스케이프 |
| 인젝션 | Firestore 쿼리는 값 바인딩만 사용 |
| CSV 인젝션 | `=`, `+`, `@` 등으로 시작하는 문자열 앞에 `'` 삽입 (음수 점수는 제외) |
| 세션 쿠키 | HttpOnly · SameSite=Lax · Secure(환경변수로 전환) |
| 세션 | 서명된 쿠키에 보관(서버 상태 없음). 로그인 시 CSRF 토큰 재발급 |
| 관리자 비밀번호 | 평문 저장 안 함. PBKDF2-SHA256 240,000회 + 솔트 |
| 무차별 대입 | IP 단위 시도 제한을 Firestore 에 기록(인스턴스 간 공유) |
| 접근 통제 | 관리자 경로 전체 로그인 필수. 참여자는 본인 결과만 접근 |
| 진행 순서 | 앞 문항 미응답 시 건너뛰기 차단. 동점 후보 아닌 값 제출 거부 |
| 열린 리다이렉트 | `next` 파라미터는 앱 내부 경로만 허용 |
| 오류 메시지 | 내부 정보 비노출. 상세 사유는 서버 로그에만 기록 |
| 요청 크기 | 본문 64KB 제한 |
| HTTP 헤더 | CSP · X-Frame-Options · nosniff · Referrer-Policy |

CSP 가 `script-src 'self'` 이므로 외부 CDN 을 쓰지 않습니다.
`html2canvas` 도 `static/js/` 에 포함되어 있습니다.

### 메모리 관리

- JSON 5개는 시작할 때 1회 읽어 캐싱합니다(요청마다 파일 I/O 없음).
- 결과를 산출한 직후 응답 원본과 로그인 정보를 세션에서 제거합니다.
- 시도 제한기는 만료 항목을 자동 정리하고 키 개수 상한을 둡니다.
- Firestore 연결은 인스턴스가 살아 있는 동안 재사용합니다.

### 수집하는 개인정보

**이름 하나뿐입니다.** 그 외에는 예측/결과 캐릭터, 점수, 완료 시각만 저장합니다.

---

## 9. 운영 배포 시 확인할 것

- [ ] `.env` 에 `HLTI_SECRET_KEY` 지정
- [ ] `HLTI_ADMIN_PASSWORD` 대신 `HLTI_ADMIN_PASSWORD_HASH` 사용 권장
      (`node -e "console.log(require('./lib/security').hashPassword('비밀번호'))"`)
- [ ] HTTPS 적용 후 `HLTI_SECURE_COOKIE=1`
- [ ] 리버스 프록시 뒤라면 `HLTI_TRUST_PROXY=1`
- [ ] `HLTI_DEBUG=0` 확인
- [ ] Firestore 백업 설정 (콘솔에서 내보내기 예약)
- [ ] `.env` 와 서비스 계정 키 파일은 커밋 금지 (`.gitignore` 에 이미 포함)
