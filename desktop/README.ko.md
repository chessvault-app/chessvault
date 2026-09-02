# 데스크톱 셸

*[English](README.md) · 한국어*

처음 실행할 때 고르는 두 가지 모드가 있습니다(나중에 바꾸려면 설정의 데스크톱
앱 카드에서 보관함 행의 전환… 버튼 — 또는 Alt 뒤에 숨어 있는 Vault → Switch
vault… 메뉴):

- **원격** — 다른 곳에 있는 Chess Vault 서버를 들여다보는 창입니다. 순수한
  클라이언트입니다.
- **로컬** — 자체 호스팅입니다. 셸이 저장소의 서버를 자식 프로세스로
  띄우고(`node --import tsx server/index.ts`, 8788번 포트) 창을 거기로
  향하게 합니다. 저장소 자신의 `vault/`와 `data/`를 쓰며, 패키징된 빌드는
  `CHESS_VAULT_DIR` / `CHESS_VAULT_DATA`를 사용자별 앱 데이터로 향하게
  합니다.

실행: `npm run build`를 한 번 돌린 뒤(서버가 `dist/`를 서빙합니다)
`npm run desktop`.

## 단 하나의 규칙

웹 앱은 어느 모드에서든 같은 HTTP API와 주고받습니다. 셸은 앱에 API를 절대
노출하지 않습니다(모드 선택기의 IPC는 셸 설정이지 앱의 표면이 아닙니다). 이
덕분에 데스크톱 빌드는 언제든 걷어낼 수 있고, 웹 배포가 기준으로 남습니다.

## macOS에 설치하기

앱은 Apple Developer ID로 서명되지 않았고 노터라이즈도 되지 않았으므로,
macOS가 그냥 열어 주지는 않습니다. 무엇이 보이는지는 빌드가 무엇을 담고
있느냐에 따라 다릅니다:

- **"Chess Vault이(가) 손상되었기 때문에 열 수 없습니다."** 서명이 아예
  없는 경우로, 0.4.1 이전의 `mac.identity: null`이 만들던 것입니다. 손상된
  것이 아닙니다. arm64 macOS는 서명되지 않은 코드를 불러오기를 거부하고,
  Gatekeeper는 그것을 손상이라고 보고합니다. 앱을 Applications로 끌어다
  놓은 뒤 한 번만 고치면 됩니다:

  ```
  xattr -dr com.apple.quarantine "/Applications/Chess Vault.app"
  ```

  오른쪽 클릭 → 열기로는 이 경우가 *풀리지 않습니다*.

- **"…확인되지 않은 개발자가 배포했습니다."** 0.4.1에서 더한 애드혹
  서명입니다(지금은 `desktop/after-pack.mjs`의 일부). 앱을 오른쪽 클릭 →
  **열기** → **열기**, 한 번이면 됩니다. 위의 `xattr` 한 줄도 여기서
  통합니다.

둘 다 내려받은 파일에 대한 경고가 아닙니다. 누가 이 앱을 만들었는지 알 수
없다는 macOS의 말이고, 그것은 사실이며 누군가 Developer ID와
노터라이즈 비용을 내기 전까지는 계속 사실입니다 — 그때가 되면
`mac.identity`를 설정하고 애드혹 훅을 지우면 됩니다.

## 패키징

`npm run desktop:package` → `release/installer/Chess Vault Setup <v>.exe`
(NSIS 원클릭). `desktop:package:mac`은 dmg를, `desktop:package:linux`는
AppImage와 deb를 만듭니다. 과정은 이렇습니다:

1. `desktop/build-server.mjs`: 서버를 esbuild로 묶어
   `release/server/index.mjs`로, 데이터베이스 빌더들을
   (`build-refgames.mjs`, `build-puzzles.mjs`,
   `index-refgames-positions.mjs`, `optimize-refgames.mjs`) 그리고 빠른
   검색이 도는 상주 스캔 워커(`scan-worker.mjs`)를 그 옆에 만들고,
   better-sqlite3를 복사하며(v13은 Node-API 프리빌드를 제공합니다 —
   Electron 아래에서 ABI가 안정적이라 다시 빌드할 필요가 없습니다),
   `icon.ico`를 렌더링합니다.

   네이티브 코어(`native/target/release/chessvault-core`)도 **빌드해 둔
   경우** 그 자식들 옆에 복사합니다. 서버가 거기를 가장 먼저 보므로 그
   복사가 배포의 전부입니다. Rust 툴체인 없이 패키징해도 되고, 그럴 때는
   그렇다고 알려 줍니다. 설치 프로그램은 0.5.0 이전의 모든 릴리스가 그랬듯
   JavaScript 작업으로 돌아갑니다. CI는 러너마다 크레이트를 먼저 빌드하고,
   무엇을 올리기 전에 바이너리가 있는지 확인합니다.

