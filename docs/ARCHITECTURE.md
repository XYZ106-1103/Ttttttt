# PROJECT WORLD — 아키텍처

이 문서는 전체 목표(AI 모험가가 살아가는 상용 수준 2D 샌드박스 MMORPG)를 기준으로 한 구조 설계와,
PHASE 1에서 실제로 구현된 범위를 구분해 기록합니다.

## 1. 설계 원칙

1. **시뮬레이션과 렌더링의 분리** — 월드 데이터, 월드 생성, 물리, 성장 공식은 `packages/shared`에 있으며
   Phaser/DOM에 의존하지 않습니다. 같은 코드가 PHASE 6에서 서버의 권한 있는(authoritative) 시뮬레이션이 됩니다.
2. **결정론** — 모든 절차적 콘텐츠는 시드에서 파생되고(`deriveSeed`), 물리는 고정 스텝(60Hz)으로 진행합니다.
   같은 시드 + 같은 입력 → 같은 결과. 서버 검증·클라이언트 예측·리플레이의 전제 조건입니다.
3. **데이터 기반** — 타일·오브젝트·직업·이동 튜닝·지역은 `packages/shared/src/data/*`의 데이터입니다.
   새 타일/직업 추가 = 데이터 한 항목 추가 (+ 클라이언트 아트 레시피 한 항목).
4. **게임 ↔ UI 경계** — React UI는 Phaser 객체를 만지지 않습니다. 게임은 스토어에 (스로틀링해서) 쓰고,
   UI는 `GameBridge`의 명령/조회만 사용합니다.
5. **교체 가능한 아트** — 모든 그래픽은 현재 코드로 생성(절차적 픽셀 아트)되지만, 텍스처 키/프레임 이름
   규약(`render/textureKeys.ts`)을 따르므로 손으로 그린 아틀라스로 그대로 교체할 수 있습니다.

## 2. 패키지 구조

```
packages/shared/src
├── constants.ts            TILE_SIZE(16), CHUNK_SIZE(32), SIM_HZ(60)
├── math/                   rng(해시·sfc32), noise(value/gradient/fBm/주기형), scalar
├── data/                   tiles, objects, movement, classes(직업), regions
├── entities/stats.ts       STR/DEX/INT/VIT/LUK, 파생 능력치, 경험치 곡선, 레벨업
├── time/WorldClock.ts      시간대·낮밤·일차
├── world/
│   ├── Chunk.ts            32×32 타일, fg/bg Uint16Array, version/modified 플래그
│   ├── World.ts            청크 지연 생성, 타일 조회/변경 이벤트, 충돌 조회, 스폰
│   ├── TileRegistry.ts     데이터 → 고속 조회 테이블(충돌·투광·병합 그룹)
│   └── generation/         OverworldGenerator(높이맵·지층·스탬프·식생), startZone(시작 지역 데이터), stamps
└── physics/
    ├── TileCollider.ts     축 분리 AABB-타일 스윕, 단방향 발판
    └── CharacterMotor.ts   플랫포머 컨트롤러 (아래 4절)

apps/client/src
├── main.tsx                부트스트랩: 스토어·입력·브리지 생성, React 마운트, Phaser 시작
├── app/                    store, stores(앱/플레이어/월드/채팅/UI/디버그/설정), settings(localStorage), GameBridge
├── input/                  InputManager(KeyboardEvent.code 기반, IME 무관), keybindings
├── i18n/                   ko(기본)/en, 키 누락은 타입 오류
├── game/
│   ├── createGame.ts       Phaser 설정 (WebGL, pixelArt, RESIZE, 조명 파이프라인 등록)
│   ├── scenes/             BootScene(절차적 텍스처 생성·진행률), WorldScene(오케스트레이터)
│   ├── sim/GameSimulation  월드 + 시계 + 플레이어 캐릭터 (렌더링 코드 없음)
│   ├── FixedStepper.ts     고정 스텝 누산기 + 보간 alpha
│   ├── display.ts          정수 배율 정책 (1080p → 2×, 540 아트 픽셀)
│   ├── camera/             CameraController (룩어헤드, 착지 높이 기준 수직 추적, 흔들림)
│   ├── render/             ChunkRenderer, ObjectRenderer, LightGrid, LightmapRenderer, LightingPipeline, textures
│   ├── background/         ParallaxBackground, skyPalette (시간대 키프레임)
│   ├── entities/           CharacterView(애니메이션 FSM·스쿼시&스트레치), Spring, FrameEvents
│   ├── fx/                 ParticleFx (먼지·낙엽·반딧불·불씨)
│   ├── world/autotile.ts   이웃 마스크·변형 선택
│   └── art/                절차적 픽셀 아트 파이프라인 (5절)
└── ui/                     React HUD·창·화면, 디자인 시스템 CSS, 폰트 로더
```

