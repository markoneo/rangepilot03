import { createElement, useEffect, useRef } from 'react';
import { DRIVE_MAP_HTML, type DriveMapData } from '@/utils/driveMapHtml';

/**
 * The drive-screen map on the WEB: the map page in an iframe. The native apps
 * use DriveMap.native.tsx (a WebView), which the bundler picks automatically.
 */
export function DriveMap({ data }: { data: DriveMapData }) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const latest = useRef(data);
  latest.current = data;

  const send = () => {
    try {
      ref.current?.contentWindow?.postMessage({ __driveMap: latest.current }, '*');
    } catch {
      // frame not ready yet
    }
  };

  useEffect(() => {
    send();
  });

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data === 'driveMapReady') send();
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  return createElement('iframe', {
    ref,
    srcDoc: DRIVE_MAP_HTML,
    title: 'Route map',
    onLoad: send,
    style: { border: 0, width: '100%', height: '100%', background: '#14181c', display: 'block' },
  });
}
