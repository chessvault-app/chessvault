# 다이어그램 OCR 모델 파이프라인

*[English](README.md) · 한국어*

> **여기는 실험실이지 입구가 아닙니다.** 책을 가져오는 것은 앱이
> 하는 일입니다. PDF를 올리면 나머지는 앱이 알아냅니다
> ([docs/book-import-pipeline.ko.md](../../docs/book-import-pipeline.ko.md)
> 참고). 여기 있는 것은 모델을 어떻게 학습시켰는지, 그리고 어떤 변경을
> 브라우저에서 다시 스캔하는 대신 1분 만에 책 한 권 전체에 대해 어떻게
> 측정하는지입니다. 읽는 로직 자체는 공유 코드입니다 —
> `shared/bookImport.ts`, `bookConfigSearch.ts`, `bookSolve.ts`,
> `bookGlyphs.ts`, `bookRepair.ts` — 그래서 둘이 서로 어긋날 수
> 없습니다.

## 글자 쪽 모델 (1단계: 번호 라벨 — `digit_labels.py`)

PDF 텍스트 레이어는 1001개 퍼즐 번호 중 83개를 잃어버리고(그 레이어가 정답을
OCR한 결과는 피겨린 기호가 깨진 쓰레기입니다), 그래서 글자는 책 자신에게서
배웁니다. 이미 맞춰진 858개 퍼즐이 텍스트 레이어의 단어 상자를 통해 정확한
숫자 조각을 제공하고(`harvest`, 약 2,770개 표본, 5-폴드 99.86%), 최근접 중심
모델과 연결 성분 분할이 임의의 다이어그램 사각형 위에 인쇄된 번호를
읽습니다(`selftest`: 끝에서 끝까지 855/858). 검출은 되었으나 맞춰지지 않은
모든 다이어그램을 여기에 넣으면(페이지 렌더에 대해 `dump-rects` 후 `read`)
잃어버린 143개 번호 중 125개를 되찾았고, 모두 번호 순서와 어긋나지
않았습니다 — `data/ml/recovered-numbers.json` + `all-diagram-rects.json`
참고 (`pages-extra/`에는 보관함에 없던 16개 페이지의 렌더가 있습니다). 환경:
`python -m uv venv data/ml/venv -p 3.12` + `numpy pillow pymupdf`.

2단계도 나왔습니다(`figurine_glyphs.py`). 검증된 항목이 인쇄된 토큰을 이미
아는 SAN과 정렬해 주므로 단어 상자를 통해 1,600개가 넘는 피겨린 글리프
조각에 라벨을 붙입니다(5-폴드 99.7%). 모든 접두사 단어를 읽으면 204개의
접두사→기물 힌트가 나오고, `autoimport-measure --glyph-hints`가 이를 3패스로
적용합니다 — 글자만으로 배운 방언보다 검증 +24.

3단계(측정 시 `--repair`)는 정답으로 제약한 보드 복구입니다. 칸당 약 99.4%의
정확도는 보드의 약 1/3에 틀린 칸을 한두 개 남기므로, 재생에 실패하면
분류기의 차점 라벨로 다시 시도합니다(어디든 1칸, 그다음 가장 불안한 20개
가운데 2칸, 12개 가운데 3칸). 책의 변화 전체가 재생되는 유일한 국면만 받아들이며, 검증 +30을 더
얻었고 후보가 여럿인 경우는 건드리지 않았습니다.

## 다이어그램 쪽 모델 (CellNet)

사진과 PDF 다이어그램 읽기에 쓰는 칸 분류기를 학습시킵니다. 32×32 회색조
타일 → 13개 클래스(`1RNBQKPrnbqkp`, linrock과 같은 순서). 여기 있는 것은
전부 **개발 시점** 도구입니다. 배포되는 것은 내보낸 가중치뿐이고, 추론은
브라우저에서 돌아갑니다. 배포에는 이 중 어느 것도, GPU도 필요하지 않습니다.

## 환경 (uv로 관리, 쓰고 버림)

- **torch-env** (Python 3.12): `uv venv … && uv pip install torch
  --index-url https://download.pytorch.org/whl/cu126` + `numpy pillow`.
  학습용.
