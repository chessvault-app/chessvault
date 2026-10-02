import { describe, expect, it } from 'vitest';
import type { NetworkInterfaceInfo } from 'node:os';
import { bootBanner } from './bootBanner.ts';

const iface = (address: string, internal: boolean): NetworkInterfaceInfo => ({
  address,
  netmask: '255.255.255.0',
  family: 'IPv4',
  mac: '00:00:00:00:00:00',
  internal,
  cidr: null,
});
const interfaces = { lo: [iface('127.0.0.1', true)], eth0: [iface('192.0.2.20', false)] };
const phoneLine = (lines: string[]): string | undefined => lines.find((l) => l.includes('on your phone'));

describe('boot banner', () => {
  it('offers no LAN address for a server bound to loopback, and names its own port', () => {
    const lines = bootBanner({ address: '127.0.0.1', port: 8950 }, { dev: false, interfaces });
    expect(lines[0]).toContain('http://127.0.0.1:8950');
    expect(lines.join('\n')).not.toContain('192.0.2.20');
    expect(lines.join('\n')).not.toContain(':5173');
    expect(phoneLine(lines)).toContain('not reachable');
  });

  it('sends a phone to this server’s own port when it listens everywhere', () => {
    const lines = bootBanner({ address: '::', port: 8950 }, { dev: false, interfaces });
    expect(lines[0]).toContain('http://127.0.0.1:8950');
    expect(phoneLine(lines)).toContain('http://192.0.2.20:8950');
  });

  it('sends a phone to Vite only while the dev pair runs', () => {
    const lines = bootBanner({ address: '127.0.0.1', port: 8787 }, { dev: true, interfaces });
    expect(phoneLine(lines)).toContain('http://192.0.2.20:5173');
  });

  it('names the one address a server bound to it answers on', () => {
    const lines = bootBanner({ address: '198.51.100.7', port: 8787 }, { dev: false, interfaces });
    expect(lines[0]).toContain('http://198.51.100.7:8787');
    expect(phoneLine(lines)).toContain('http://198.51.100.7:8787');
  });

  it('prints no phone line when there is no network to offer', () => {
    const lines = bootBanner({ address: '0.0.0.0', port: 8787 }, { dev: false, interfaces: { lo: interfaces.lo } });
    expect(phoneLine(lines)).toBeUndefined();
  });
});
