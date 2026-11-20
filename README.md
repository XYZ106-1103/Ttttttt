# PROJECT WORLD

> 모험가들이 살아 숨 쉬는 세계 — 2D 횡스크롤 오픈월드 샌드박스 MMORPG (PC 웹 브라우저)

Terraria식 샌드박스, MapleStory식 성장, SANABI식 연출을 참고하되 독자적인 세계관·그래픽·시스템으로 개발하는
상용 인디 게임 프로젝트입니다. 핵심 차별점은 **플레이어 없이도 스스로 살아가는 AI 모험가**입니다.

현재 단계: **PHASE 6 — 온라인·상용화 기반 (완료)** · 오프라인(싱글) + 온라인(서버) 모드

![stack](https://img.shields.io/badge/TypeScript-6.0-3178c6) ![phaser](https://img.shields.io/badge/Phaser-3.90-8a4baf) ![react](https://img.shields.io/badge/React-19-61dafb)

## 빠른 시작

요구 사항: Node.js ≥ 22.12, pnpm 10, 최신 Chrome/Edge (WebGL)

```bash
pnpm install
pnpm dev          # http://127.0.0.1:5173  (오프라인 플레이는 이것만으로 충분)
```

### 온라인 플레이 (게임 서버)

```bash
# PostgreSQL 없이 (메모리 저장 — 서버를 끄면 사라짐)
pnpm --filter @world/server dev                     # http://127.0.0.1:8787, 클라이언트 개발 서버가 /api·/ws를 프록시
# PostgreSQL 사용
DATABASE_URL=postgres://world:world@127.0.0.1:5432/world ADMIN_EMAILS=me@example.com pnpm --filter @world/server dev
```

`pnpm dev`로 연 클라이언트에서 타이틀의 **온라인 플레이** → 가입/로그인 → 캐릭터 생성 → 입장.
`ADMIN_EMAILS`에 넣은 이메일로 가입한 계정만 개발자 명령(`/level`, `/summon` …)을 쓸 수 있습니다.

### Docker (서버 + PostgreSQL)

```bash
docker compose up --build      # http://localhost:8787 — 서버가 빌드된 클라이언트까지 제공
```

외부에 열기 전에 `POSTGRES_PASSWORD`를 바꾸세요. 서버 환경 변수는 `apps/server/src/config.ts` 참고.

### Render 배포 (무료 플랜)

1. Render 대시보드 → **New → Blueprint** → 이 저장소 선택 → `render.yaml` 확인 후 **Apply**
   (게임 서버 1개 + PostgreSQL 1개가 싱가포르 리전에 생성됩니다).
2. 서버 서비스의 **Environment**에서 `ADMIN_EMAILS`에 관리자 이메일을 넣습니다(선택).
3. 첫 빌드(5–10분)가 끝나면 `https://<서비스 이름>.onrender.com` → **온라인 플레이**.

무료 플랜의 제약(측정값과 Render 안내 기준):

- CPU 0.1개: AI 모험가를 **10명**으로 줄여 실행합니다(30명이면 게임이 느려짐 — 0.1 CPU로 제한한 컨테이너에서
  측정: 10명 틱 평균 5.4ms·초당 갱신 19.4회, 30명 평균 30ms). 가끔 짧은 끊김이 있을 수 있습니다.
- 15분 동안 아무도 접속하지 않으면 서버가 잠들고, 다음 접속 때 깨어나는 데 약 1분 걸립니다(잠들기 전에 저장).
- 무료 PostgreSQL은 **생성 30일 후 만료**됩니다. 계속 쓰려면 DB를 유료로 올리거나 `DATABASE_URL`을 다른
  PostgreSQL(풀링 없는 직접 연결 주소)로 바꾸세요.

| 명령                                                                                                                       | 설명                                                          |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `pnpm dev`                                                                                                                 | 개발 서버 (HMR)                                               |
| `pnpm build`                                                                                                               | 타입 검사 + 프로덕션 빌드 (`apps/client/dist`)                |
| `pnpm preview`                                                                                                             | 프로덕션 빌드 미리보기                                        |
| `pnpm test`                                                                                                                | 단위·서버 테스트 (Vitest; PostgreSQL이 있으면 DB 테스트 포함) |
| `pnpm e2e`                                                                                                                 | E2E 테스트 (Playwright, 프로덕션 빌드 + 게임 서버 대상)       |
| `pnpm --filter @world/server build`                                                                                        | 서버 번들 (`apps/server/dist/server.mjs`)                     |
| `pnpm --filter @world/server loadtest -- --url <서버> --bots 100`                                                          | 부하 테스트 (봇 N명 접속·플레이, 틱 시간·대역폭)              |
| `pnpm typecheck` / `pnpm lint` / `pnpm format`                                                                             | 정적 검사                                                     |
| `pnpm check`                                                                                                               | typecheck + lint + format 검사 + 단위 테스트                  |
| `pnpm --filter @world/client art:preview <dir> [character\|tiles\|objects\|background\|items\|monsters\|combatfx\|skills]` | 절차적 아트를 PNG로 출력해 검수                               |

## 조작법

| 키                        | 동작                                                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `A` `D` / `←` `→`         | 이동                                                                                                                                    |
| `Space` / `X`             | 점프 (길게 누를수록 높이)                                                                                                               |
| `S` + `Space`             | 나무 발판 아래로 내려가기                                                                                                               |
| 마우스 왼쪽               | 들고 있는 것 사용 — 무기: 공격(누르고 있으면 연속 콤보, 활은 길게 눌러 차징) · 도구: 채굴/벌목 · 블록/횃불: 설치 · 물약: 마시기         |
| 공중에서 아래 조준 + 공격 | 내려찍기(검·단검, 적중 시 튕겨 오름)                                                                                                    |
| `Q` `E` `R` `F`           | 스킬 (필요한 무기가 단축 슬롯에 있으면 자동으로 바꿔 듦)                                                                                |
| `Shift`                   | 회피 (무적 시간, 공중 1회) · 공격 직전에 피하면 **완벽한 회피**(치명타 버프)                                                            |
| `H` / `J`                 | HP / MP 물약 바로 마시기                                                                                                                |
| `1`–`0` / 마우스 휠       | 단축 슬롯 선택                                                                                                                          |
| `I`                       | 인벤토리 · 제작 · 장비 (장비 우클릭: 바로 장착)                                                                                         |
| `C`                       | 캐릭터 정보 · 스탯 분배 · 전직                                                                                                          |
| `K`                       | 스킬 창 (스킬 배우기 · 단축키 등록)                                                                                                     |
| `M`                       | 월드맵 (휠 확대 · 드래그 이동)                                                                                                          |
| `O`                       | 모험가 명부 (AI 모험가 30명 — 레벨·직업·하는 일·위치·호감도)                                                                            |
| `G`                       | 길드 창 (내 길드 · 세계의 길드 목록)                                                                                                    |
| 마우스 오른쪽 (캐릭터)    | 모험가 정보 카드 (성격·목표·기억·관계·길드, `F3` 켜면 행동 점수) · 카드의 **대화하기**로 대화·파티·거래·길드                            |
| 마우스 오른쪽 (NPC)       | 마을 NPC와 대화 — 잡화상(상점), 거래소 관리인(거래소), 길드 관리인(길드 창설)                                                           |
| `Enter`                   | 채팅 (`/help`, `/time <0-24>`, `/pos`, `/tp <x> <y>`, `/spawn`, `/seed`) · 온라인: `Tab` 채널 전환, `/a` `/s` `/p` `/g`, `/w 이름 내용` |
| 마우스 오른쪽 (플레이어)  | 온라인: 다른 플레이어 메뉴 — 파티 초대 · 거래 요청 · 귓속말                                                                             |
| `F1` / `F3` / `Esc`       | 조작법 / 디버그 정보 / 메뉴·창 닫기                                                                                                     |

개발자 명령(오프라인에서는 누구나, 온라인에서는 관리자 계정만): `/level <n>`, `/summon <몬스터 id>`,
`/give <아이템 id> [개수]`, `/gold [n]`, `/heal`, `/peace`(몬스터 생성 끔), `/monsters`(다시 켬).

오프라인 모드에서는 월드 변경, 인벤토리, 레벨·직업·스킬·장비·골드, AI 모험가(성장·소지품·목표·기억·관계), 경제(거래소·시세·상점 재고)와
사회(파티·길드·소식)가 브라우저(IndexedDB)에 자동 저장됩니다. 온라인 모드에서는 서버(PostgreSQL)가 저장합니다. 게임을 닫아 둔 동안에도 모험가들은 최대 2시간분의 생활을 이어 갑니다. 타이틀의 **새로 시작** 또는
설정의 **월드 초기화**로 지울 수 있습니다.

## 소리

모든 효과음과 배경음악은 음원 파일 없이 브라우저 오디오(Web Audio)로 그 자리에서 합성됩니다(`apps/client/src/game/audio`).

- 효과음 48종: 이동(땅 재질별 발소리)·전투·마법·몬스터·보스·채굴·벌목·설치·획득·성장·UI·알림. 다른 캐릭터의 소리는 거리와 좌우 방향에 따라 작아지고 이동합니다.
- 배경음악 6곡(타이틀·낮·밤·동굴·마을·보스전): 장소와 시간에 따라 자동으로 바뀌고, 코드로 작곡된 악절이 변주되며 이어집니다.
- 환경음: 바람(지상), 밤벌레(밤), 물방울(동굴).
- 설정 창에서 전체·배경음악·효과음 음량을 조절합니다. 브라우저 정책상 첫 클릭 이후 소리가 납니다.

## 저장소 구조

```
apps/client        브라우저 클라이언트 (Phaser 3 렌더러 + React UI, 오프라인 시뮬레이션 + 온라인 복제본)
apps/server        권한 게임 서버 (Node.js, WebSocket, PostgreSQL, 계정)
packages/shared    엔진 비의존 시뮬레이션 코어 + 네트워크 프로토콜 — 클라이언트와 서버가 같은 규칙을 실행
docs/              아키텍처, 로드맵, 서드파티 고지
```

자세한 설계는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), 단계별 계획은 [docs/ROADMAP.md](docs/ROADMAP.md)를 참고하세요.
