import { Platform } from 'react-native';
import { kv } from './kv';
import * as Trip from './tripTracker';

/**
 * Live battery % from the car through a Bluetooth LE OBD adapter (ELM327).
 *
 * Web only for now (Web Bluetooth: Chrome on Android/desktop). Read-only: it
 * asks the car for the standard "battery remaining" value (PID 5B) every few
 * seconds. While a drive is running, each change is fed to the trip tracker as
 * a battery correction, so the consumption is learned from the car itself.
 */

export type ObdStatus = 'off' | 'connecting' | 'connected' | 'lost' | 'unsupported-car';

export interface ObdState {
  status: ObdStatus;
  /** battery % as the car reports it */
  soc: number | null;
  /** when soc was last read */
  at: number | null;
  name: string | null;
  error: string | null;
}

const ENABLED_KEY = 'ev_obd_enabled';
const POLL_MS = 5000;
// Serial-over-BLE services used by common ELM327 adapters (Vgate first)
const SERVICES: (number | string)[] = [
  0x18f0,
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  0xfff0,
  0xffe0,
  0xffe5,
  0xae30,
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
];

let state: ObdState = { status: 'off', soc: null, at: null, name: null, error: null };
const listeners = new Set<() => void>();
let device: any = null;
let writeChar: any = null;
let buffer = '';
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let wanted = false; // the user asked to be connected
let busy = false;
let fails = 0;
let lastFed: number | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function set(patch: Partial<ObdState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function obdSupported(): boolean {
  return Platform.OS === 'web' && typeof navigator !== 'undefined' && !!(navigator as any).bluetooth;
}
export function getObd(): ObdState {
  return state;
}
export function subscribeObd(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
/** The user has connected an adapter before, so the app shows the OBD layout */
export async function obdEnabled(): Promise<boolean> {
  return obdSupported() && (await kv.getItem(ENABLED_KEY)) === '1';
}

async function cmd(c: string, timeoutMs = 5000): Promise<string> {
  if (!writeChar) throw new Error('not connected');
  buffer = '';
  const data = new TextEncoder().encode(c + '\r');
  if (writeChar.properties.writeWithoutResponse) await writeChar.writeValueWithoutResponse(data);
  else await writeChar.writeValue(data);
  const start = Date.now();
  while (!buffer.includes('>') && Date.now() - start < timeoutMs) await sleep(15);
  return buffer.replace(/[>\s]/g, ' ').trim();
}

/** "…415BAA…" → 66.7. With several control units answering, the one that is not zero wins. */
function parseSoc(answer: string): number | null {
  let best: number | null = null;
  const re = /415B([0-9A-F]{2})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer.replace(/\s/g, '')))) {
    const v = (parseInt(m[1], 16) * 100) / 255;
    if (best == null || v > best) best = v;
  }
  return best == null ? null : Math.round(best * 10) / 10;
}

async function open(dev: any) {
  device = dev;
  set({ status: 'connecting', name: dev.name ?? 'OBD adapter', error: null });
  const server = await dev.gatt.connect();
  let notify: any = null;
  let write: any = null;
  for (const id of SERVICES) {
    let service: any;
    try {
      service = await server.getPrimaryService(id);
    } catch {
      continue;
    }
    const chars = await service.getCharacteristics();
    notify = chars.find((ch: any) => ch.properties.notify || ch.properties.indicate);
    write = chars.find((ch: any) => ch.properties.write || ch.properties.writeWithoutResponse);
    if (notify && write) break;
  }
  if (!notify || !write) throw new Error('This adapter is not supported yet.');
  writeChar = write;
  notify.addEventListener('characteristicvaluechanged', (e: any) => {
    buffer += new TextDecoder().decode(e.target.value);
  });
  await notify.startNotifications();
  if (!dev.__rpHooked) {
    dev.__rpHooked = true;
    dev.addEventListener('gattserverdisconnected', onDisconnected);
  }

  await cmd('ATZ', 8000);
  await cmd('ATE0');
  await cmd('ATL0');
  await cmd('ATS0');
  await cmd('ATH0');
  await cmd('ATAT1');
  await cmd('ATSP0');
  // first request also lets the adapter find the car's protocol
  let soc = parseSoc(await cmd('015B', 15000));
  if (soc == null) soc = parseSoc(await cmd('015B', 8000));
  if (soc == null) {
    set({ status: 'unsupported-car', error: 'This car does not report its battery % over OBD.' });
    wanted = false;
    try {
      dev.gatt.disconnect();
    } catch {}
    return;
  }
  fails = 0;
  await kv.setItem(ENABLED_KEY, '1');
  gotSoc(soc);
  set({ status: 'connected' });
  schedule();
}

