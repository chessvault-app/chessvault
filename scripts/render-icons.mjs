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
// Two sizes, because the platforms disagree and one file cannot satisfy
// both. macOS refuses anything under 512 ("Icon must be at least 512x512
// pixels, provided: 256x256"), while NSIS refuses anything over 256 —
// desktop/build-server.mjs turns the 256 into icon.ico, and feeding it a
// 512 produced "invalid icon file size" and no Windows installer.
render(512, 'desktop/icon.png');
render(256, 'desktop/icon-256.png');

/**
 * iOS splash screens (apple-touch-startup-image): the app background with
 * the knight centred, one per common device point-size at 3x/2x. iOS
 * shows pure white without these; with them the launch feels native.
 */
const splashSvg = (w, h, logo) => `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#171a22"/>
  <g transform="translate(${(w - logo) / 2}, ${(h - logo) / 2}) scale(${logo / 45})">
    <rect width="45" height="45" rx="10" fill="#3d8fd1" transform="scale(1)" opacity="0"/>
    <path fill="#3d8fd1" d="M 22,10 C 32.5,11 38.5,18 38,39 L 15,39 C 15,30 25,32.5 23,18 Z M 24,18 C 24.38,20.91 18.45,25.37 16,27 C 13,29 13.18,31.34 11,31 C 9.958,30.06 12.41,27.96 11,28 C 10,28 11.19,29.23 10,30 C 9,30 5.997,31 6,26 C 6,24 12,14 12,14 C 12,14 13.89,12.1 14,10.5 C 13.27,9.506 13.5,8.5 13.5,7.5 C 14.5,6.5 16.5,10 16.5,10 L 18.5,10 C 18.5,10 19.28,8.008 21,7 C 22,7 22,10 22,10 Z"/>
  </g>
</svg>`;

const splash = (w, h, name) => {
  const png = new Resvg(splashSvg(w, h, Math.round(Math.min(w, h) * 0.28))).render().asPng();
  writeFileSync(`web/public/splash/${name}`, png);
  console.log(`web/public/splash/${name}  ${w}x${h}`);
};
import { mkdirSync } from 'node:fs';
mkdirSync('web/public/splash', { recursive: true });
// device points × scale: the common iPhone / iPad classes.
splash(1290, 2796, 'iphone-pro-max.png');   // 430x932 @3x
splash(1179, 2556, 'iphone-pro.png');       // 393x852 @3x
splash(1170, 2532, 'iphone.png');           // 390x844 @3x
splash(1125, 2436, 'iphone-x.png');         // 375x812 @3x
splash(828, 1792, 'iphone-xr.png');         // 414x896 @2x
splash(750, 1334, 'iphone-se.png');         // 375x667 @2x
splash(1536, 2048, 'ipad.png');             // 768x1024 @2x
splash(1668, 2388, 'ipad-pro-11.png');      // 834x1194 @2x
splash(2048, 2732, 'ipad-pro-13.png');      // 1024x1366 @2x