## 3. 렌더링 구조

카메라 4개, 레이어 4개로 구성됩니다.

| 카메라  | 레이어       | 내용                                            | 비고                           |
| ------- | ------------ | ----------------------------------------------- | ------------------------------ |
| bg      | bgLayer      | 하늘 그라디언트, 별, 해/달, 구름, 4단 패럴랙스  | 시간대 틴트, 조명 미적용       |
| world   | worldLayer   | 청크 RenderTexture, 오브젝트, 캐릭터, 먼지/낙엽 | **LightingPipeline 포스트 FX** |
| overlay | overlayLayer | 불빛 글로우, 반딧불, 불씨                       | 발광체(조명 미적용, ADD)       |
| labels  | labelLayer   | 이름표 (추후 데미지 숫자)                       | 1× 배율 — 픽셀 폰트 원본 크기  |

- **청크 렌더링**: 비어 있지 않은 청크마다 512×512 RenderTexture에 한 번 굽고(`batchDrawFrame`),
  `chunk.version`이 바뀔 때만 다시 굽습니다. 카메라 주변만 스트리밍하며(프레임당 최대 2개 베이크,
  히스테리시스 2청크), 하늘만 있는 청크는 텍스처를 만들지 않습니다.
- **오토타일**: 4방향 연결 마스크(16) × 변형 3. 같은 병합 그룹(흙·잔디·돌)은 외곽선 없이 이어지고,
  돌은 "프린지" 오버레이로 흙 위에 들쭉날쭉한 경계를 그립니다.
- **조명**: `LightGrid`가 타일 단위 RGB 빛을 전파합니다(하늘 = 환경광, 모닥불 = 점광원, 타일별 `lightPass` 감쇠,
  4방향 스윕 2회). 결과를 작은 캔버스 텍스처(타일당 1텍셀, 이중선형 샘플링)로 올리고 world 카메라의
  포스트 FX 셰이더가 곱합니다. 하늘 카메라에는 적용되지 않으므로 배경이 이중으로 어두워지지 않으며,
  값 범위 0–2라 광원이 주변을 밝게(overbright) 만들 수 있습니다.
- **픽셀 퍼펙트**: 화면 높이에 맞춘 정수 배율(설정에서 1–4× 수동 선택 가능), 카메라 좌표를 화면 픽셀 격자에 스냅.

## 4. 이동·물리 (CharacterMotor)

`stepMotor(state, input, grid, config, dt)` — 순수 함수, 고정 스텝.

- 지상/공중 가속·감속 분리, 반대 방향 입력 시 빠른 전환(turnAccel)
- 가변 점프 높이(조기 해제 시 속도 컷), 정점 체공(점프 유지 시 중력 감소), 낙하 중력 배수
- 코요테 타임 0.1s, 점프 버퍼 0.12s
- 1타일 자동 오르기(Terraria식) + 1타일 내리막 스냅 (애니메이션 깜빡임 방지, 뷰에서 부드럽게 보간)
- 단방향 나무 발판, `↓ + 점프`로 내려가기
- 이벤트(점프/착지 속도/스텝/발판 통과)를 뷰·FX가 소비

튜닝 값은 전부 `data/movement.ts`에 있으며 단위 테스트가 점프 높이·코요테·버퍼·스텝·발판·결정론을 검증합니다.

## 5. 절차적 픽셀 아트 파이프라인

모든 생성기는 DOM 없는 `PixelCanvas`(Uint32 RGBA)에 그리므로 테스트·오프라인 미리보기(`art:preview`)가 가능합니다.

