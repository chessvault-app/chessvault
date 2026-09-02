# 셸에서 책 가져오기

*[English](book-import-offline.md) · 한국어*

앱은 PDF를 알아서 가져오고 아무것도 묻지 않습니다. 퍼즐 책을 열고, 파일을
건네고, 기다리면 됩니다. **그것이 지원되는 경로이고, 이 문서가 그것을
대신하지는 않습니다.** 아래는 같은 가져오기를 터미널에서 실행하는 방법이고,
수고를 들일 만한 경우는 정확히 셋입니다.

- **다시 가져올 때.** 보드 읽기와 엔진의 답은 디스크에 캐시되므로, 이미 읽은
  책을 두 번째로 실행하면 몇 분이 아니라 몇 초가 걸립니다. 앱은 매번 모든
  보드를 다시 읽습니다.
- **코어가 많을 때.** `--jobs N`이 페이지 읽기를 N개 프로세스로 나눕니다.
  앱의 작업자 풀은 여섯에서 멈춥니다.
- **가져오기 자체를 고칠 때.** 브라우저 스캔을 앉아서 기다리지 않고 변경이
  책 한 권 전체에 무엇을 하는지 볼 수 있습니다.

처음 가져오는 것이 극적으로 빠르지는 않습니다. 12코어 기계에서 *1001 Chess
Exercises*의 다이어그램 1,033개를 읽는 데 `--jobs 6`으로 204초, 앱에서는
314초입니다. 어느 쪽이든 같은 CellNet이고, 보드 하나에 드는 시간 가운데 약
948밀리초가 그 모델의 몫입니다. 셸이 앞서는 곳은 두 번째 실행입니다. 픽셀을
하나도 읽지 않으니 2초입니다.

대가는 **책의 설정 파일을 직접 써야 한다**는 것입니다. 앱은 책의 표기법을
책에서 알아내지만, 오프라인 단계들은 그것을 적어 둔 파일 없이는 시작을
거부하며, 그 파일을 맞추는 일이 아래 작업의 대부분입니다.

## 필요한 것

- **Node** — 앱을 실행할 수 있다면 이미 있습니다.
- **Python 3.12**와 `pymupdf`, `pillow`, `numpy`. ML README는 버리는 venv를
  권합니다: `python -m uv venv data/ml/venv -p 3.12`.
- **엔진 설치는 필요 없습니다.** 등급 단계는 `npm install`이 가져온
  Stockfish를 씁니다.
- **내 PDF.** 여기서 책을 받아 오는 것은 없고, 딸려 오는 책도 없습니다.

## 어디에 쓰는가

저장소 안의 `vault/puzzlebooks/<id>/`에 바로 씁니다 — `puzzles.json`,
`drafts.json`, `book.json`, 그리고 `diagrams/`의 이미지들입니다. 폴더 이름은
제목이 아니라 id입니다(`b` + 16진수 16자리). 책은 `book.json`의 제목으로 찾고,
그런 이름의 책이 없으면 새 id로 만듭니다. 그래서 두 번 실행해도 같은 책에
들어가지, 옆에 하나 더 생기지 않습니다. 이것이
저장소 자신의 `vault/`라는 점에 주의하십시오. 서버와 달리 이 스크립트들은
`CHESS_VAULT_DIR`를 보지 않으므로, 보관함이 다른 곳에 있다면 나중에 폴더를
옮겨야 합니다. 앱을 새로 고치면 책이 보입니다. 퍼즐 id가 `n<번호>`라서 다시
가져와도 진행 상황은 남습니다.

## 아무도 읽지 않은 책을 시작하기

부트스트랩은 순환이고 순서가 중요합니다. 단계들은 설정이 필요하고, 설정을
알아내 주는 도구는 보드가 필요한데, 보드는 단계를 한 번 실행해야 생깁니다.
그래서 대충 하나를 써서 책을 읽고, 책이 설정을 바로잡아 주게 합니다.

**1. 텍스트 레이어를 덤프하고 페이지를 렌더링합니다.**

```bash
python scripts/ml/extract_pdf_words.py <book.pdf> data/ml/<slug>-text.json
```

```bash
python scripts/ml/harvest_pdfs.py <book.pdf> data/ml/<slug>-pages
```

**2. 대충 된 설정**을 `scripts/ml/books/<slug>.json`에 씁니다. 이 시점에
맞아야 하는 것은 신원 항목들뿐이고, 표기법은 짐작해 두었다가 4단계에서
고칩니다.

