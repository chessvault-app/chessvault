/**
 * Copy with fallback. The async Clipboard API is denied in cross-origin
 * isolated documents (Chromium), and this app IS cross-origin isolated —
 * the COOP/COEP headers that give Stockfish its SharedArrayBuffer also
 * break navigator.clipboard.writeText. The legacy execCommand path keeps
 * working there (and on plain-http LAN, another non-secure context this
 * app is served in), so try modern first and fall back.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fall through
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
