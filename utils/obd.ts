import { Platform } from 'react-native';
import { kv } from './kv';
import * as Trip from './tripTracker';

/**
 * Live battery % from the car through a Bluetooth LE OBD adapter (ELM327).
 *
 * Web only for now (Web Bluetooth: Chrome on Android/desktop).
 *
 * Deliberately minimal, to stay out of the car's way:
 * - the ONLY request ever sent to the car is the standard OBD-II "battery
 *   remaining" value (service 01, PID 5B) — the same thing any OBD app polls;
 * - no diagnostic sessions, no tester-present, no manufacturer (UDS) requests,
 *   no scanning, nothing that writes or clears;
 * - once the control unit that answers is known, only that unit is asked;
 * - slow polling: every 10 s while driving, every 30 s otherwise.
 *
 * While a drive is running, each change is fed to the trip tracker as a
 * battery correction, so the consumption is learned from the car itself.
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
const POLL_DRIVING_MS = 10000;
const POLL_IDLE_MS = 30000;
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
let idleTicks = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function set(patch: Partial<ObdState>) {
  const wasLive = state.status === 'connected';
  state = { ...state, ...patch };
  // lost the adapter mid-drive: the app goes back to predicting the battery
  if (wasLive && state.status !== 'connected' && Trip.getTrip()) Trip.setObdLive(false).catch(() => {});
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

/**
 * With headers on, each answering unit sends a line like "7ED03415BAA".
 * Returns the request address of the unit whose value is not zero, so later
 * requests go to that unit alone instead of being broadcast.
 */
function socUnit(answer: string): string | null {
  for (const line of answer.split(/\s+/)) {
    const m11 = line.match(/^(7E[89A-F])[0-9A-F]{2}415B([0-9A-F]{2})/);
    if (m11 && m11[2] !== '00') return (parseInt(m11[1], 16) - 8).toString(16).toUpperCase();
    const m29 = line.match(/^18DAF1([0-9A-F]{2})[0-9A-F]{2}415B([0-9A-F]{2})/);
    if (m29 && m29[2] !== '00') return `18DA${m29[1]}F1`;
  }
  return null;
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
  await cmd('ATH1');
  await cmd('ATAT1');
  await cmd('ATSP0');
  // first request also lets the adapter find the car's protocol
  let first = await cmd('015B', 15000);
  let soc = parseSoc(first);
  if (soc == null) {
    first = await cmd('015B', 8000);
    soc = parseSoc(first);
  }
  // from here on, talk only to the unit that reports the battery
  const unit = socUnit(first);
  if (unit) await cmd(`ATSH${unit}`);
  await cmd('ATH0');
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
  // During a drive the car's value IS the battery, and every reading is kept so
  // the consumption can be measured from the car itself.
  if (Trip.getTrip()) Trip.setObdBattery(soc).catch(() => {});
}

function schedule() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(poll, POLL_DRIVING_MS);
}

async function poll() {
  if (!wanted || state.status !== 'connected' || busy) return;
  // Outside a drive, ask only every third tick (30 s); a drive that starts is picked up within 10 s
  idleTicks = Trip.getTrip() ? 0 : idleTicks + 1;
  if (idleTicks % (POLL_IDLE_MS / POLL_DRIVING_MS) !== 0) {
    schedule();
    return;
  }
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