2. `npm run build`: SPA를 (엔진과 모델 자산과 함께) `dist/`로.
3. `electron-builder`: `desktop/`을 asar에 담고, 서버 번들과 `dist/`는
   extraResources로 실어 서버의 `./dist` 정적 루트와 `REPO_ROOT`가 모두
   `resources/`로 해석되게 합니다.
4. `desktop/after-pack.mjs`: `release/server/node_modules`를 패키징된
   `resources/server/` 안으로 복사한 뒤, macOS에서는 앱에 애드혹 서명을
   합니다.

   이 복사가 있는 이유는 extraResources가 그것을 실어 주지 않기 때문입니다.
   app-builder-lib의 복사 필터는 `if (relative === "node_modules") return
   false`로 시작하므로, extraResources 원본의 루트에 정확히 그 이름으로 있는
   디렉터리는 `filter`가 무엇을 말하든 — 아무 말 없이 — 버려집니다. 0.4.2
   전까지 앱은 데이터베이스 드라이버 없이 나갔고, 모든 로컬 보관함이 실행
   즉시 "Cannot find package 'better-sqlite3'"로 죽었습니다. 훅은 복사가
   자리를 잡지 못하면 예외를 던지므로, 다음에 깨질 때는 앱이 아니라 빌드가
   깨집니다.

패키징된 로컬 모드는 번들된 서버를 Electron 자신의
Node로(`ELECTRON_RUN_AS_NODE`) 돌리며,
`CHESS_VAULT_DIR`/`CHESS_VAULT_DATA`를
`%APPDATA%/Chess Vault/{vault,data}`로 향하게 합니다 — 기기 프로필마다 새
보관함이 생깁니다.

패키징된 앱 안에서 퍼즐 풀과 참고 데이터베이스를 전부 만들 수 있습니다.
`build-puzzles.mjs`, `build-refgames.mjs`, `index-refgames-positions.mjs`,
`optimize-refgames.mjs`가 서버 번들 옆에 실려 있고, 서버는 저장소
스크립트보다 그것들을 먼저 쓰며, 네이티브 바이너리가 실려 있으면 그것을
둘보다 먼저 씁니다. `scan-worker.mjs`도 같은 자리에 실립니다. 빠른 검색을
켠 데이터베이스가 패키징된 앱 안에서도 묶은 색인을 들 수 있는 것은 그
덕분입니다.
설치 프로그램은 여기에 더해 첫 실행 때 시작용 참고 데이터베이스(포지션 색인
포함)를 심어 줍니다.

## 자동 업데이트

셸은 실행할 때 가져오는 피드로 스스로를 갱신합니다. 최신 버전과 받아야 할
설치 파일을 알려 주는 `latest.yml`, 그리고 그 설치 파일입니다. 둘 다 이
저장소의 GitHub 릴리스에서 옵니다.

헷갈리게 비슷한 이름의 파일 둘이 양쪽 끝에 관여합니다:

| | `app-update.yml` | `latest.yml` |
| --- | --- | --- |
| 있는 곳 | 설치된 앱 안 | 릴리스 위 |
| 하는 말 | "이 주소에 물어봐라" | "최신은 `<v>`이고, 여기 있다" |
| 쓰는 주체 | electron-builder가 번들 안에 | electron-builder가 설치 파일 옆에 |
| 바뀌는 때 | 설치 후에는 절대 안 바뀜 | 릴리스마다 |

둘 다 루트 `package.json`의 `build.publish`에서 나옵니다:

```
"publish": {
  "provider": "github", "owner": "chessvault-app", "repo": "chessvault",
  "releaseType": "draft"
}
```

