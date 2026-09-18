import { describe, expect, it } from 'vitest';
import { detectPlatform } from './platform';

describe('detectPlatform', () => {
  it('reads an iPhone from the platform string', () => {
    expect(detectPlatform({ platform: 'iPhone', maxTouchPoints: 5 })).toBe('ios');
    expect(detectPlatform({ platform: 'iPod' })).toBe('ios');
  });

  it('tells an iPad from a Mac by its touch points', () => {
    expect(detectPlatform({ platform: 'MacIntel', maxTouchPoints: 5 })).toBe('ios');
    expect(detectPlatform({ platform: 'MacIntel', maxTouchPoints: 0 })).toBe('desktop');
    expect(detectPlatform({ platform: 'MacIntel' })).toBe('desktop');
  });

  it('prefers userAgentData for Android and everything else', () => {
    expect(detectPlatform({ platform: 'Linux armv8l', userAgentData: { platform: 'Android' } })).toBe('android');
    expect(detectPlatform({ platform: 'Win32', userAgentData: { platform: 'Windows' } })).toBe('desktop');
    // A Windows touchscreen is a desktop.
    expect(detectPlatform({ platform: 'Win32', maxTouchPoints: 10, userAgentData: { platform: 'Windows' } })).toBe(
      'desktop',
    );
  });

  it('falls back to the user agent string where userAgentData is missing', () => {
    expect(
      detectPlatform({ platform: 'Linux armv8l', userAgent: 'Mozilla/5.0 (Android 15; Mobile; rv:132.0) Firefox/132.0' }),
    ).toBe('android');
    expect(detectPlatform({ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/132.0' })).toBe(
      'desktop',
    );
  });

  it('is desktop when nothing is known', () => {
    expect(detectPlatform({})).toBe('desktop');
  });
});
