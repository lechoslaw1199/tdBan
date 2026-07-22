function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).slice(0, 8);
}

export function collectDeviceInfo() {
  const userAgent = navigator.userAgent || '';
  const platform = navigator.platform || 'unknown';
  const language = navigator.language || 'unknown';
  const screen = `${window.screen.width}x${window.screen.height}`;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
  const fingerprintSource = [userAgent, platform, language, screen, timezone].join('|');
  const deviceFingerprint = simpleHash(fingerprintSource);

  return {
    userAgent,
    platform,
    language,
    screen,
    timezone,
    deviceFingerprint,
  };
}
