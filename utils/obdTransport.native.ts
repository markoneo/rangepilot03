import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, type Characteristic, type Device } from 'react-native-ble-plx';
import { kv } from './kv';
import type { FoundAdapter, ObdLink } from './obdTransport';

/**
 * Native (iOS / Android) version of the OBD adapter connection, over
 * Bluetooth LE. Same contract as the web version in obdTransport.ts.
 */

export type { FoundAdapter, ObdLink };

const DEVICE_KEY = 'ev_obd_device';
const full = (short: string) => `0000${short}-0000-1000-8000-00805f9b34fb`;
// Serial-over-BLE services used by common ELM327 adapters (Vgate first)
export const SERVICES: string[] = [
  full('18f0'),
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  full('fff0'),
  full('ffe0'),
  full('ffe5'),
  full('ae30'),
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
];

let manager: BleManager | null = null;
const mgr = () => (manager ??= new BleManager());

export function transportSupported(): boolean {
  return true;
}

/** The app lists nearby adapters itself (there is no system picker). */
export const ownPicker = true;

// The adapter speaks plain ASCII; Bluetooth values travel as base64
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function toBase64(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 3) {
    const a = text.charCodeAt(i) & 0xff;
    const b = i + 1 < text.length ? text.charCodeAt(i + 1) & 0xff : NaN;
    const c = i + 2 < text.length ? text.charCodeAt(i + 2) & 0xff : NaN;
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (isNaN(b) ? 0 : b >> 4)];
    out += isNaN(b) ? '=' : B64[((b & 15) << 2) | (isNaN(c) ? 0 : c >> 6)];
    out += isNaN(c) ? '=' : B64[c & 63];
  }
  return out;
}
function fromBase64(b64: string): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const ch of b64) {
    const i = B64.indexOf(ch);
    if (i < 0) continue;
    value = (value << 6) | i;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((value >> bits) & 0xff);
    }
  }
  return out;
}

async function androidPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const wanted =
    Number(Platform.Version) >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const result = await PermissionsAndroid.requestMultiple(wanted as any);
  return wanted.every((p) => (result as any)[p] === PermissionsAndroid.RESULTS.GRANTED);
}

/** Wait until Bluetooth is switched on (or report why it can't be used). */
function ready(): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const sub = mgr().onStateChange((s) => {
      if (done) return;
      if (s === 'PoweredOn') {
        done = true;
        sub.remove();
        resolve();
      } else if (s === 'PoweredOff' || s === 'Unauthorized' || s === 'Unsupported') {
        done = true;
        sub.remove();
        reject(
          new Error(
            s === 'PoweredOff'
              ? 'Bluetooth is switched off.'
              : s === 'Unauthorized'
                ? 'Range Pilot is not allowed to use Bluetooth. Allow it in the phone settings.'
                : 'This phone has no Bluetooth LE.'
          )
        );
      }
    }, true);
    setTimeout(() => {
      if (!done) {
        done = true;
        sub.remove();
        reject(new Error('Bluetooth is not ready.'));
      }
    }, 8000);
  });
}

/** List nearby adapters. Returns a function that stops the search. */
export function scanAdapters(onFound: (a: FoundAdapter) => void, onError: (message: string) => void): () => void {
  let stopped = false;
  (async () => {
    try {
      if (!(await androidPermissions())) throw new Error('Bluetooth permission was not given.');
      await ready();
      if (stopped) return;
      mgr().startDeviceScan(null, null, (error, device) => {
        if (error) {
          onError(error.message);
          return;
        }
        const name = device?.name ?? device?.localName;
        if (device && name) onFound({ id: device.id, name });
      });
    } catch (e: any) {
      onError(e?.message ?? 'Could not search for adapters.');
    }
  })();
  return () => {
    stopped = true;
    try {
      mgr().stopDeviceScan();
    } catch {}
  };
}

async function openDevice(id: string): Promise<ObdLink> {
  await ready();
  try {
    mgr().stopDeviceScan();
  } catch {}
  let device: Device = await mgr().connectToDevice(id, { timeout: 12000 });
  device = await device.discoverAllServicesAndCharacteristics();

  let notify: Characteristic | undefined;
  let write: Characteristic | undefined;
  const services = await device.services();
  // known serial services first, then anything else that offers both directions
  const ordered = [
    ...SERVICES.map((u) => services.find((s) => s.uuid.toLowerCase() === u)).filter(Boolean),
    ...services.filter((s) => !SERVICES.includes(s.uuid.toLowerCase()) && !/^0000180[01]-/.test(s.uuid)),
  ] as typeof services;
  for (const service of ordered) {
    const chars = await service.characteristics();
    const n = chars.find((c) => c.isNotifiable || c.isIndicatable);
    const w = chars.find((c) => c.isWritableWithoutResponse || c.isWritableWithResponse);
    if (n && w) {
      notify = n;
      write = w;
      break;
    }
  }
  if (!notify || !write) {
    await device.cancelConnection().catch(() => {});
    throw new Error('This adapter is not supported yet.');
  }

  let dataCb: (t: string) => void = () => {};
  let goneCb: () => void = () => {};
  const monitor = notify.monitor((error, c) => {
    if (!error && c?.value) dataCb(fromBase64(c.value));
  });
  const gone = device.onDisconnected(() => goneCb());
  await kv.setItem(DEVICE_KEY, id);
  const out = write;

  return {
    name: device.name ?? device.localName ?? 'OBD adapter',
    async write(text) {
      const data = toBase64(text);
      if (out.isWritableWithoutResponse) await out.writeWithoutResponse(data);
      else await out.writeWithResponse(data);
    },
    onData(cb) {
      dataCb = cb;
    },
    onDisconnect(cb) {
      goneCb = cb;
    },
    reopen() {
      monitor.remove();
      gone.remove();
      return openDevice(id);
    },
    close() {
      monitor.remove();
      gone.remove();
      device.cancelConnection().catch(() => {});
    },
  };
}

/** Connect to the adapter the user picked from the app's own list. */
export async function connectNew(id?: string): Promise<ObdLink | null> {
  if (!id) return null;
  return openDevice(id);
}

/** Reconnect to the adapter used last time. */
export async function connectKnown(): Promise<ObdLink | null> {
  const id = await kv.getItem(DEVICE_KEY);
  if (!id) return null;
  if (!(await androidPermissions())) return null;
  return openDevice(id);
}
