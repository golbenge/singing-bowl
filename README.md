# Singing Bowl — 명상 타이머

정해진 시간에 사용자가 지정한 음향 파일(또는 내장 종소리)을 재생해 주는 **오프라인 PWA 타이머**입니다.
Svelte 5 + Vite 로 만들었고, GitHub Pages 에 배포해 iPhone 홈 화면에 설치해 씁니다.

- 배포 주소(예): `https://golbenge.github.io/singing-bowl/`
- 네트워크 없이 동작: 모든 데이터(프로젝트, 음향 파일)를 폰 안(IndexedDB)에만 저장합니다.

## 주요 기능

| 기능 | 설명 |
| --- | --- |
| 프로젝트 | 타이머 묶음. 이름을 지정하고 여러 개 만들 수 있습니다. |
| 시간대(cue) | 시작 후 N분 M초에 소리를 재생. 시간대는 몇 개든 추가할 수 있습니다. |
| 소리 지정 | 프로젝트에 **기본 소리**를 지정하고, 특정 시간대에만 **다른 소리**를 지정할 수 있습니다. |
| 소리 종류 | ① 앱에 포함된 **샘플 싱잉볼 녹음**(CC0, 약 30초) ② 사용자가 추가한 음향 파일(mp3/m4a/wav…) |
| 실행 제어 | ▶ 시작 · ⏸ 일시 중지 · ▶ 이어서 · ■ 종료. 일시 중지 동안에는 시간과 소리 예약이 모두 멈춥니다. |
| 진행 표시 | 경과 시간, 전체 길이, 다음 소리까지 남은 시간, 예상 재생 시각, 시간대별 재생/건너뜀 상태 |
| 부가 기능 | 볼륨 조절, 미리 듣기, 프로젝트 복제, 소리 이름 변경, 잠금 화면 컨트롤(Media Session), 화면 꺼짐 방지(Wake Lock) |
| 중단 복구 | 실행 중 앱이 종료되어도 다시 열면 “중단되었던 타이머”를 이어서 재생할 수 있습니다. |

## iPhone에서 사용하기

1. Safari 로 배포 주소를 엽니다.
2. 하단 **공유 → 홈 화면에 추가**를 선택합니다.
3. 홈 화면의 **Singing Bowl** 아이콘으로 실행합니다(주소창 없는 앱처럼 실행됩니다).
4. 앱을 한 번 열어 두면 서비스 워커가 모든 파일을 캐시하므로 **비행기 모드에서도** 실행됩니다.

> iOS는 홈 화면에 추가한 웹 앱만 전체 화면 PWA로 실행합니다. 첫 실행 후에는 네트워크가 필요 없습니다.

## 화면이 꺼져도 소리가 나는 이유 (중요)

브라우저의 `setTimeout` 은 화면이 꺼지면 멈추거나 아주 느려집니다. 그래서 이 앱은 타이머 대신
**Web Audio 예약 재생**을 씁니다.

- 시작 버튼을 누르는 순간 모든 소리를 미리 디코딩하고, 각 시간대의 소리를
  `AudioBufferSourceNode.start(정확한 시각)` 으로 예약합니다. → JS가 멈춰도 오디오 스레드가 정확히 재생합니다.
- iOS 오디오 세션이 끊기지 않도록 **무음 루프 오디오 요소**(약 -84dBFS, 사람이 들을 수 없음)를 함께 재생합니다.
- **Media Session** 을 연결해 잠금 화면/이어폰 버튼으로 일시 중지·재생·종료가 가능합니다.
- 화면이 켜져 있는 동안에는 250ms 주기로 진행 상황을 갱신하고, 혹시 예약이 누락된 소리가 있으면
  안전망으로 즉시 재생합니다(5초 이상 늦으면 ‘건너뜀’으로 표시).

iOS 특성상 한 번 소리를 낸 뒤에는 오디오 세션이 유지되지만, **다른 앱이 소리를 독점하면**
(예: 음악 앱, 통화) 재생이 밀릴 수 있습니다.

## 개발

```bash
npm install
npm run icons     # public/icons/*.png, public/favicon.png 생성(의존성 없이 직접 PNG 인코딩)
npm run dev       # 개발 서버 (http://localhost:5173/singing-bowl/)
npm run build     # dist/ 생성 (PWA: sw.js + manifest.webmanifest)
npm run preview   # 빌드 결과 미리보기 (http://localhost:4173/singing-bowl/)
npm run e2e       # headless Chrome 으로 실제 동작 검증
```

### E2E 테스트

`npm run e2e` 는 별도 의존성 없이(Node 내장 WebSocket + Chrome DevTools Protocol) Chrome 을
headless 로 띄워서

