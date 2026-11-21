import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { MapboxNavigationView, type NavigationMarker } from '@atomiqlab/react-native-mapbox-navigation';
import { C } from '@/constants/theme';
import type { DriveNavProps } from './DriveNav';

export const navAvailable = true;

/** Mapbox turn-by-turn to the trip's destination, with the route chargers as markers. */
export function DriveNav({ origin, dest, chargers, onClose, onError, children }: DriveNavProps) {
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
      enabled
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
      onError={(e) => onError(e?.message || e?.code || 'Navigation error')}
    >
      {children}
    </MapboxNavigationView>
  );
}
