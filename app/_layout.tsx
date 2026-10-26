import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { useFonts } from 'expo-font';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import * as SplashScreen from 'expo-splash-screen';
import { migrateToLocal } from '@/utils/migrateLocal';
import { resumeTrackingIfNeeded } from '@/utils/tripTracker';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  useFrameworkReady();

  const [fontsLoaded, fontError] = useFonts({
    'Inter-Regular': Inter_400Regular,
    'Inter-Medium': Inter_500Medium,
    'Inter-SemiBold': Inter_600SemiBold,
    'Inter-Bold': Inter_700Bold,
  });

  // One-time move of old account data to the device (max ~6 s, never blocks for long).
  const [dataReady, setDataReady] = useState(false);
  useEffect(() => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        setDataReady(true);
      }
    };
    migrateToLocal().finally(finish);
    const t = setTimeout(finish, 6000);
    return () => clearTimeout(t);
  }, []);

  // If a drive was in progress when the app was killed, restart GPS right
  // away — before any screen mounts — so no more distance is lost.
  useEffect(() => {
    resumeTrackingIfNeeded().catch(() => {});
  }, []);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const head = document.head;

    const ensure = (
      selector: string,
      create: () => HTMLElement,
    ) => {
      if (!document.querySelector(selector)) head.appendChild(create());
    };

    const link = (rel: string, href: string, attrs: Record<string, string> = {}) => {
      const el = document.createElement('link');
      el.rel = rel;
      el.href = href;
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
      return el;
    };

    const meta = (name: string, content: string, useProperty = false) => {
      const el = document.createElement('meta');
      el.setAttribute(useProperty ? 'property' : 'name', name);
      el.content = content;
      return el;
    };

    ensure('link[rel="icon"][sizes="32x32"]', () =>
      link('icon', '/icon-32.png', { type: 'image/png', sizes: '32x32' }),
    );
    ensure('link[rel="icon"][sizes="192x192"]', () =>
      link('icon', '/icon-192.png', { type: 'image/png', sizes: '192x192' }),
    );
    ensure('link[rel="shortcut icon"]', () => link('shortcut icon', '/favicon.ico'));
    ensure('link[rel="apple-touch-icon"]', () => link('apple-touch-icon', '/icon-180.png'));
    ensure('link[rel="apple-touch-icon"][sizes="180x180"]', () =>
      link('apple-touch-icon', '/icon-180.png', { sizes: '180x180' }),
    );
    ensure('link[rel="manifest"]', () => link('manifest', '/manifest.webmanifest'));

    ensure('meta[name="theme-color"]', () => meta('theme-color', '#0B0F14'));
    ensure('meta[name="apple-mobile-web-app-capable"]', () =>
      meta('apple-mobile-web-app-capable', 'yes'),
    );
    ensure('meta[name="apple-mobile-web-app-status-bar-style"]', () =>
      meta('apple-mobile-web-app-status-bar-style', 'black-translucent'),
    );
    ensure('meta[name="apple-mobile-web-app-title"]', () =>
      meta('apple-mobile-web-app-title', 'Range Pilot'),
    );
    ensure('meta[name="mobile-web-app-capable"]', () =>
      meta('mobile-web-app-capable', 'yes'),
    );
    ensure('meta[name="application-name"]', () =>
      meta('application-name', 'Range Pilot'),
    );
  }, []);

  if ((!fontsLoaded && !fontError) || !dataReady) {
    return null;
  }

  return (
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0B0F14' } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="drive-permission" />
        <Stack.Screen name="drive" />
        <Stack.Screen name="trip-summary" />
        <Stack.Screen name="trip-history" />
        <Stack.Screen name="analytics" />
        <Stack.Screen name="charges" />
        <Stack.Screen name="+not-found" />
      </Stack>
      <StatusBar style="light" />
    </>
  );
}
