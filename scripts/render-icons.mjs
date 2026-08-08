import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';

/** Rasterise the favicon knight into every PNG the app ships. */
const svg = readFileSync('web/public/favicon.svg', 'utf-8');
const render = (size, path) => {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(path, png);
  console.log(`${path}  ${size}x${size}  ${png.length} bytes`);
};
render(512, 'web/public/icon-512.png');
render(192, 'web/public/icon-192.png');
render(180, 'web/public/apple-touch-icon.png');
render(256, 'desktop/icon.png');