`latest.yml`은 하나가 아니라 셋입니다 — 윈도우용 `latest.yml`,
`latest-mac.yml`, `latest-linux.yml` — 그리고 각 플랫폼의 업데이터는 자기
것만 가져갑니다. 셋이 **같은** 릴리스에 올라가야 하고, 그것을 사 주는 것이
`releaseType: draft`입니다. 몇 분씩 차이를 두고 끝나는 세 개의 매트릭스 잡이
그냥 두면 릴리스를 만들려고 경쟁하지만, 초안이 있으면 electron-builder가
그것을 찾아 덧붙입니다.

피드를 직접 호스팅하는 것도 여전히 됩니다. `build.publish`를
`{ "provider": "generic", "url": "${env.CHESS_UPDATE_URL}" }`로 되돌리면
아래의 서버 `/updates` 경로가 서빙합니다. 앱의 다른 어떤 부분도 업데이트가
어디서 오는지 알지 못합니다.

### 릴리스 내기

```
# 1. package.json의 "version"을 올리고 커밋
# 2. 검사, 태그, 푸시 — GitHub이 그 태그에서 빌드합니다
npm run desktop:release
# 3. 워크플로가 끝나면 초안을 확인하고 Publish
gh release view v<version> --web
```

세 주체가 순서대로 맡습니다:

| | 하는 일 |
| --- | --- |
| `release.sh` | 타입 검사와 테스트, 지저분한 트리·이미 있는 태그는 거부, 태그 푸시 |
| `desktop` 워크플로 | 윈도우·macOS·리눅스를 하나의 **초안** 릴리스에 빌드 |
| 사람 | 설치 파일 세 개가 다 올라왔는지 확인하고 초안을 공개 |

**릴리스에는 서버도, 개인 설정도 필요 없습니다.** 릴리스는 프로젝트의
속성입니다 — 버전, 태그, 그리고 그 커밋에서 만든 설치 파일 세 개 — 따라서
푸시 권한이 있는 사람이면 누구나 낼 수 있습니다. 예전에는 특정 서버를
배포하고 그 기계가 응답할 때까지 태그를 거부했는데, 그러면 릴리스가 개인
인프라에 접근 가능한지에 달리게 되고 다른 사람은 아예 낼 수 없었습니다.

서버 배포는 그 서버를 운영하는 사람이 따로 하는 일입니다.
`bash scripts/deploy.sh`, 또는 한 번에 하려면
`npm run desktop:release -- --deploy`.

둘은 여전히 관련이 있습니다. 원격 모드에서 데스크톱 앱은 **서버의** 웹
빌드를 불러오므로, 예전 커밋에 머문 서버는 방금 설치한 앱과 버전이
어긋납니다 — 설정에서 서버 버전과 셸 버전을 따로 보여 주는 이유입니다.
서버를 운영한다면 비슷한 시점에 배포하세요.

초안을 공개하기 전까지는 설치된 어떤 앱에도 아무것도 제안되지 않습니다.

### 피드 서빙하기

직접 호스팅하는 피드에만 해당합니다. 릴리스는 이제 GitHub으로 가며, 이
경로는 그것을 쓰고 싶지 않은 사람에게 `generic` 공급자를 선택지로 남겨 두는
장치입니다.

서버는 `CHESS_VAULT_UPDATES`(기본값 `<repo>/updates`, git에서 제외됨)의
내용을 `/updates/:file`로 노출합니다. 일부러 `/api` 바깥, 그리고 비밀번호
게이트 바깥에 두었습니다. 업데이터는 세션도 없고 세션을 얻을 방법도 없는
백그라운드 프로세스이기 때문입니다. 테일넷 전용 배포라면 네트워크가 곧
경계이고, 공개 배포라도 이것들은 어차피 설치 파일로 나눠 주는 바로 그
바이트이며, 모든 내려받기는 `latest.yml`의 sha512로 검증됩니다. 릴리스
형태의 파일 이름만 서빙하고 디렉터리 목록은 제공하지 않습니다.

### 릴리스 없이 빌드만 할 때

`desktop` 워크플로를 손으로 실행(`workflow_dispatch`)하면 아무것도 공개하지
않고 세 플랫폼 결과물을 워크플로 아티팩트로 받습니다. `v*` 태그가 아니면
`--publish never`가 전달되기 때문입니다. macOS 빌드를
얻거나(electron-builder는 맥이 아닌 곳에서 dmg를 만들지 못합니다) 셋 다
여전히 컴파일되는지 확인할 때 쓰는 방법입니다.
