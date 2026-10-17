/**
 * Keep the phone screen on during a drive (web).
 *
 * 1. Screen Wake Lock API — re-requested whenever it's released (the browser
 *    drops it on every app switch / screen dim) and on every tap, because
 *    some browsers only grant it after a user gesture.
 * 2. Fallback for iPhones where the Wake Lock doesn't hold (older iOS, apps
 *    added to the home screen): a tiny silent looping video, the same trick
 *    NoSleep.js uses. iOS doesn't auto-lock while a video plays.
 */
const VIDEO =
  'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMrbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAB9AAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAlV0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAB9AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAfQAAAAAAABAAAAAAHNbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAgABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABeG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAThzdGJsAAAAuHN0c2QAAAAAAAAAAQAAAKhhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFUxhdmM2MC4zMS4xMDIgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAALmF2Y0MBQsAK/+EAFmdCwArZHsBEAAADAAQAAAMACDxImSABAAVoy4PLIAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAApAAAAKQAAAABhzdHRzAAAAAAAAAAEAAAACAABAAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAACAAAAAQAAABxzdHN6AAAAAAAAAAAAAAACAAAChgAAAAoAAAAUc3RjbwAAAAAAAAABAAADWwAAAGJ1ZHRhAAAAWm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALWlsc3QAAAAlqXRvbwAAAB1kYXRhAAAAAQAAAABMYXZmNjAuMTYuMTAwAAAACGZyZWUAAAKYbWRhdAAAAnAGBf//bNxF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjQgcjMxMDggMzFlMTlmOSAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjMgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0wIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDE6MHgxMTEgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTAgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0xIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MCB3ZWlnaHRwPTAga2V5aW50PTI1MCBrZXlpbnRfbWluPTEgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAOZYiEBb///w9FAAFPf4AAAAAGQZo4CvqA';

let active = false;
let sentinel: any = null;
let video: HTMLVideoElement | null = null;
let listening = false;

function isWeb() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

async function requestLock() {
  if (!active || document.visibilityState !== 'visible') return;
  const wl = (navigator as any).wakeLock;
  if (!wl) return startVideo();
  if (sentinel && !sentinel.released) return;
  try {
    sentinel = await wl.request('screen');
    sentinel.addEventListener?.('release', () => {
      sentinel = null;
      if (active) setTimeout(requestLock, 500);
    });
  } catch {
    sentinel = null;
    startVideo();
  }
}

function isIOS() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);
}

function startVideo() {
  if (!active) return;
  if (!video) {
    video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    video.muted = true;
    video.loop = true;
    video.src = VIDEO;
    Object.assign(video.style, {
      position: 'fixed',
      width: '1px',
      height: '1px',
      opacity: '0.01',
      pointerEvents: 'none',
      left: '0',
      bottom: '0',
    });
    document.body.appendChild(video);
  }
  if (video.paused) video.play().catch(() => {});
}

const onVisible = () => {
  if (document.visibilityState === 'visible') {
    requestLock();
    if (video) startVideo();
  }
};
const onGesture = () => {
  requestLock();
  if (isIOS()) startVideo();
};

export function keepScreenOn() {
  if (!isWeb()) return;
  active = true;
  requestLock();
  if (isIOS()) startVideo(); // works only after a tap; onGesture retries
  if (!listening) {
    listening = true;
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('touchend', onGesture, { passive: true });
    document.addEventListener('click', onGesture);
  }
}

export function allowScreenOff() {
  if (!isWeb()) return;
  active = false;
  try {
    sentinel?.release?.();
  } catch {
    // ignore
  }
  sentinel = null;
  if (video) {
    video.pause();
    video.remove();
    video = null;
  }
  if (listening) {
    listening = false;
    document.removeEventListener('visibilitychange', onVisible);
    document.removeEventListener('touchend', onGesture);
    document.removeEventListener('click', onGesture);
  }
}