- **tf-env** (Python 3.10):
  `tensorflow==2.10 pillow "numpy<2" pymupdf fonttools`. 의사 라벨링을 위해
  linrock 교사 모델을 돌리고 PDF 렌더 도우미를 쓸 때만 필요합니다.

## 데이터 출처 (전부 `data/ml/`에 떨어지며, git에서 제외됨)

1. **linrock 학습 세트** — github.com/linrock/chessboard-recognizer
   v0.4(MIT)의 `training-images.zip`. 파일 이름에 FEN이 담긴 보드
   PNG입니다(랭크 사이는 `-`, 빈 칸은 하나당 `1`). 온라인 보드 스크린샷과 책
   스캔 세트가 모두 들어 있습니다.
2. **인쇄 글꼴 합성** — `gen_print.py`가 고전 다이어그램 글꼴로 무작위
   배치를 렌더링합니다. Chess Merida(Marroquin, 프리웨어.
   `merida-fixed.ttf`는 MERIFONT.TTF의 심볼 cmap을 fontTools로 ASCII로 다시
   쓴 것입니다), Chess Alpha(Bentzen, 무료), 그리고 CTAN의 `enpassant`
   묶음에 있는 Chess Berlin (mirrors.ctan.org/fonts/chess/enpassant.zip).
   글리프 대응은 묶음의 .enc 파일에서 해석합니다. `--verify`는 글꼴마다 시작
   국면을 렌더링합니다 — 대응을 바꾼 뒤에는 눈으로 확인하세요.
3. **의사 라벨을 붙인 실제 책** (chessvision식 플라이휠) —
   `harvest_pdfs.py`가 lanph3re의 전술책 PDF를 렌더링하고,
   `harvest-align.ts`가 앱 자신의 `detectDiagrams` + `detectBoardQuad` +
   워프를 페이지에 돌리며, `pseudo_label.py`가 교사 모델이 0.999 이상의
   확신으로 부른 타일만 남깁니다(빈 칸은 보드당 개수를 제한합니다). 글꼴,
   인쇄 흔적, JBIG2 잡음은 책 자체에서 공짜로 딸려 옵니다.

`data/ml/eval-11/`의 손으로 라벨한 보드 11개와 `eval_truth.py`는 순수
홀드아웃입니다. 학습에 절대 쓰지 않고 에폭마다 보고합니다. 넘어야 할
기준선은 linrock 사전학습 모델의 99.43%입니다.

## 실행 순서

```sh
# 한 번만 하는 데이터 준비
python scripts/ml/gen_print.py --count 700
python scripts/ml/harvest_pdfs.py <book.pdf> <pages_dir>   # 책마다
npx tsx scripts/ml/harvest-align.ts <pages_dir> data/ml/harvest-boards <tag>
python scripts/ml/pseudo_label.py <teacher_model> data/ml/real-boards data/ml/real-1001.npz
python scripts/ml/pseudo_label.py <teacher_model> data/ml/harvest-boards data/ml/real-harvest.npz

# 학습 (torch-env, 처음부터 학습할 때는 GPU)
python scripts/ml/train.py --epochs 16

# 책들 자신의 검증된 보드로 미세 조정 — 따뜻하게 시작한 4에폭이면 되고,
# CPU로도 충분합니다 (docs/ml-history.md 4절)
python scripts/ml/build_validated_npz.py <emit_dir:report.json>
python scripts/ml/train.py --init cellnet-best.pt --epochs 4
```

산출물: `data/ml/cellnet-best.pt`(state dict). `export_weights.py`가 이것을
앱이 싣고 나가는 브라우저 형식(`web/public/models/cellnet-v1.bin`)과, 추론
테스트가 대조하는 기준 벡터로 바꿔 줍니다.

## 라이선스

학습 입력에 한한 이야기이며, 이 자산 중 어느 것도 앱에 실려 나가지 않습니다.
linrock 코드와 모델은 MIT입니다. Merida/Alpha/Berlin 글꼴은 이런 용도로는
프리웨어이고 재배포하지 않습니다(위의 URL에서 받습니다). 책은 lanph3re
본인의 사본이며, 학습된 가중치는 그 내용을 전혀 담고 있지 않습니다.
