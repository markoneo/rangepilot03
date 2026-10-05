import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Persistent key/value storage.
 *
 * - Native: AsyncStorage (survives app kill / reboot).
 * - Web: localStorage.
 *
 * Previously native builds used a plain in-memory object, so an active drive
 * (and all trip history for guests) vanished whenever the OS killed the app in
 * the background. Everything now goes through here.
 */

const memory: Record<string, string> = {};

const hasLocalStorage =
  Platform.OS === 'web' &&
  typeof globalThis !== 'undefined' &&
  typeof (globalThis as any).localStorage !== 'undefined';

export const kv = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      if (hasLocalStorage) {
        try {
          return (globalThis as any).localStorage.getItem(key);
        } catch {
          // fall through
        }
      }
      return memory[key] ?? null;
    }
    try {
      const v = await AsyncStorage.getItem(key);
      return v ?? memory[key] ?? null;
    } catch {
      return memory[key] ?? null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    memory[key] = value;
    if (Platform.OS === 'web') {
      if (hasLocalStorage) {
        try {
          (globalThis as any).localStorage.setItem(key, value);
        } catch {
          // quota / private mode — memory copy still works for this session
        }
      }
      return;
    }
    try {
      await AsyncStorage.setItem(key, value);
    } catch {
      // ignore
    }
  },

  async removeItem(key: string): Promise<void> {
    delete memory[key];
    if (Platform.OS === 'web') {
      if (hasLocalStorage) {
        try {
          (globalThis as any).localStorage.removeItem(key);
        } catch {
          // ignore
        }
      }
      return;
    }
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
};

export async function readJSON<T>(key: string): Promise<T | null> {
  const raw = await kv.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeJSON(key: string, value: unknown): Promise<void> {
  await kv.setItem(key, JSON.stringify(value));
}