프로젝트 생성 → 시간 지정 → 시작 → **예약 시각이 정확한지** → 샘플 소리(약 30초) 적용 →
시간대별 다른 소리 적용 → 일시 중지/재개 → 종료 → 음향 파일 추가(형식 검증 포함)·삭제 →
예전 버전 프로젝트 자동 이전 → 새로고침 후 데이터 유지 → 중단 복구

까지 49가지를 검사합니다.

```bash
npm run build
npm run preview &        # 서버를 먼저 띄운 뒤
npm run e2e              # 필요하면 CHROME_PATH=/경로/Chrome npm run e2e
```

소리 예약 시각을 `when - now ≈ 2.000s`, `≈ 302.000s` 처럼 실제 값으로 확인하고, 예약된 버퍼의
길이(샘플 약 30초 / 사용자 파일 0.5초)로 “시간대마다 다른 소리”가 실제로 적용되는지도 검증합니다.
검사 항목은 `scripts/e2e.mjs` 에 있습니다.

## GitHub Pages 배포

이 저장소는 이미 다음 상태로 설정되어 있습니다.

- 저장소 공개 범위: **Public** (`https://github.com/golbenge/singing-bowl`)
- Pages: **활성화됨** — Settings → Pages → Source = **GitHub Actions** (`build_type: workflow`)
- 배포 주소: **https://golbenge.github.io/singing-bowl/**

`main` 브랜치에 푸시하면 `.github/workflows/deploy.yml` 이 `npm ci` → `npm run build` →
Pages 업로드/배포까지 자동으로 수행합니다. 진행 상황은 저장소의 **Actions** 탭이나 아래 명령으로 봅니다.

```bash
gh run list --limit 5
gh run watch               # 진행 상황 실시간 확인
```

### 처음부터 다시 설정할 때

1. 저장소를 **Public** 으로 둡니다(GitHub Free 는 **public 저장소에서만 Pages 사용 가능**하며,
   private 저장소에서 쓰려면 GitHub Pro/Team/Enterprise 가 필요합니다 —
   [문서](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)).
2. **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 선택합니다.
   (`actions/configure-pages` 가 배포 시 자동으로 설정하기도 합니다.)
3. 저장소 이름이 `singing-bowl` 이 아니면 빌드할 때 기준 경로를 바꿉니다.

```bash
BASE_PATH=/my-repo/ npm run build
```

> 저장소를 public 으로 두어도 **사용자의 음향 파일과 프로젝트 데이터는 저장소에 올라가지 않습니다.**
> 그것들은 각 기기의 IndexedDB 에만 저장되고, 저장소에는 소스 코드만 있습니다.

## 샘플 소리(싱잉볼) 출처와 교체 방법

앱에는 실제 싱잉볼 타격 녹음 1개가 함께 들어 있습니다(합성음이 아니라 실제 녹음입니다).

