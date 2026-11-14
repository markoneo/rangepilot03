/**
 * How the app talks to a Bluetooth OBD adapter. This file is the WEB version
 * (Web Bluetooth: Chrome on Android/desktop). The native apps use
 * obdTransport.native.ts, which the bundler picks automatically.
 */

export interface ObdLink {
  name: string;
  /** send raw text to the adapter */
  write(text: string): Promise<void>;
  /** text received from the adapter */
  onData(cb: (text: string) => void): void;
  onDisconnect(cb: () => void): void;
  /** connect again to the same adapter, without asking the user */
  reopen(): Promise<ObdLink>;
  close(): void;
}

export interface FoundAdapter {
  id: string;
  name: string;
}

// Serial-over-BLE services used by common ELM327 adapters (Vgate first)
export const SERVICES: (number | string)[] = [
  0x18f0,
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  0xfff0,
  0xffe0,
  0xffe5,
  0xae30,
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
];

const bt = () => (typeof navigator !== 'undefined' ? (navigator as any).bluetooth : undefined);

export function transportSupported(): boolean {
  return !!bt();
}

/** On the web the browser shows its own device picker; the native apps list adapters themselves. */
export const ownPicker = false;

async function openDevice(device: any): Promise<ObdLink> {
  const server = await device.gatt.connect();
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

  let dataCb: (t: string) => void = () => {};
  let goneCb: () => void = () => {};
  notify.addEventListener('characteristicvaluechanged', (e: any) => dataCb(new TextDecoder().decode(e.target.value)));
  await notify.startNotifications();
  const onGone = () => goneCb();
  device.addEventListener('gattserverdisconnected', onGone);

  return {
    name: device.name ?? 'OBD adapter',
    async write(text) {
      const data = new TextEncoder().encode(text);
      if (write.properties.writeWithoutResponse) await write.writeValueWithoutResponse(data);
      else await write.writeValue(data);
    },
    onData(cb) {
      dataCb = cb;
    },
    onDisconnect(cb) {
      goneCb = cb;
    },
    reopen() {
      device.removeEventListener('gattserverdisconnected', onGone);
      return openDevice(device);
    },
    close() {
      device.removeEventListener('gattserverdisconnected', onGone);
      try {
        device.gatt.disconnect();
      } catch {}
    },
  };
}

/** Ask the user to choose an adapter (browser picker). Must be called from a tap. */
export async function connectNew(_id?: string): Promise<ObdLink | null> {
  let device: any;
  try {
    device = await bt().requestDevice({ acceptAllDevices: true, optionalServices: SERVICES });
  } catch (e: any) {
    if (e?.name === 'NotFoundError') return null; // picker closed
    throw e;
  }
  return openDevice(device);
}

/** Reconnect to an adapter the browser already knows, without a picker. */
export async function connectKnown(): Promise<ObdLink | null> {
  if (!bt()?.getDevices) return null;
  const devices = await bt().getDevices();
  return devices.length ? openDevice(devices[0]) : null;
}

/** Native apps only. */
export function scanAdapters(_onFound: (a: FoundAdapter) => void, _onError: (message: string) => void): () => void {
  return () => {};
}
