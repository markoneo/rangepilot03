import { Platform } from 'react-native';
import { kv } from './kv';
import * as Trip from './tripTracker';
import { ringColor } from './ringColor';

/**
 * A running drive as an iOS Live Activity: range, battery % and consumption on
 * the lock screen, in the Dynamic Island and (iOS 26) on the CarPlay Dashboard.
 * Does nothing on Android and the web.
 */

const ID_KEY = 'ev_live_activity_id';
const MIN_UPDATE_MS = 15000;

let LA: typeof import('expo-live-activity') | null = null;
let id: string | null = null;
let loaded = false;
let lastKey = '';
let lastSentAt = 0;
let busy = false;

function lib() {
  if (LA) return LA;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    LA = require('expo-live-activity');
  } catch {
    LA = null;
  }
  return LA;
}

async function sync() {
  if (Platform.OS !== 'ios' || busy) return;
  const api = lib();
  if (!api) return;
  busy = true;
  try {
    if (!loaded) {
      id = (await kv.getItem(ID_KEY)) || null;
      loaded = true;
    }
    const snap = Trip.getSnapshot();
    if (!snap) {
      // no drive: take the panel away
      if (id) {
        try {
          api.stopActivity(id, { title: 'Drive finished', progressBar: { progress: 0 } });
        } catch {}
        id = null;
        lastKey = '';
        await kv.setItem(ID_KEY, '');
      }
      return;
    }
    const range = Math.max(0, Math.round(snap.rangeKm));
    const battery = Math.max(0, Math.min(100, snap.battery));
    const cons = snap.recentConsumption ?? snap.consumption;
    const paused = snap.phase === 'paused';
    const state = {
      title: `${range} km`,
      subtitle: `${paused ? 'Paused' : 'Range left'} · ${Math.round(battery)}% · ${cons.toFixed(1)} kWh/100 km`,
      progressBar: { progress: Math.round(battery) / 100 },
    };
    const key = `${state.title}|${state.subtitle}`;
    const now = Date.now();
    if (id && (key === lastKey || now - lastSentAt < MIN_UPDATE_MS)) return;
    if (id) {
      api.updateActivity(id, state);
    } else {
      const tint = ringColor(snap.usableBattery);
      const started = api.startActivity(state, {
        backgroundColor: '#0B0E11',
        titleColor: '#F2F5F7',
        subtitleColor: '#8B95A1',
        progressViewTint: tint,
        progressViewLabelColor: '#F2F5F7',
        deepLinkUrl: '/drive',
        padding: { horizontal: 18, top: 14, bottom: 14 },
      });
      id = typeof started === 'string' ? started : null;
      await kv.setItem(ID_KEY, id ?? '');
      if (!id) return;
    }
    lastKey = key;
    lastSentAt = now;
  } catch {
    // Live Activities switched off or not available on this phone: carry on without
  } finally {
    busy = false;
  }
}

if (Platform.OS === 'ios') {
  Trip.subscribe(() => {
    sync();
  });
  // the drive also moves on while the app is in the background
  setInterval(sync, 5000);
  sync();
}
