/**
 * Backup / restore of everything Range Pilot keeps on the device.
 * A backup is one JSON file the user can save (Drive, e-mail, files) and
 * restore on the same or a new phone.
 */
import { Platform } from 'react-native';
import { kv } from './kv';

const KEYS = [
  'ev_car_settings',
  'ev_app_state',
  'ev_prefs',
  'ev_trips',
  'ev_charges',
  'ev_recent_places',
];

interface BackupFile {
  app: 'range-pilot';
  version: 1;
  exportedAt: string;
  data: Record<string, string | null>;
}

async function build(): Promise<BackupFile> {
  const data: Record<string, string | null> = {};
  for (const k of KEYS) data[k] = await kv.getItem(k);
  return { app: 'range-pilot', version: 1, exportedAt: new Date().toISOString(), data };
}

function fileName() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `range-pilot-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}

/** Number of trips in the backup, for the confirmation text. */
export function backupTripCount(b: BackupFile): number {
  try {
    const t = JSON.parse(b.data.ev_trips ?? '[]');
    return Array.isArray(t) ? t.length : 0;
  } catch {
    return 0;
  }
}

export async function exportBackup(): Promise<void> {
  const json = JSON.stringify(await build(), null, 2);
  if (Platform.OS === 'web') {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return;
  }
  const FileSystem = await import('expo-file-system/legacy');
  const Sharing = await import('expo-sharing');
  const uri = `${FileSystem.cacheDirectory}${fileName()}`;
  await FileSystem.writeAsStringAsync(uri, json);
  await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: 'Save Range Pilot backup' });
}

/** Let the user pick a backup file. Returns null if cancelled. Throws if invalid. */
export async function pickBackup(): Promise<BackupFile | null> {
  let text: string | null = null;
  if (Platform.OS === 'web') {
    text = await new Promise<string | null>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.onchange = () => {
        const f = input.files?.[0];
        if (!f) return resolve(null);
        const r = new FileReader();
        r.onload = () => resolve(String(r.result ?? ''));
        r.onerror = () => resolve(null);
        r.readAsText(f);
      };
      input.click();
    });
  } else {
    const DocumentPicker = await import('expo-document-picker');
    const FileSystem = await import('expo-file-system/legacy');
    const res = await DocumentPicker.getDocumentAsync({
      type: ['application/json', 'text/plain', '*/*'],
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets?.[0]) return null;
    text = await FileSystem.readAsStringAsync(res.assets[0].uri);
  }
  if (!text) return null;
  const parsed = JSON.parse(text);
  if (parsed?.app !== 'range-pilot' || typeof parsed?.data !== 'object') {
    throw new Error('This is not a Range Pilot backup file.');
  }
  return parsed as BackupFile;
}

/** Replace the data on this device with the backup. */
export async function restoreBackup(b: BackupFile): Promise<void> {
  for (const k of KEYS) {
    const v = b.data[k];
    if (typeof v === 'string' && v.length) await kv.setItem(k, v);
  }
}