| 항목 | 내용 |
| --- | --- |
| 이름 | Tibetan Bowl Struck #1 (싱잉볼 타격음, 약 30초) |
| 파일 | `public/sounds/singing-bowl.m4a` (모노 48kHz AAC, 약 433KB) |
| 출처 | [BigSoundBank](https://bigsoundbank.com/tibetan-bowl-struck-1-s1110.html) |
| 저작자 | Joseph SARDIN |
| 라이선스 | **CC0 1.0 (퍼블릭 도메인)** — 출처 표기 불필요, 수정·재배포 허용 |

파일은 서비스 워커가 앱과 함께 미리 받아 두므로 **네트워크 없이도 재생**됩니다.

### 다른 소리로 바꾸고 싶을 때

1. `public/sounds/singing-bowl.m4a` 를 원하는 음원 파일로 교체합니다(파일 이름 유지).
   - iPhone은 **m4a(AAC)·mp3·wav** 를 재생합니다. (ogg/flac은 지원하지 않으니 변환이 필요합니다.)
   - 파일이 크면 앱 용량과 오프라인 캐시 크기가 커지니 10~30초 길이를 권장합니다.
2. `src/lib/bundled-sounds.js` 의 `durationMs`(목록에 표시되는 길이)만 실제 길이에 맞게 수정합니다.
3. `npm run build` 로 다시 빌드하면 끝입니다.

개인 음원을 쓰고 싶다면 코드를 고치지 않고 앱에서 **소리 보관함 → ＋ 음향 파일 추가**로 넣은 뒤
프로젝트의 기본 소리나 특정 시간대에 지정해도 됩니다(그 파일은 내 폰에만 저장됩니다).

### 아이폰에서 “음향 파일 추가” 시 파일이 선택되지 않을 때

| 원인 | 해결 |
| --- | --- |
| 파일이 iCloud에만 있고 기기에 내려받아지지 않음(구름 아이콘) | 파일 앱에서 그 파일을 한 번 열어(또는 길게 눌러 **다운로드**) 폰에 저장한 뒤 다시 시도 |
| 파일 선택기가 다른 위치를 보여 줌 | 파일 선택 화면에서 **탐색(Browse) → iCloud Drive → Downloads**(또는 On My iPhone)로 이동 |
| 아이폰이 지원하지 않는 형식(ogg · opus · flac 등) | mp3 · m4a(AAC) · wav 로 변환 (아래 참고) |

앱은 파일 형식 필터(`accept`)를 걸지 않고 **실제로 디코딩되는지**로 판단하므로, 확장자가 특이해도
내용이 재생 가능한 소리라면 추가됩니다. 소리가 아닌 파일을 고르면 안내 메시지와 함께 추가되지 않습니다.

형식 변환(macOS 기준, 별도 설치 없이 가능):

```bash
# wav/aiff/m4a 등 -> 아이폰 호환 m4a(AAC)
afconvert -f m4af -d aac -b 128000 input.wav output.m4a

# mp3 -> m4a 로 용량 줄이기
afconvert -f m4af -d aac -b 96000 input.mp3 output.m4a
```

## 데이터 저장 위치

| 데이터 | 저장소 | 비고 |
| --- | --- | --- |
| 프로젝트(이름·시간대·기본 소리·볼륨) | IndexedDB `singing-bowl > projects` | 기기 안에만 저장 |
| 사용자 음향 파일 | IndexedDB `singing-bowl > sounds` (Blob) | 서버 전송 없음 |
| 실행 중 상태(중단 복구용) | localStorage `singing-bowl:active-run` | 종료하면 삭제 |

소리 보관함 화면에서 **영구 저장 요청**을 눌러 두면 iOS가 저장 공간을 정리할 때 데이터가 지워질
가능성이 줄어듭니다. 데이터를 지우려면 브라우저 저장 공간을 삭제하거나 앱에서 프로젝트/소리를 삭제합니다.

## 프로젝트 구조

```
src/
├── App.svelte                  # 화면 전환(목록/편집/실행/소리), 설치 안내, 중단 복구 배너
├── app.css                     # 다크 테마 디자인 토큰과 공용 스타일
├── components/
│   ├── ProjectList.svelte      # 프로젝트 목록(만들기/복제/삭제/실행)
│   ├── ProjectEditor.svelte    # 이름·기본 소리·볼륨·시간대 편집(자동 저장)
│   ├── Runner.svelte           # 실행 화면(시작/일시 중지/재개/종료, 진행 표시)
│   ├── SoundLibrary.svelte     # 샘플 소리 + 내 소리 관리, 저장 공간
│   ├── SoundPicker.svelte      # 소리 선택 시트
│   └── Modal.svelte            # 하단 시트형 모달
└── lib/
    ├── engine.svelte.js        # 타이머 엔진(예약 재생·일시 중지·안전망·중단 복구)
    ├── audio-session.js        # AudioContext, 무음 루프, Media Session, 미리 듣기
    ├── bundled-sounds.js       # 앱에 포함된 샘플 소리 정의(출처·라이선스·교체 방법)
    ├── sound-loader.js         # 소리 ID → AudioBuffer(샘플 내려받기·디코딩·캐시)
    ├── store.svelte.js         # 프로젝트·소리 상태와 IndexedDB 영속화
    ├── db.js                   # IndexedDB 래퍼
    └── time.js                 # 시간 포맷 유틸

public/
└── sounds/singing-bowl.m4a     # 샘플 싱잉볼 녹음 (CC0, 오프라인 캐시 대상)
```

## 알려진 제약

- 시간대는 **시작 후 경과 시간** 기준입니다(타이머이므로 일시 중지가 가능합니다).
- 소리는 시작할 때 모두 디코딩합니다. 아주 긴 음원(수십 분)을 여러 시간대에 쓰면 메모리를 많이 씁니다.
  알림용 짧은 종소리·효과음 용도에 적합합니다(기본 샘플은 약 30초).
- 서비스 워커가 앱 파일과 샘플 음원을 함께 캐시하므로 오프라인 캐시 용량은 약 0.7MB입니다.
- iOS는 백그라운드 알림을 보장하지 않으므로 “알림”이 아니라 “소리 재생”으로 알려 줍니다.
- 앱이 완전히 종료되면 예약 재생도 끝납니다. 이 경우 앱을 다시 열어 ‘이어서 재생’을 사용하세요.


