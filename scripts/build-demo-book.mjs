/**
 * Draw the demo's sample book, web/demo-assets/books/sample.pdf.
 *
 *   node scripts/build-demo-book.mjs
 *
 * WHY THERE IS A BOOK AT ALL. The library is the one feature of the app
 * the demo could not show: /api/books answered with an empty shelf, so the
 * thing that makes this app unlike the others — read a PDF beside the
 * board, press the button on a printed diagram, get the position — was
 * invisible to everyone who had not already installed it.
 *
 * WHY IT IS DRAWN RATHER THAN DOWNLOADED. A real book is somebody's
 * copyright, and the vault rule that book content is never redistributed
 * does not stop applying because the folder is called demo-assets. A scan
 * of a public-domain edition would clear the copyright and cost 20-100 MB
 * in a repository, and in a bundle that is already 36 MB. This is a few
 * hundred KB, it is ours, and it is the same bytes for everyone.
 *
 * WHAT IT HAS TO SURVIVE. The diagram hotspots are not metadata: the page
 * is rendered, detect.ts finds the largest square-ish blob of ink, and
 * cellnet.ts classifies all 64 cells from the picture (see the headers in
 * web/src/puzzles/ocr/). So a diagram here has to be a diagram in the way
 * print is one — dark ink, light paper, a ruled border, shaded dark
 * squares, Staunton pieces — or the demo ships a book whose buttons find
 * nothing. Which is why the boards are cburnett (chessground's own, and
 * GPLv2+ like this repo) rather than the Unicode chess glyphs: the
 * classifier reads book diagrams, and a text glyph in a table cell is not
 * what one looks like.
 *
 * Committed, not built on demand, exactly as web/demo-assets' databases
 * are: the demo workflow runs `npm ci` on a clean runner and has no
 * browser to draw with.
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(REPO, 'web/demo-assets/books/sample.pdf');
/** Page images and their diagram boxes — the puzzle book's evidence. */
const PAGES = resolve(REPO, 'web/demo-assets/book-pages');

/**
 * cburnett, as chessground ships it: one rule per piece, the SVG inlined
 * as a base64 data URI. Read out of node_modules rather than copied into
 * this file so the pieces in the book are the pieces on the board.
 */
function cburnett() {
  const css = readFileSync(
    resolve(REPO, 'node_modules/@lichess-org/chessground/assets/chessground.cburnett.css'),
    'utf-8',
  );
  const pieces = {};
  const rule = /piece\.(\w+)\.(\w+)\s*\{\s*background-image:\s*url\('([^']+)'\)/g;
  for (let m = rule.exec(css); m; m = rule.exec(css)) pieces[`${m[2]} ${m[1]}`] = m[3];
  const found = Object.keys(pieces).length;
  if (found !== 12) throw new Error(`expected 12 cburnett pieces, parsed ${found}`);
  return pieces;
}

const ROLE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

/** A diagram, from the placement field of a FEN. */
function board(placement, pieces, caption) {
  const rows = placement.split('/');
  if (rows.length !== 8) throw new Error(`not a placement: ${placement}`);
  let cells = '';
  rows.forEach((row, rank) => {
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < Number(ch); i += 1, file += 1) {
          cells += `<i class="${(rank + file) % 2 ? 'd' : 'l'}"></i>`;
        }
        continue;
      }
      const key = `${ch === ch.toUpperCase() ? 'white' : 'black'} ${ROLE[ch.toLowerCase()]}`;
      const url = pieces[key];
      if (!url) throw new Error(`no piece for ${ch}`);
      cells += `<i class="${(rank + file) % 2 ? 'd' : 'l'}"><img src="${url}" alt=""></i>`;
      file += 1;
    }
    if (file !== 8) throw new Error(`rank ${8 - rank} is ${file} squares wide`);
  });
  return `<figure><div class="board">${cells}</div><figcaption>${caption}</figcaption></figure>`;
}

/**
 * The text is written for this file. The positions are not anybody's to
 * own — an opening and two textbook endings — but the words about them
 * would be, so none are borrowed.
 */
