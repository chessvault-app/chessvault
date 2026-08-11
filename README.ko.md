# Chess Vault

*[English](README.md) · 한국어*

당신의 체스를, 평범한 파일로. 직접 호스팅하는 개인 체스 작업대입니다.
엔진 분석, 오프닝 탐색기, 스터디, 노트, 손수 고른 게임 모음, 그리고
실제 종이책에서 읽어 온 퍼즐 트레이너까지 — 모든 것이 PGN, 마크다운,
JSON으로 당신이 소유한 폴더 하나에 저장됩니다.

![분석 보드](docs/screenshots/board.png)

## 기능

- **보드** — Stockfish 18(WASM, 멀티스레드)로 자유롭게 분석합니다.
  변화수·주석·NAG·화살표를 갖춘 완전한 수 트리, 오프닝 탐색기(로컬 북 +
  Lichess), 정확도와 정직한 브릴리언트 판정이 있는 게임 리뷰, 그리고
  FEN, PGN 또는 아무 보드나 찍은 *사진/스크린샷*으로 국면 불러오기를
  지원합니다.
- **편집기** — 원하는 국면을 만듭니다. 팔레트에서 기물을 끌어다 놓거나
  이미지에서 가져올 수 있습니다.
- **스터디** — 변화수, 수마다의 주석, NAG, 그려 넣은 화살표를 갖춘 PGN
  챕터 스터디입니다. 읽기/주석 모드 전환이 있어 그냥 수를 따라갈 때는
  보드가 깔끔하게 유지됩니다. PGN 파일을 가져오거나, 붙여넣거나,
  Lichess 계정에서 스터디를 바로 끌어올 수 있습니다. 원자적 쓰기로
  자동 저장하며, 저장은 코덱 왕복이라 `shared/pgn.test.ts`가 그것이
  무손실이면서 *멱등*임을 검증합니다 — 손실이 있는 코덱은 보관함을
  조용히 갉아먹기 때문입니다.