function gotSoc(soc: number) {
  set({ soc, at: Date.now() });
  // During a drive the car's value replaces manual corrections. Only real changes
  // are passed on, so the learning sees clean steps.
  const trip = Trip.getTrip();
  if (trip && (lastFed == null || Math.abs(soc - lastFed) >= 0.3)) {
    lastFed = soc;
    Trip.setBattery(soc).catch(() => {});
  }
  if (!trip) lastFed = null;
}

function schedule() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(poll, POLL_MS);
}

async function poll() {
  if (!wanted || state.status !== 'connected' || busy) return;
  busy = true;
  try {
    const soc = parseSoc(await cmd('015B', 4000));
    if (soc != null) {
      fails = 0;
      gotSoc(soc);
    } else if (++fails >= 6) {
      // car asleep / ignition off: keep the link, show the last value as stale
      set({ error: 'The car stopped answering (switched off?).' });
    }
  } catch {
    fails++;
  } finally {
    busy = false;
    if (wanted && state.status === 'connected') schedule();
  }
}

function onDisconnected() {
  writeChar = null;
  if (pollTimer) clearTimeout(pollTimer);
  if (!wanted) {
    set({ status: 'off' });
    return;
  }
  set({ status: 'lost' });
  retry();
}

async function retry() {
  // The browser lets us reconnect to a device the user already picked, without asking again
  for (let i = 0; i < 60 && wanted && state.status === 'lost' && device; i++) {
    await sleep(5000);
    if (!wanted || state.status !== 'lost') return;
    try {
      await open(device);
      return;
    } catch {
      set({ status: 'lost' });
    }
  }
}

/** Must be called from a tap: the browser shows its device picker. */
export async function connectObd(): Promise<void> {
  if (!obdSupported() || state.status === 'connecting' || state.status === 'connected') return;
  wanted = true;
  try {
    const dev = await (navigator as any).bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: SERVICES,
    });
    await open(dev);
  } catch (e: any) {
    wanted = false;
    const cancelled = e?.name === 'NotFoundError';
    set({ status: 'off', error: cancelled ? null : (e?.message ?? 'Could not connect.') });
  }
}

/** Try to reconnect silently to an adapter the browser already knows (no picker). */
export async function resumeObd(): Promise<void> {
  if (!(await obdEnabled()) || state.status !== 'off' || wanted) return;
  const bt = (navigator as any).bluetooth;
  if (!bt.getDevices) return;
  try {
    const devices = await bt.getDevices();
    if (!devices.length) return;
    wanted = true;
    await open(devices[0]);
  } catch {
    wanted = false;
    set({ status: 'off' });
  }
}

export function disconnectObd() {
  wanted = false;
  if (pollTimer) clearTimeout(pollTimer);
  try {
    device?.gatt?.disconnect();
  } catch {}
  writeChar = null;
  set({ status: 'off', error: null });
}

/** Stop using OBD altogether: back to the manual layout. */
export async function forgetObd() {
  disconnectObd();
  await kv.setItem(ENABLED_KEY, '');
  set({ soc: null, at: null, name: null });
}
