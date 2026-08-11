# 데스크톱 셸

*[English](README.md) · 한국어*

처음 실행할 때 고르는 두 가지 모드가 있습니다(바꾸려면 보관함 →
전환…):

- **원격** — 다른 곳에 있는 Chess Vault 서버를 들여다보는 창입니다.
  순수한 클라이언트입니다.
- **로컬** — 자체 호스팅입니다. 셸이 저장소의 서버를 자식
  프로세스로 띄우고(`node --import tsx server/index.ts`, 8788번 포트)
  창을 거기로 향하게 합니다. 저장소 자신의 `vault/`와 `data/`를 쓰며,
  패키징된 빌드는 `CHESS_VAULT_DIR` / `CHESS_VAULT_DATA`를 사용자별 앱
  데이터로 향하게 합니다.

실행: `npm run build`를 한 번 돌린 뒤(서버가 `dist/`를 서빙합니다)
`npm run desktop`.

## 단 하나의 규칙

웹 앱은 어느 모드에서든 같은 HTTP API와 이야기합니다. 셸은 앱에 API를
절대 노출하지 않습니다(모드 선택기의 IPC는 셸 설정이지 앱의 표면이
아닙니다). 이 덕분에 데스크톱 빌드는 언제든 걷어낼 수 있고, 웹 배포가
기준으로 남습니다.

## 패키징

`npm run desktop:package` → `release/installer/Chess Vault Setup <v>.exe`
(NSIS 원클릭. macOS dmg 대상은 나중을 위해 미리 설정해 두었습니다).
과정은 이렇습니다:

1. `desktop/build-server.mjs`: 서버를 esbuild로 묶어
   `release/server/index.mjs`로, 북 빌더를
   `release/server/build-book.mjs`로 만들고, better-sqlite3를 그 옆에
   복사하며(v13은 Node-API 프리빌드를 제공합니다 — Electron 아래에서
   ABI가 안정적이라 다시 빌드할 필요가 없습니다), `icon.ico`를
   렌더링합니다.
2. `npm run build`: SPA를 (엔진과 모델 자산과 함께) `dist/`로.
3. `electron-builder`: `desktop/`을 asar에 담고, 서버 번들과 `dist/`는
   extraResources로 실어 서버의 `./dist` 정적 루트와 `REPO_ROOT`가 모두
   `resources/`로 해석되게 합니다.

패키징된 로컬 모드는 번들된 서버를 Electron 자신의
Node로(`ELECTRON_RUN_AS_NODE`) 돌리며, `CHESS_VAULT_DIR`/`CHESS_VAULT_DATA`를
`%APPDATA%/Chess Vault/{vault,data}`로 향하게 합니다 — 기기 프로필마다
새 보관함이 생깁니다.

패키징된 앱 안에서 오프닝 북을 만들 수 있습니다. `build-book.mjs`가 서버
번들 옆에 실려 있고 서버가 저장소 스크립트보다 그것을 먼저 씁니다. 퍼즐과
참고 게임 데이터베이스는 여전히 미리 준비하는 산출물이고 — 어디에서도
빌드 작업으로 노출되지 않습니다 — 필요하다면 만들어 둔 `data/` 파일을
함께 가져가세요.

## 자동 업데이트

셸은 실행할 때 가져오는 피드로 스스로를 갱신합니다. 최신 버전과 받아야
할 설치 파일을 알려 주는 `latest.yml`, 그리고 그 설치 파일입니다. 둘 다
여기서 만들어 서버로 올립니다 — 중간에 GitHub이 없으므로 소스 저장소는
비공개로 남을 수 있습니다.

헷갈리게 비슷한 이름의 파일 둘이 양쪽 끝에 관여합니다:

| | `app-update.yml` | `latest.yml` |
| --- | --- | --- |
| 있는 곳 | 설치된 앱 안 | 서버 위 |
| 하는 말 | "이 주소에 물어봐라" | "최신은 0.2.0이고, 여기 있다" |
| 쓰는 주체 | electron-builder가 번들 안에 | electron-builder가 설치 파일 옆에 |
| 바뀌는 때 | 설치 후에는 절대 안 바뀜 | 릴리스마다 |

둘 다 루트 `package.json`의 `build.publish`에서 나오며, 저장소에 누군가의
서버를 적어 두는 대신 환경 변수에서 URL을 읽습니다:

```
"publish": { "provider": "generic", "url": "${env.CHESS_UPDATE_URL}" }
```

### 릴리스 내기

```
# 1. package.json의 "version"을 올리고 커밋
# 2. 명령 하나로: 빌드, 배포(피드), 서버 배포, 검증
npm run desktop:release
```

대상은 `scripts/deploy.env`(`CHESS_VAULT_HOST`, `CHESS_UPDATE_URL`)에서
읽고, 작업 트리가 지저분하면 실행을 거부하며, 마지막에 서버에게 무엇을
서빙하고 있는지 물어봅니다 — 피드와 `/api/health`가 둘 다 방금 만든
버전을 말해야 하고, 아니면 0이 아닌 코드로 종료합니다.

서버 배포가 여기 포함된 것은 일부러입니다. 원격 모드에서 데스크톱 앱은
**서버의** 웹 빌드를 돌리므로, 배포 없이 설치 파일만 내면 둘이 지금
버전이 무엇인지를 두고 어긋나게 됩니다. 이것은 두 가지 일이 아니라 한
가지 일입니다.

electron-builder는 배포를 스스로 하지 못합니다. `generic` 공급자는 내려받기
전용이라 `--publish always`가 올릴 수단을 갖고 있지 않습니다.

`CHESS_UPDATE_URL` 없이는 빌드가 실행을 거부합니다. 주소가 빈 채로 만든
설치 파일은 영영 갱신될 수 없으면서 그 이유를 아무 단서도 남기지 않기
때문입니다.

### 피드 서빙하기

서버는 `CHESS_VAULT_UPDATES`(기본값 `<repo>/updates`, git에서 제외됨)의
내용을 `/updates/:file`로 노출합니다. 일부러 `/api` 바깥, 그리고 비밀번호
게이트 바깥에 두었습니다. 업데이터는 세션도 없고 세션을 얻을 방법도 없는
백그라운드 프로세스이기 때문입니다. 테일넷 전용 배포라면 네트워크가 곧
경계이고, 공개 배포라도 이것들은 어차피 설치 파일로 나눠 주는 바로 그
바이트이며, 모든 내려받기는 `latest.yml`의 sha512로 검증됩니다. 릴리스
형태의 파일 이름만 서빙하고 디렉터리 목록은 제공하지 않습니다.

### 나중에 공개로 갈 때

`build.publish`를 GitHub 공급자로 되돌리고 같은 방식으로 릴리스를
내면 됩니다. 앱의 다른 어떤 부분도 업데이트가 어디서 오는지 알지
못합니다.