function html(pieces) {
  const page = (inner, cls = '') => `<section class="page ${cls}">${inner}</section>`;
  return `<!doctype html><meta charset="utf-8"><style>
  @page { size: 5.5in 8.5in; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Georgia, 'Times New Roman', serif; color: #111; background: #fff; }
  .page {
    width: 5.5in; height: 8.5in; padding: 0.72in 0.68in 0.6in;
    page-break-after: always; position: relative; display: flex; flex-direction: column;
  }
  .page::after {
    content: counter(page); position: absolute; bottom: 0.42in; left: 0; right: 0;
    text-align: center; font-size: 9pt; color: #444;
  }
  .title { justify-content: center; text-align: center; }
  .title h1 { font-size: 26pt; margin: 0 0 0.12in; font-weight: normal; letter-spacing: 0.01em; }
  .title p { font-size: 11pt; color: #333; margin: 0.05in 0; font-style: italic; }
  .title .rule { border-top: 1px solid #111; width: 2.2in; margin: 0.3in auto; }
  h2 { font-size: 15pt; font-weight: normal; margin: 0 0 0.06in; }
  h2 .num { display: block; font-size: 9pt; letter-spacing: 0.18em; color: #555; margin-bottom: 0.07in; }
  p { font-size: 10.5pt; line-height: 1.52; margin: 0 0 0.11in; text-align: justify; hyphens: auto; }
  ol { font-size: 10.5pt; line-height: 1.6; padding-left: 0.24in; margin: 0 0 0.11in; }
  /* The diagram. Ruled border and shaded dark squares because that is what
     detect.ts looks for: one square-ish blob of ink, big against the page. */
  figure { margin: 0.16in auto 0.14in; width: 3.15in; }
  .board {
    width: 3.15in; height: 3.15in; display: grid;
    grid-template-columns: repeat(8, 1fr); grid-template-rows: repeat(8, 1fr);
    border: 1.6pt solid #111;
  }
  .board i { display: block; position: relative; }
  .board i.l { background: #fff; }
  .board i.d { background: #dcdcdc; }
  /* The outline, thickened. cburnett is drawn for a screen, where a white
     piece is a white fill inside a hair-thin black line; print gives the
     same piece a heavier edge, and the cell classifier is trained on print.
     Measured: without this the white bishop on c1 read as an empty square
     (confidence 0.03). Stacked drop-shadows are how you fatten an edge you
     cannot redraw. */
  .board img {
    position: absolute; inset: 4%; width: 92%; height: 92%;
    filter: drop-shadow(0 0 0.6px #000) drop-shadow(0 0 0.6px #000) drop-shadow(0 0 0.6px #000);
  }
  figcaption { font-size: 9pt; text-align: center; color: #333; margin-top: 0.09in; font-style: italic; }
  .toc { font-size: 10.5pt; line-height: 2; }
  .toc span { float: right; }
  </style>
${page(
  `<h1>A sample book</h1><p>Openings and endings</p><div class="rule"></div>
   <p style="font-style:normal;font-size:10pt">Written for the Chess&nbsp;Vault demo</p>`,
  'title',
)}
${page(`<h2>Contents</h2><div class="toc">
   <div>1. The Spanish bishop <span>3</span></div>
   <div>2. Building the bridge <span>5</span></div>
   <div>3. The third rank <span>7</span></div>
 </div>
 <p style="margin-top:0.4in">Each chapter prints one position. In the reader, the
 button on a diagram sets that position up on the board beside it, so a line
 can be played out where it is being read rather than somewhere else.</p>`)}
${page(`<h2><span class="num">CHAPTER ONE</span>The Spanish bishop</h2>
 <p>After 1.e4 e5 2.Nf3 Nc6, White has already asked one question of the e5 pawn
 and been answered. The move 3.Bb5 asks a second, and the pin it makes is worth
 more than the tempo it costs, because the bishop is not really attacking the
 knight — it is attacking the pawn the knight is defending.</p>
 ${board('r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R', pieces, 'After 3.Bb5')}
 <p>Black's usual reply is 3...a6, and the point of it is easy to miss. It does not
 win the bishop; it forces White to decide, now, whether the bishop is a
 long-term asset or a piece that has run out of squares.</p>`)}
${page(`<p>If White retreats with 4.Ba4, the pin remains and so does the question.
 If instead 4.Bxc6 dxc6, White has traded a bishop for a knight and left Black
 with doubled pawns — but Black has the two bishops and an open d-file, which in
 an ending is often the better half of the bargain.</p>
 <p>The line has been played for four hundred years and is still not settled.
 That is the mark of a good opening: not that it wins, but that both sides keep
 finding reasons to enter it.</p>
 <ol><li>e4 e5</li><li>Nf3 Nc6</li><li>Bb5 a6</li><li>Ba4 Nf6</li><li>O-O Be7</li></ol>`)}
${page(`<h2><span class="num">CHAPTER TWO</span>Building the bridge</h2>
 <p>A rook and a pawn against a rook is the most common ending there is, and this
 is the position that decides most of them. The pawn is one square from queening,
 the king in front of it is in the way of its own promotion, and the black king
 has been cut off two files away.</p>
 ${board('3K4/3P1k2/8/8/8/8/7r/2R5', pieces, 'White to play and win')}
 <p>The idea is to give the king a shelter made out of the rook. White plays
 Rc4, and the rook that looked idle on the first rank is suddenly a roof: when
 the checks come down the file, the rook steps across to block them.</p>`)}
${page(`<p>The order matters more than the moves. Rc4 first, then Kc7 — the king
 walks out toward b5, the checks follow, and on the fourth of them the rook
 interposes on the fourth rank with tempo: 1.Rc4 Rh1 2.Kc7 Rc1+ 3.Kb6 Rb1+
 4.Kc6 Rc1+ 5.Kb5 Rb1+ 6.Rb4. The pawn queens because the checking distance ran
 out, not because Black played badly.</p>
 <p>Played the other way round — king first, rook later — the same position is a
 draw. It is worth setting up and losing a few times against an engine before
 trusting it in a game.</p>`)}
${page(`<h2><span class="num">CHAPTER THREE</span>The third rank</h2>
 <p>The other half of rook endings is knowing when you are not lost. Here Black
 is a pawn down with the king in front of the pawn, and the position is a
 comfortable draw — provided the rook is on the correct rank.</p>
 ${board('4k3/8/r7/3KP3/8/8/4R3/8', pieces, 'Black to play and draw')}
 <p>The rook sits on the sixth rank, keeping the white king off it. It stays
 there as long as the pawn stays put. The moment the pawn advances to e6, the
 rook drops to the first rank and checks from behind, and the white king has
 nowhere to hide from the checks.</p>`)}
${page(`<p>What loses the position is drifting: a rook that leaves the sixth rank
 before the pawn moves lets the king in, and once the king reaches the seventh
 the defence is gone.</p>
 <p>Two positions, then, and one rule between them. In a rook ending the side
 with the pawn wants the enemy king cut off, and the side without it wants the
 checking distance long. Everything else follows from that.</p>
 <p style="margin-top:0.5in;text-align:center;font-style:italic;color:#555">
 End of the sample.</p>`)}`;
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html(cburnett()), { waitUntil: 'load' });
mkdirSync(dirname(OUT), { recursive: true });
await page.pdf({ path: OUT, width: '5.5in', height: '8.5in', printBackground: true });

