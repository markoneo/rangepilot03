import { useEffect, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { MapboxNavigationView, addErrorListener, type NavigationMarker } from '@atomiqlab/react-native-mapbox-navigation';
import { C } from '@/constants/theme';
import type { DriveNavProps } from './DriveNav';

export const navAvailable = true;

/** Mapbox turn-by-turn to the trip's destination, with the route chargers as markers. */
export function DriveNav({ origin, dest, chargers, onClose, onError, onStarted, children }: DriveNavProps) {
  // Start one tick after mounting, with the error listener already in place:
  // an error raised while the native view is still being set up is otherwise lost.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const sub = addErrorListener((e) => onError(`${e?.code ?? 'ERROR'}: ${e?.message ?? ''}`));
    const t = setTimeout(() => setReady(true), 50);
    return () => {
      clearTimeout(t);
      sub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useMemo(
    () => ({ latitude: origin.lat, longitude: origin.lon, name: 'Current location' }),
    [origin.lat, origin.lon]
  );
  const end = useMemo(
    () => ({ latitude: dest.lat, longitude: dest.lon, name: dest.name }),
    [dest.lat, dest.lon, dest.name]
  );
  const markers: NavigationMarker[] = useMemo(
    () =>
      chargers.map((c, i) => ({
        id: `charger-${i}`,
        latitude: c.lat,
        longitude: c.lon,
        label: c.label,
        glyph: '⚡',
        color: C.blue,
        size: 'small',
      })),
    [chargers]
  );

  return (
    <MapboxNavigationView
      enabled={ready}
      style={StyleSheet.absoluteFill}
      startOrigin={start}
      destination={end}
      navigationMarkers={markers}
      distanceUnit="metric"
      uiTheme="night"
      showCancelButton
      showsSpeedLimits
      showsReportFeedback={false}
      showsEndOfRouteFeedback={false}
      routeLineTracksTraversal
      eventThrottleMs={1000}
      colors={{ routeLine: C.blue }}
      onCancelNavigation={onClose}
      onRouteChange={() => onStarted?.()}
      onRouteProgressChange={() => onStarted?.()}
      onError={(e) => onError(`${e?.code ?? 'ERROR'}: ${e?.message ?? ''}`)}
    >
      {children}
    </MapboxNavigationView>
  );
}
