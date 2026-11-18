# PROJECT WORLD

> 모험가들이 살아 숨 쉬는 세계 — 2D 횡스크롤 오픈월드 샌드박스 MMORPG (PC 웹 브라우저)

Terraria식 샌드박스, MapleStory식 성장, SANABI식 연출을 참고하되 독자적인 세계관·그래픽·시스템으로 개발하는
상용 인디 게임 프로젝트입니다. 핵심 차별점은 **플레이어 없이도 스스로 살아가는 AI 모험가**입니다.

현재 단계: **PHASE 1 — 게임 기반 구축 (완료)**

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

| 키                | 동작                                                                     |
| ----------------- | ------------------------------------------------------------------------ |
| `A` `D` / `←` `→` | 이동                                                                     |
| `Space` / `X`     | 점프 (길게 누를수록 높이)                                                |
| `S` + `Space`     | 나무 발판 아래로 내려가기                                                |
| `Enter`           | 채팅 (`/help`, `/time <0-24>`, `/pos`, `/tp <x> <y>`, `/spawn`, `/seed`) |
| `C`               | 캐릭터 정보                                                              |
| `F1`              | 조작법                                                                   |
| `F3`              | 디버그 정보                                                              |
| `Esc`             | 메뉴 / 창 닫기                                                           |

## 저장소 구조

```
apps/client        브라우저 클라이언트 (Phaser 3 렌더러 + React UI)
packages/shared    엔진 비의존 시뮬레이션 코어 (월드·생성·물리·게임 데이터) — 추후 서버와 공유
docs/              아키텍처, 로드맵, 서드파티 고지
```

자세한 설계는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), 단계별 계획은 [docs/ROADMAP.md](docs/ROADMAP.md)를 참고하세요.
