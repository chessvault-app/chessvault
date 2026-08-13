import type { Plugin } from 'vite';

/**
 * Let the launch screen paint before the app's stylesheet arrives.
 *
 * The screen's own styles are inline in <head>, ready from the first byte
 * of the document — and it still could not draw, because a stylesheet in
 * <head> blocks the FIRST PAINT of the whole page, not just of the things
 * that need it. Vite emits one, and Tailwind's output for this app is
 * 260 kB. So the sequence on a cold launch was: iOS shows its startup
 * image, the image goes, and then nothing is painted at all until a
 * quarter of a megabyte of CSS has been fetched and parsed.
 *
 * That is the gap nothing else could close. Waiting longer before taking
 * the screen down cannot help, because the screen was not on screen yet.
 *
 * So the stylesheet is loaded without blocking: `media="print"` matches
 * nothing on a display, so the browser fetches it at leisure and paints
 * immediately; `onload` switches it to `all` and it applies. The <noscript>
 * copy keeps it blocking where there is no script to switch it back.
 *
 * The app under the screen is unstyled for that moment, which nobody sees
 * — it is under an opaque screen — and main.tsx will not take the screen
 * away until this link reports itself loaded. See `whenStyled`.
 */
export function launchScreen(): Plugin {
  return {
    name: 'chess-vault:launch-screen',
    // `post`, so this runs after Vite has injected its own tags.
    enforce: 'post',
    apply: 'build',
    transformIndexHtml(html) {
      let swapped = 0;
      const out = html.replace(
        /<link rel="stylesheet"([^>]*)href="([^"]+)"([^>]*)>/g,
        (whole, before: string, href: string, after: string) => {
          // Only the app's own bundle; anything with a media of its own is
          // already saying when it applies and is not ours to reinterpret.
          if (/media=/.test(whole)) return whole;
          swapped += 1;
          const attrs = `${before}href="${href}"${after}`.trimEnd();
          return (
            `<link rel="stylesheet"${attrs} media="print" ` +
            `onload="this.media='all';this.dataset.styled='1'" data-app-styles>` +
            `<noscript><link rel="stylesheet"${attrs}></noscript>`
          );
        },
      );
      if (swapped !== 1) {
        // Loud, because the failure mode is silent: the launch screen goes
        // back to waiting on the stylesheet and nobody notices until a
        // phone is watched on a slow connection.
        throw new Error(
          `launch-screen: expected exactly 1 blocking stylesheet in index.html, found ${swapped}`,
        );
      }
      return out;
    },
  };
}