- **노트** — 대화형 보드를 (```` ```chess ```` 펜스로) 끼워 넣을 수 있는
  마크다운 노트입니다. 노트·스터디·게임을 가로지르는 Obsidian 방식의
  `[[위키 링크]]`를 지원하며, 파일은 Obsidian에서도 그대로 읽힙니다.
- **게임** — 손수 고른 모음(스터디처럼 주석을 달 수 있습니다), 월별로
  필터와 함께 넘겨 보는 chess.com / Lichess 기보, 직접 PGN 가져오기,
  그리고 검색 가능한 엘리트 게임 참고 데이터베이스입니다.

  ![게임](docs/screenshots/games.png)

- **퍼즐** — 난이도 구간과 진행 대시보드를 갖춘 Lichess 테마 트레이너에
  더해 **책 퍼즐**이 있습니다. 스캔한 전술책 PDF를 가져오기에 넘기면 ML
  파이프라인이 다이어그램을 읽고, 인쇄된 정답을 해석하고, 재생해서
  검증한 뒤, 각 퍼즐을 정직한 신뢰 등급과 원본 페이지 스캔을 한 번에
  들춰 볼 수 있는 링크와 함께 가져옵니다. 지금까지 책 3권, 약 3,150개의
  퍼즐을 가져왔습니다.

  ![퍼즐 대시보드](docs/screenshots/dashboard.png)

- **도구** — 대화형 보드들을 묶어 놓은 곳입니다. 분석 **보드**, 국면
  **편집기**, 오프닝 **탐색기**로 가는 지름길, 그리고 Lichess
  데이터베이스를 상대로 오프닝을 연습하는 **레퍼토리** 트레이너(레이팅
  구간으로 거른 뒤 실제 채택 빈도에 비례해 무작위로 응수하고, 변화가
  정석을 벗어나면 자연스럽게 엔진으로 넘깁니다).
- **설정** — 앱 비밀번호 변경, 인증 앱 2단계 인증 켜기, 표시 이름과
  플랫폼 사용자명 설정, 보드 테마와 기물 세트 선택, Lichess 토큰 관리,
  보관함 비우기 — 전부 앱 안에서 되며, 셸이 필요 없습니다.
- **어디서나** — 휴대폰까지 반응하는 레이아웃, PWA 설치(홈 화면 아이콘,
  스플래시 화면, 오프라인 셸), 그리고 자체 호스팅 또는 서버의 클라이언트로
  동작하는 데스크톱 앱(Windows 설치 프로그램)을 지원합니다. 휴대폰에서는
  하단 바가 현재 페이지의 조작(수 이동, 퍼즐 동작)으로 바뀝니다 —
  chess.com·Lichess와 같은 방식입니다.

## 빠른 시작 (개발)

```bash
npm install
npm run dev          # 서버 + 웹, http://localhost:5173
```

처음 실행하면 Stockfish 엔진 자산을 내려받습니다(7 MB 경량 빌드,
`npm run setup:engine -- --full`을 쓰면 최대 강도 빌드로 바뀝니다).

## 구조

```
shared/     순수 TS: 수 트리 + PGN 코덱 (모두가 재사용하는 핵심)
server/     Hono 서버: 보관함 입출력, 인증 게이트 + 2FA, 설정, 프록시
web/        Vite + React UI
desktop/    Electron 셸 (원격 클라이언트 또는 자체 호스팅)
scripts/    빌더: 엔진 설치, 오프닝 북, 참고 게임 색인, ML 파이프라인
data/       파생물 — 다시 만들 수 있고, git에서 제외됨
vault/      당신의 데이터 — 평범한 파일, git과 잘 맞음
```

**`vault/`가 대체 불가능한 부분입니다.** `data/` 안의 것은 전부 지우고
다시 만들 수 있습니다. 백업이나 이전은 폴더 하나를 복사하는 일입니다.

## 배포

의도한 모습은 이렇습니다. 작은 리눅스 서버 하나가 보관함을 소유하고,
나머지 모든 기기는 클라이언트입니다.

```bash
# 서버에서
npm install
npm run build                      # 웹 앱 -> dist/
CHESS_VAULT_DIR=/srv/chess-vault npm run start
```

포트 하나가 빌드된 앱과 HTTP API를 함께 제공합니다. 앞에 HTTPS 리버스
프록시를 두세요 — PWA 설치와 Stockfish의 멀티스레드(SharedArrayBuffer는
교차 출처 격리된 보안 페이지를 요구합니다) 둘 다 그것을 필요로 합니다.
공개 배포라면 `vault/config.json`에 `appPassword`를 설정하거나 설정
페이지에서 지정해 잠금 화면을 켜세요. 인증 앱 2단계 인증도 같은 곳에서
추가합니다. 그다음:

- **휴대폰**: URL을 열고 홈 화면에 추가하면 오프라인 셸과 스플래시
  화면을 갖춘 온전한 PWA가 됩니다.
- **데스크톱**: 앱을 설치하고(`npm run desktop:package`가 Windows
  설치 프로그램을 만듭니다) 서버 URL과 함께 *원격* 모드를 고르거나,
  그 기기의 아무 폴더나 직접 호스팅하는 *로컬* 모드를 고르세요.

SSH는 공개 인터넷에 두지 마세요. 참조 배포는 방화벽에서 22번 포트를 닫은
채 [Tailscale](https://tailscale.com) 테일넷 위에서 서버를 돌리고,
`scripts/deploy.sh`(번들 → 전송 → 재빌드 → 재시작)가 테일넷을 통해
접근합니다. 대상 호스트는 `CHESS_VAULT_HOST`로 지정합니다.

### 배포 시점에 한 번 하는 작업

데이터베이스 두 개는 앱이 만드는 것이 아니라 **당신의 기기에서 만들어
서버로 복사**합니다. 유일한 예외이고, 일회성이라 평소 배포의 일부가
아닙니다:

```bash
# 퍼즐 트레이너의 문제 풀: Lichess 덤프를 한 번 내려받습니다 (CC0, 약 304 MB)
curl -o data/lichess_db_puzzle.csv.zst https://database.lichess.org/lichess_db_puzzle.csv.zst
npm run build:puzzles              # -> data/puzzles.sqlite (약 2.5 GB)

# 참고 게임 브라우저: vault/sources/에 넣어 둔 PGN이라면 무엇이든
npm run build:refgames             # -> data/refgames.sqlite
```

둘 다 서버의 data 디렉터리로 복사하세요. 이후의 배포는 알아서 색인을
최신으로 유지합니다. 더 새로운 퍼즐 덤프가 나오거나 참고 게임을 늘릴
때만 다시 만들면 됩니다 — 왜 이것을 앱 안에서 하지 않는지, 그리고 그
답이 바뀌려면 무엇이 달라져야 하는지는
[docs/databases.ko.md](docs/databases.ko.md)를 보세요.

백업은 층으로 되어 있습니다. 서버가 보관함의 모든 변경을
`vault/.history.git`에 자동으로 커밋하고(세밀한 되돌리기), 호스트의
스냅숏이 인스턴스 유실에 대비하며, `scripts/backup-vault.sh`가 히스토리를
포함한 보관함 전체를 아무 기기로나 내려받아 클라우드 밖 사본을
만듭니다.

## 모든 것이 오프라인에서 동작합니다

런타임에 CDN을 호출하지 않습니다. 글꼴, 아이콘, WASM, CSS가 모두 함께
번들됩니다. 네트워크가 필요한 기능은 *가져오기*(본래 일회성인 작업)와
선택 사항인 Lichess 탐색기 보강뿐입니다.

오프닝 탐색기는 **로컬 우선**입니다. 북은 `vault/sources/`에 넣어 둔
PGN에서 만들어지며, 탐색기 창의 북 관리자에서 하거나 다음처럼 할 수
있습니다:

```bash
npm run build:book                          # vault/sources의 모든 .pgn을 각각 하나의 북으로
npm run build:book -- a.pgn b.pgn --name elite    # 여러 파일을 북 하나로 합치기
npm run build:openings                      # ECO 이름 (동봉한 TSV, 완전 오프라인)
```

국면은 64비트 Zobrist 해시로 키를 잡고 메모리 사용량을 묶어 둔 채
스트리밍합니다. Lichess Elite Database 한 달치(280,246 게임)로 측정한
결과: 361 k개 국면을 47초에 색인했고, SQLite 69 MB, 조회는 1밀리초
미만이었습니다. 추천하는 출처는 둘 다 무료입니다 —
[Lumbra's Gigabase](https://lumbrasgigabase.com/en/)의 "OTB Elite"와
[Lichess Elite Database](https://database.nikonoel.fr/).

## 참고 데이터 (전부 선택 사항, 전부 무료)

`data/`가 비어 있어도 앱은 돌아갑니다. 이 데이터셋들은 특정 기능을
켜 줄 뿐입니다. `data/` 아래의 모든 것은 다시 만들 수 있고 git에서
제외되므로 저장소에 실려 나가지 않습니다. 기기마다 만들거나 받으세요.

- **퍼즐 트레이너** — [Lichess 퍼즐 데이터베이스](https://database.lichess.org/#puzzles)
  (CC0). 한 번 받아서 만들면 됩니다:
  ```bash
  curl -L -o data/lichess_db_puzzle.csv.zst \
    https://database.lichess.org/lichess_db_puzzle.csv.zst
  npm run build:puzzles          # -> data/puzzles.sqlite
  ```
- **엘리트 게임 브라우저** — 위의 Lumbra / Lichess Elite 같은 PGN 덤프를
  `npm run build:refgames`로 색인해 `data/refgames.sqlite`를 만듭니다.
- **오프닝 탐색기 (로컬)** — `vault/sources/`에 넣은 PGN에 대해
  `npm run build:book`을 돌립니다. `npm run build:openings`는 동봉한
  TSV에서 ECO 이름을 컴파일합니다(완전 오프라인).

## Lichess 토큰 (선택 사항)

*온라인* 탐색기 보강, 레퍼토리 트레이너, Lichess 계정에서 스터디
가져오기를 켭니다.
[lichess.org/account/oauth/token/create](https://lichess.org/account/oauth/token/create)에서
**권한은 아무것도 체크하지 않고** 만드세요(비공개 스터디에는
`study:read`, Lichess 퍼즐 기록 가져오기에는 `puzzle:read`를 추가).
설정 페이지에 붙여넣거나 `vault/config.json`(git에서 제외됨)에 넣습니다:

```json
{ "lichessToken": "lip_..." }
```

`config.json`은 잠금 화면이 켜져 있을 때 `appPassword`와 2FA의
`totpSecret`도 담습니다. 설정 페이지가 이 셋을 모두 관리하며, 보관함의
히스토리 저장소는 비밀이 절대 들어가지 않도록 이 파일을 일부러
제외합니다.

## 명령어

```bash
npm run dev            # 서버 + 웹, 핫 리로드
npm run build          # dist/로 프로덕션 빌드
npm start              # 빌드된 앱 서빙
npm test               # 단위 테스트
npm run typecheck      # tsc --noEmit
npm run setup:engine   # Stockfish를 web/public/engine/으로 복사
npm run build:book     # vault/sources의 PGN을 오프닝 북으로 색인
npm run build:openings # ECO 오프닝 이름 컴파일
npm run build:refgames # 엘리트 브라우저용 참고 게임 색인
npm run desktop:package  # Windows 설치 프로그램
```

키보드: `←` `→` 한 수씩 이동 · `↑`/`Home` 처음 · `↓`/`End` 끝 ·
`f` 보드 뒤집기.

## 문서

- [아키텍처](docs/architecture.ko.md) — 평범한 파일로 된 보관함,
  프로세스 분리, HTTP 전용 클라이언트 규칙.
- [디자인 원칙](docs/design-principles.ko.md) — 색의 문법, 레이아웃
  규칙, 그 밖에 계속 지키는 결정들.
- [책 가져오기 파이프라인](docs/book-import-pipeline.ko.md) — PDF가
  검증된 퍼즐 책이 되기까지, 실행 안내서 포함.
- [준비된 데이터베이스](docs/databases.ko.md) — 퍼즐과 참고 게임
  데이터베이스: 한 번 만들어 서버로 복사하고, 이후엔 거의 손대지 않습니다.
- [ML 히스토리](docs/ml-history.ko.md) — 책 읽기가 좋아진 과정.
- [업데이트 로그](docs/update-log.ko.md) — 무엇이 바뀌었는지, 최신순.

## 라이선스

이 프로젝트는 **GPL-3.0**을 따릅니다([LICENSE](LICENSE) 참고). 사실상
동봉한 의존성이 선택을 대신했습니다. Stockfish와 Stockfish.js가
GPLv3이고, `chessops`와 `chessground`는 AGPL/GPL로 사정이 같습니다.
Lichess 퍼즐 데이터베이스는 CC0, Lumbra's Gigabase는 CC BY-NC-SA
4.0입니다.
