# PROJECT WORLD

> 모험가들이 살아 숨 쉬는 세계 — 2D 횡스크롤 오픈월드 샌드박스 MMORPG (PC 웹 브라우저)

Terraria식 샌드박스, MapleStory식 성장, SANABI식 연출을 참고하되 독자적인 세계관·그래픽·시스템으로 개발하는
상용 인디 게임 프로젝트입니다. 핵심 차별점은 **플레이어 없이도 스스로 살아가는 AI 모험가**입니다.

현재 단계: **PHASE 2 — 샌드박스 (완료)** · 다음: PHASE 3 RPG

![stack](https://img.shields.io/badge/TypeScript-6.0-3178c6) ![phaser](https://img.shields.io/badge/Phaser-3.90-8a4baf) ![react](https://img.shields.io/badge/React-19-61dafb)

## 빠른 시작

요구 사항: Node.js ≥ 22.12, pnpm 10, 최신 Chrome/Edge (WebGL)

```bash
pnpm install
pnpm dev          # http://127.0.0.1:5173
```

| 명령                                                                                    | 설명                                               |
| --------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `pnpm dev`                                                                              | 개발 서버 (HMR)                                    |
| `pnpm build`                                                                            | 타입 검사 + 프로덕션 빌드 (`apps/client/dist`)     |
| `pnpm preview`                                                                          | 프로덕션 빌드 미리보기                             |
| `pnpm test`                                                                             | 단위 테스트 (Vitest, shared + client)              |
| `pnpm e2e`                                                                              | E2E 스모크 테스트 (Playwright, 프로덕션 빌드 대상) |
| `pnpm typecheck` / `pnpm lint` / `pnpm format`                                          | 정적 검사                                          |
| `pnpm check`                                                                            | typecheck + lint + format 검사 + 단위 테스트       |
| `pnpm --filter @world/client art:preview <dir> [character\|tiles\|objects\|background]` | 절차적 아트를 PNG로 출력해 검수                    |

## 조작법

| 키                        | 동작                                                                     |
| ------------------------- | ------------------------------------------------------------------------ |
| `A` `D` / `←` `→`         | 이동                                                                     |
| `Space` / `X`             | 점프 (길게 누를수록 높이)                                                |
| `S` + `Space`             | 나무 발판 아래로 내려가기                                                |
| 마우스 왼쪽 (누르기/클릭) | 사용: 곡괭이로 채굴 · 도끼로 벌목 · 블록/횃불 설치 · 풀/꽃 채집          |
| `1`–`0` / 마우스 휠       | 단축 슬롯 선택                                                           |
| `I`                       | 인벤토리 · 제작 (클릭: 집기/놓기, 우클릭: 절반/하나)                     |
| `M`                       | 월드맵 (휠 확대 · 드래그 이동)                                           |
| `Enter`                   | 채팅 (`/help`, `/time <0-24>`, `/pos`, `/tp <x> <y>`, `/spawn`, `/seed`) |
| `C`                       | 캐릭터 정보                                                              |
| `F1`                      | 조작법                                                                   |
| `F3`                      | 디버그 정보                                                              |
| `Esc`                     | 메뉴 / 창 닫기                                                           |

월드 변경과 인벤토리는 브라우저(IndexedDB)에 자동 저장됩니다. 타이틀의 **새로 시작** 또는
설정의 **월드 초기화**로 지울 수 있습니다.

## 저장소 구조

```
apps/client        브라우저 클라이언트 (Phaser 3 렌더러 + React UI)
packages/shared    엔진 비의존 시뮬레이션 코어 (월드·생성·물리·게임 데이터) — 추후 서버와 공유
docs/              아키텍처, 로드맵, 서드파티 고지
```

자세한 설계는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), 단계별 계획은 [docs/ROADMAP.md](docs/ROADMAP.md)를 참고하세요.