- **캐릭터(paper-doll + IK 리그)**: 64×64 프레임, 신장 약 50px(5.5등신)의 현실적 비율.
  `Appearance`(피부·헤어 5종·눈·의상 실루엣[롱코트/재킷/판초]·내의·포인트색·하의·신발·모자[고글/후드]·
  스카프[긴/짧은/복면]·숏 케이프·림라이트 색) → `CharacterComposer`가 포즈 테이블(`poses.ts`)을 래스터화.
  부위는 머티리얼 ID로 그린 뒤 일괄 셰이딩: 정면 상단 키 라이트, 뒤쪽 실루엣 림라이트, 머티리얼 색으로 물든
  셀아웃 외곽선, 코트 자락·스카프·케이프의 2차 모션(천 펄럭임). idle(8)·run(10)·jump·apex·fall·land·skid.
  플레이어 = 승인 디자인 A "방랑자"(`PRESET_WANDERER`). 프리셋 B 탐험가·C 그림자 순례자와
  `randomAppearance(seed)`로 AI 모험가마다 실루엣까지 다른 외형을 에셋 없이 생성합니다(PHASE 4).
  표현 기법은 시네마틱 픽셀 액션 게임을 참고했지만 캐릭터 디자인은 오리지널입니다.
- **타일셋**: 레시피(soil/grass/stone/mossy/platform/planks/wall/beam) × 마스크 16 × 변형 3 + 프린지.
- **오브젝트**: 참나무·소나무(블롭 캐노피 방향광), 덤불, 풀·긴 풀·꽃(바람 흔들림 4프레임), 바위, 버섯,
  모닥불(6프레임 불꽃), 표지판.
- **배경**: 주기형 노이즈로 가로 타일링되는 원경 설산·중경 산·원경 숲·근경 숲, Bayer 디더 대기 원근,
  구름·해·달·별.
- **색**: 색조 이동(hue-shift) 셰이딩 — 그림자는 청보라, 하이라이트는 노랑 쪽으로.

손그림 교체: 같은 텍스처 키와 프레임 이름(`run_0`…, `tree_oak_0_0`…, 타일 프레임 인덱스 규약)으로
아틀라스를 `BootScene.preload()`에서 로드하고 해당 생성 단계를 건너뛰면 됩니다.

## 6. UI

React 19 + 순수 CSS 디자인 시스템(토큰: `ui/styles/index.css`). Galmuri 픽셀 폰트(OFL).
상태 표시(초상화는 캐릭터 스프라이트에서 자동 생성), HP/MP/EXP, 미니맵(실제 월드 데이터, 3Hz),
시계/일차, 지역 배너, 채팅(로컬)·시스템 로그·개발 명령, 퀵슬롯, 메뉴 바, 드래그 가능한 창
(캐릭터 정보·설정·조작법), 일시정지 메뉴, 로딩/타이틀/오류 화면. 단축키는 `InputManager.onUiAction`.

> 메뉴를 열어도 월드는 멈추지 않습니다 — 영속 온라인 월드를 전제로 한 설계입니다(입력만 차단).

## 7. 향후 구조 (계획 — 아직 구현되지 않음)

```
apps/server (PHASE 6)     Node.js + TypeScript + WebSocket 게이트웨이, 존(zone) 시뮬레이션 프로세스
  ├── sim                 packages/shared 시뮬레이션의 권한 있는 실행, 입력 검증
  ├── persistence         PostgreSQL (계정·캐릭터·수정된 청크·경제), Redis (세션·프레즌스·큐)
  └── economy             거래소·상점 — 모든 거래 서버 검증, 아이템 복제 방지
packages/ai (PHASE 4–5)   Utility AI(행동 점수) + 행동 트리/FSM, 성격·기억·관계, LOD 시뮬레이션
                          (근거리=엔티티, 같은 지역=간소화, 원거리=추상, 오프라인=결과 계산)
packages/llm (선택)        LLM 대화 어댑터 — 별도 모듈, 게임 상태 직접 수정 불가, 사용자 승인 전 연결 금지
```

### AI 기능 도입 정책

외부 LLM/AI API는 **사용자 승인 없이 연결하지 않습니다**. 필요 시 목적·모델·예상 비용·대체 가능성·성능 영향을
먼저 보고합니다. AI 모험가의 이동·전투·채집·제작·성장·거래는 외부 API 없이 자체 게임 로직으로 구현합니다.
PHASE 1에는 어떤 AI 서비스도 연결되어 있지 않습니다.
