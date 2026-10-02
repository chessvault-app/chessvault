import type { NetworkInterfaceInfo } from 'node:os';

/** Where Vite serves the app while `npm run dev` runs (web/vite.config.ts). */
const VITE_DEV_PORT = 5173;

const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;

const url = (host: string, port: number): string => `http://${host.includes(':') ? `[${host}]` : host}:${port}`;

/**
 * The lines the server prints once it is listening: where to open it on
 * this computer, and where a phone on the same network opens it.
 *
 * Read off the socket the server actually holds, not assumed. The phone
 * line used to be Vite's dev port on the first LAN address whatever was
 * running, so a server started with `CHESS_BIND=127.0.0.1` and its own
 * PORT still offered `http://<lan ip>:5173`, an address nothing answered
 * on. Vite's port is right only while the dev pair runs (`npm run dev`,
 * whose Vite listens on the LAN and passes /api through to this server),
 * which is what `dev` says; otherwise a phone reaches this server's own
 * port, and nothing reaches a server bound to loopback but this computer.
 */
export function bootBanner(
  bound: { address: string; port: number },
  { dev, interfaces }: { dev: boolean; interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> },
): string[] {
  const everywhere = bound.address === '0.0.0.0' || bound.address === '::';
  const loopback = LOOPBACK.test(bound.address);
  // A wildcard answers on loopback too; one named address answers only there.
  const here = everywhere ? '127.0.0.1' : bound.address;
  const lan = Object.values(interfaces)
    .flat()
    .find((iface) => iface && iface.family === 'IPv4' && !iface.internal)?.address;

  let phone: string | null;
  if (dev) phone = lan ? url(lan, VITE_DEV_PORT) : null;
  else if (loopback) phone = `not reachable, the server listens on ${bound.address} only`;
  else if (everywhere) phone = lan ? url(lan, bound.port) : null;
  else phone = url(bound.address, bound.port);

  return [
    `  chess-vault server  ${url(here, bound.port)}`,
    `  cross-origin isolation: on (Stockfish threads enabled)`,
    ...(phone ? [`  on your phone:      ${phone}`] : []),
  ];
}