```json
{
  "slug": "<slug>",
  "title": "<책 제목, 폴더 이름이기도 합니다>",
  "pages": [5, 105],
  "solutionsAfterPage": 100,
  "maxNumber": 1001,
  "text": "data/ml/<slug>-text.json",
  "cache": "data/ml/<slug>-reads.json",
  "report": "data/ml/<slug>-report.json",
  "anchorStyle": "dash",
  "moveMarkers": "dotless",
  "sideMode": "chapter"
}
```

`pages`는 퍼즐이 실린 첫 페이지와 마지막 페이지, `solutionsAfterPage`는 정답이
시작되기 직전 페이지, `maxNumber`는 인쇄된 가장 큰 퍼즐 번호입니다. 이 넷은
책을 보고 읽어 넣으십시오. 내가 넣어 주는 사실 가운데 책이 스스로 알려 줄 수
없는 것은 이 넷뿐입니다.

**3. 보드를 한 번 읽습니다.** 느린 패스는 이것 하나이고, 이후는 캐시에서
나옵니다.

```bash
npx tsx scripts/ml/autoimport-measure.ts data/ml/<slug>-pages --book scripts/ml/books/<slug>.json --jobs 6
```

**4. 표기법은 책이 정하게 합니다.** 이제 후보를 채점할 보드가 있으니, 순위와
함께 이긴 설정이 지금 설정과 어떻게 다른지 찍어 줍니다.

```bash
npx tsx scripts/ml/search-config.ts --book scripts/ml/books/<slug>.json
```

이긴 값(`anchorStyle`, `moveMarkers`, `sideMode`)을 설정에 옮기고 다시
측정합니다. 두 번째 실행은 픽셀을 읽지 않아 빠르며, 볼 숫자는 검증된 정답의
개수입니다.

```bash
npx tsx scripts/ml/autoimport-measure.ts data/ml/<slug>-pages --book scripts/ml/books/<slug>.json --repair --emit data/ml/<slug>-emit --jobs 6
```

어떤 후보로도 검증 수가 0 근처에 머무는 책은 읽힌 것이 아닙니다. 그 책의
정답은 파서가 모르는 모양이며, 그 숫자로 가져오면 그럴듯하지만 틀린 정답을
찍어 내게 됩니다. 그럴 때는 초안으로 가져오고 파서를 고치십시오. 실행 결과를
믿을 때가 아닙니다.

## 설정이 맞은 뒤의 실행 안내서

```bash
npx tsx scripts/ml/autoimport-measure.ts data/ml/<slug>-pages --book scripts/ml/books/<slug>.json --repair --emit data/ml/<slug>-emit --jobs 6
```

```bash
npx tsx scripts/ml/autoimport-import.ts data/ml/<slug>-emit --book scripts/ml/books/<slug>.json --jobs 6
```

```bash
python scripts/ml/evidence_jpegs.py
```

```bash
CHESS_BOOK_PDFS=<PDF들이 있는 폴더> python scripts/ml/render_book_pages.py scripts/ml/books/<slug>.json
```

```bash
python scripts/ml/enrich_solution_pages.py scripts/ml/books/<slug>.json
```

측정 단계가 검증할 수 있는 것을 검증하고, 가져오기 단계가 나머지를 엔진으로
등급을 매긴 뒤 보관함의 책을 씁니다. 마지막 셋은 근거 이미지를
되돌립니다. 다시 가져오면 `diagrams/`가 비워지기 때문에 표지와 정답 페이지를
나중에 다시 렌더링해야 하고, 그래서 `render_book_pages.py`는 설정의 `pdf`와
`coverPage`, 그리고 사본이 있는 곳을 가리키는 `CHESS_BOOK_PDFS`를 필요로
합니다.

거꾸로 스캔된 페이지가 있다면 `derotate.ts`가 되돌려 놓고 번호를 되찾아
줍니다. 그것과 각 단계의 내부 동작은
[파이프라인 문서](book-import-pipeline.ko.md)에 있습니다.

## 걸려 넘어지기 쉬운 것들

- **보드를 다시 읽으려면 설정의 `cache` 파일을 지우십시오.** 그러지 않으면
  측정은 캐시된 읽기를 가져다 검증만 다시 합니다. 파서를 고친 뒤라면 그것이
  원하는 동작이고, 모델을 바꾼 뒤라면 정확히 원하지 않는 동작입니다.
- **폴더 이름은 `slug`가 아니라 `title`입니다.** 제목이 같은 설정 둘은 같은
  책에 씁니다.
- **엔진 캐시는 보고서 옆에** `<report>-engine-cache.json`으로 있습니다.
  포지션을 다시 탐색하려면 지우십시오.
- **여기 있는 것은 사용자용 경로가 아닙니다.** 앱을 쓰는 사람이 해야 할 일에
  셸이 필요하다고 느껴진다면, 그것은 앱에 빠진 기능이지 스크립트를 쓸
  이유가 아닙니다.
