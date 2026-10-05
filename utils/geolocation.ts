import { Platform } from 'react-native';

export type GeoPermissionStatus = 'granted' | 'denied' | 'prompt';

export type GeoCoords = {
  latitude: number;
  longitude: number;
  /** m/s, null or negative when unknown */
  speed: number | null;
  /** horizontal accuracy in metres (null if unknown) */
  accuracy: number | null;
  altitude: number | null;
  altitudeAccuracy: number | null;
  /** fix time in ms (from the GPS, not when we received it) */
  timestamp: number;
};

export type GeoWatcher = {
  remove: () => void;
};

export const BACKGROUND_LOCATION_TASK = 'range-pilot-background-location';

const isBrowser =
  Platform.OS === 'web' && typeof navigator !== 'undefined' && !!navigator.geolocation;

function fromExpo(loc: any): GeoCoords {
  return {
    latitude: loc.coords.latitude,
    longitude: loc.coords.longitude,
    speed: loc.coords.speed ?? null,
    accuracy: loc.coords.accuracy ?? null,
    altitude: loc.coords.altitude ?? null,
    altitudeAccuracy: loc.coords.altitudeAccuracy ?? null,
    timestamp: loc.timestamp ?? Date.now(),
  };
}

/**
 * Must be called at module scope from the app entry (index.js) so the task
 * exists when the OS wakes the JS runtime in the background / headless.
 * Defining it lazily inside a React effect (as before) meant background
 * deliveries were silently dropped after the app was suspended or killed.
 */
export function defineBackgroundLocationTask(handler: (fixes: GeoCoords[]) => Promise<void> | void) {
  if (Platform.OS === 'web') return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const TaskManager = require('expo-task-manager');
    if (TaskManager.isTaskDefined?.(BACKGROUND_LOCATION_TASK)) return;
    TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }: any) => {
      if (error) return;
      const locations = data?.locations;
      if (!Array.isArray(locations) || locations.length === 0) return;
      try {
        await handler(locations.map(fromExpo));
      } catch {
        // never throw from a background task
      }
    });
  } catch {
    // expo-task-manager unavailable (e.g. Expo Go on iOS) — foreground only
  }
}

export async function getPermissionStatus(): Promise<GeoPermissionStatus> {
  if (Platform.OS === 'web') {
    if (!isBrowser) return 'prompt';
    try {
      if (navigator.permissions) {
        const result = await navigator.permissions.query({
          name: 'geolocation' as PermissionName,
        });
        return result.state as GeoPermissionStatus;
      }
    } catch {
      // fall through
    }
    return 'prompt';
  }

  try {
    const Location = await import('expo-location');
    const fg = await Location.getForegroundPermissionsAsync();
    if (fg.status === 'granted') return 'granted';
    if (fg.status === 'denied' && !fg.canAskAgain) return 'denied';
    return 'prompt';
  } catch {
    return 'prompt';
  }
}

/** 'granted' | 'denied' | 'unsupported' (web has no background location). */
export async function getBackgroundPermissionStatus(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (Platform.OS === 'web') return 'unsupported';
  try {
    const Location = await import('expo-location');
    const bg = await Location.getBackgroundPermissionsAsync();
    return bg.status === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'unsupported';
  }
}

export async function requestBackgroundPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const Location = await import('expo-location');
    const bg = await Location.requestBackgroundPermissionsAsync();
    return bg.status === 'granted';
  } catch {
    return false;
  }
}

export async function requestPermission(): Promise<GeoPermissionStatus> {
  if (Platform.OS === 'web') {
    if (!isBrowser) return 'denied';
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        () => resolve('granted'),
        (err) => {
          if (err.code === err.PERMISSION_DENIED) resolve('denied');
          else resolve('prompt');
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }

  try {
    const Location = await import('expo-location');
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') {
      return fg.canAskAgain ? 'prompt' : 'denied';
    }
    // Background ("Always") permission is what keeps the drive counting with
    // the screen off. Not fatal if denied — gaps are reconstructed later.
    try {
      await Location.requestBackgroundPermissionsAsync();
    } catch {
      // ignore
    }
    return 'granted';
  } catch {
    return 'denied';
  }
}

/**
 * Start delivering fixes. Foreground fixes go to `onFix`; background fixes go
 * to the handler registered with defineBackgroundLocationTask (the trip
 * tracker dedupes the two streams by timestamp).
 */
export function startLocationUpdates(
  onFix: (coords: GeoCoords) => void,
  onError?: (err: unknown) => void
): GeoWatcher {
  if (Platform.OS === 'web') {
    if (!isBrowser) return { remove: () => {} };
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        onFix({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          speed: pos.coords.speed,
          accuracy: pos.coords.accuracy ?? null,
          altitude: pos.coords.altitude ?? null,
          altitudeAccuracy: pos.coords.altitudeAccuracy ?? null,
          timestamp: pos.timestamp ?? Date.now(),
        });
      },
      (err) => onError?.(err),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
    return { remove: () => navigator.geolocation.clearWatch(id) };
  }

  let removed = false;
  let nativeSub: { remove: () => void } | null = null;

  (async () => {
    try {
      const Location = await import('expo-location');

      nativeSub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 1000,
          distanceInterval: 0,
        },
        (pos) => onFix(fromExpo(pos))
      );
      if (removed) {
        nativeSub?.remove();
        nativeSub = null;
        return;
      }

      const bg = await Location.getBackgroundPermissionsAsync();
      if (bg.status === 'granted') {
        try {
          const TaskManager = require('expo-task-manager');
          if (!TaskManager.isTaskDefined?.(BACKGROUND_LOCATION_TASK)) return;
        } catch {
          return;
        }
        const running = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
        if (!running && !removed) {
          await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 1000,
            distanceInterval: 0,
            deferredUpdatesInterval: 0,
            showsBackgroundLocationIndicator: true,
            pausesUpdatesAutomatically: false,
            activityType: Location.ActivityType.AutomotiveNavigation,
            foregroundService: {
              notificationTitle: 'Range Pilot is tracking your drive',
              notificationBody: 'Distance and range keep updating with the screen off.',
              notificationColor: '#3B82F6',
              killServiceOnDestroy: false,
            },
          });
        }
      }
    } catch (e) {
      onError?.(e);
    }
  })();

  return {
    remove: () => {
      removed = true;
      nativeSub?.remove();
      nativeSub = null;
      stopBackgroundUpdates();
    },
  };
}

export async function stopBackgroundUpdates(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const Location = await import('expo-location');
    const running = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    if (running) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  } catch {
    // ignore
  }
}
