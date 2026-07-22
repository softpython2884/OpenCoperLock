/**
 * Turn a raw browser user-agent string into a short, human-readable label like
 * "Chrome 149 · Windows" or "Safari · iPhone". Best-effort only: the raw string is kept for the
 * tooltip so nothing is lost. Order matters — check the more specific tokens (Edg, OPR) before the
 * generic ones (Chrome, Safari) they embed.
 */
export interface ParsedUserAgent {
  browser: string;
  os: string;
  mobile: boolean;
  /** "Chrome 149 · Windows" — the compact one-liner shown in the UI. */
  label: string;
}

function firstMatch(ua: string, re: RegExp): string | null {
  const m = ua.match(re);
  return m ? (m[1] ?? '') : null;
}

export function parseUserAgent(raw: string | null | undefined): ParsedUserAgent {
  const ua = raw ?? '';
  const mobile = /Mobile|Android|iPhone|iPad|iPod/i.test(ua);

  // OS
  let os = 'Inconnu';
  if (/Windows NT 10/.test(ua)) os = 'Windows';
  else if (/Windows NT/.test(ua)) os = 'Windows';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone/.test(ua)) os = 'iPhone';
  else if (/iPad/.test(ua)) os = 'iPad';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  // Browser — most specific first (Edge/Opera/Brave embed the Chrome token).
  let browser = 'Navigateur';
  let ver: string | null = null;
  if ((ver = firstMatch(ua, /Edg(?:A|iOS)?\/(\d+)/))) browser = 'Edge';
  else if ((ver = firstMatch(ua, /OPR\/(\d+)/)) || (ver = firstMatch(ua, /Opera\/(\d+)/))) browser = 'Opera';
  else if ((ver = firstMatch(ua, /SamsungBrowser\/(\d+)/))) browser = 'Samsung Internet';
  else if ((ver = firstMatch(ua, /Firefox\/(\d+)/))) browser = 'Firefox';
  else if ((ver = firstMatch(ua, /Chrome\/(\d+)/))) browser = mobile ? 'Chrome Mobile' : 'Chrome';
  else if (/Safari\//.test(ua) && (ver = firstMatch(ua, /Version\/(\d+)/))) browser = 'Safari';
  else if (/curl|wget|python|node|axios|Go-http/i.test(ua)) {
    browser = firstMatch(ua, /^([\w-]+)/) ?? 'Client';
    ver = null;
  }

  const browserLabel = ver ? `${browser} ${ver}` : browser;
  const label = os === 'Inconnu' ? browserLabel : `${browserLabel} · ${os}`;
  return { browser, os, mobile, label };
}