/**
 * The pages that carry a diagram, as images, and where on each page the
 * diagram sits.
 *
 * This is the EVIDENCE a book puzzle is supposed to carry — the page it
 * was printed on and its place on that page — and the demo's puzzle book
 * had none, because it had nowhere to get one. Every `.page` here is
 * exactly one PDF page (`page-break-after: always`, and the sheet is the
 * PDF's own size), so a box measured against the page element is the box
 * on the printed page, and `pageNNN.jpg` numbers what it is a picture of.
 *
 * Written beside the PDF and fetched by the demo at boot, the way its
 * databases and its ECO tables are.
 */
mkdirSync(PAGES, { recursive: true });
const evidence = await page.$$eval('.page', (pages) =>
  pages.flatMap((sheet, index) => {
    const board = sheet.querySelector('.board');
    if (!board) return [];
    const sheetBox = sheet.getBoundingClientRect();
    const boardBox = board.getBoundingClientRect();
    return [
      {
        page: index + 1,
        rect: {
          x: (boardBox.x - sheetBox.x) / sheetBox.width,
          y: (boardBox.y - sheetBox.y) / sheetBox.height,
          w: boardBox.width / sheetBox.width,
          h: boardBox.height / sheetBox.height,
        },
      },
    ];
  }),
);
const sheets = await page.$$('.page');
for (const { page: number } of evidence) {
  await sheets[number - 1].screenshot({
    path: resolve(PAGES, `page${String(number).padStart(3, '0')}.jpg`),
    quality: 72,
    type: 'jpeg',
  });
}
writeFileSync(resolve(PAGES, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}
`);

await browser.close();
console.log(`${OUT}  ${(statSync(OUT).size / 1024).toFixed(0)} KB`);
for (const { page: number, rect } of evidence) {
  const at = resolve(PAGES, `page${String(number).padStart(3, '0')}.jpg`);
  const box = [rect.x, rect.y, rect.w, rect.h].map((v) => v.toFixed(3)).join(' ');
  console.log(`  page ${number}: ${(statSync(at).size / 1024).toFixed(0)} KB  rect ${box}`);
}
