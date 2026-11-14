import { kv } from './kv';
import * as Trip from './tripTracker';
import { connectKnown, connectNew, ownPicker, scanAdapters, transportSupported, type ObdLink } from './obdTransport';

/**
 * Live battery % from the car through a Bluetooth LE OBD adapter (ELM327).
 * Works in the native apps and, on the web, in browsers with Web Bluetooth.
 *
 * Deliberately minimal, to stay out of the car's way:
 * - the ONLY request ever sent to the car is the standard OBD-II "battery
 *   remaining" value (service 01, PID 5B) — the same thing any OBD app polls;
 * - no diagnostic sessions, no tester-present, no manufacturer (UDS) requests,
 *   no scanning, nothing that writes or clears;
 * - once the control unit that answers is known, only that unit is asked;
 * - slow polling: every 10 s while driving, every 30 s otherwise.
 *
 * While a drive is running the car's value is the battery, and the
 * consumption is measured from it.
 */

export { ownPicker as obdOwnPicker, scanAdapters as scanObdAdapters };

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
let state: ObdState = { status: 'off', soc: null, at: null, name: null, error: null };
const listeners = new Set<() => void>();
let link: ObdLink | null = null;
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
  return transportSupported();
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
  if (!link) throw new Error('not connected');
  buffer = '';
  await link.write(c + '\r');
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

async function open(next: ObdLink) {
  link = next;
  set({ status: 'connecting', name: next.name, error: null });
  next.onData((text) => {
    buffer += text;
  });
  next.onDisconnect(onDisconnected);

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
    next.close();
    link = null;
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
  if (pollTimer) clearTimeout(pollTimer);
  if (!wanted) {
    link = null;
    set({ status: 'off' });
    return;
  }
  set({ status: 'lost' });
  retry();
}

async function retry() {
  // reconnect to the same adapter without asking again
  for (let i = 0; i < 60 && wanted && state.status === 'lost' && link; i++) {
    await sleep(5000);
    if (!wanted || state.status !== 'lost' || !link) return;
    try {
      await open(await link.reopen());
      return;
    } catch {
      set({ status: 'lost' });
    }
  }
}

/**
 * Connect an adapter. On the web the browser shows its picker (must be called
 * from a tap); in the native apps pass the id chosen from the app's own list.
 */
export async function connectObd(id?: string): Promise<void> {
  if (!obdSupported() || state.status === 'connecting' || state.status === 'connected') return;
  wanted = true;
  set({ status: 'connecting', error: null });
  try {
    // native: no id means "the adapter used last time"
    const next = ownPicker && !id ? await connectKnown() : await connectNew(id);
    if (!next) {
      wanted = false;
      set({ status: 'off' });
      return;
    }
    await open(next);
  } catch (e: any) {
    wanted = false;
    link = null;
    set({ status: 'off', error: e?.message ?? 'Could not connect.' });
  }
}

/** Try to reconnect silently to the adapter used before (no picker). */
export async function resumeObd(): Promise<void> {
  if (!(await obdEnabled()) || state.status !== 'off' || wanted) return;
  wanted = true;
  try {
    const next = await connectKnown();
    if (!next) {
      wanted = false;
      return;
    }
    await open(next);
  } catch {
    wanted = false;
    link = null;
    set({ status: 'off' });
  }
}

export function disconnectObd() {
  wanted = false;
  if (pollTimer) clearTimeout(pollTimer);
  link?.close();
  link = null;
  set({ status: 'off', error: null });
}

/** Stop using OBD altogether: back to the manual layout. */
export async function forgetObd() {
  disconnectObd();
  await kv.setItem(ENABLED_KEY, '');
  set({ soc: null, at: null, name: null });
}
