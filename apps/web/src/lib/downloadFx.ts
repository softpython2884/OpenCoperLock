/**
 * Tiny pub-sub for a "download started" visual cue. Call signalDownload(name) wherever a download
 * is kicked off; the global <DownloadIndicator/> shows a brief animation. Especially useful on
 * mobile/PWA where a download silently goes to the notification tray with no in-page feedback.
 */
export function signalDownload(name?: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('ocl:download', { detail: { name: name ?? '' } }));
}
