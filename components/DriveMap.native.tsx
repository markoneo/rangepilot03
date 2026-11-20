import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { C } from '@/constants/theme';
import { DRIVE_MAP_HTML, type DriveMapData } from '@/utils/driveMapHtml';

/** The drive-screen map in the apps: the map page in a WebView (see utils/driveMapHtml.ts). */
export function DriveMap({ data }: { data: DriveMapData }) {
  const ref = useRef<WebView>(null);
  const loaded = useRef(false);
  const json = JSON.stringify(data);
  const latest = useRef(json);
  latest.current = json;

  const send = () => {
    if (!loaded.current) return;
    ref.current?.injectJavaScript(`window.__driveMap && window.__driveMap(${latest.current}); true;`);
  };

  useEffect(() => {
    send();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [json]);

  return (
    <View style={styles.box}>
      <WebView
        ref={ref}
        originWhitelist={['*']}
        source={{ html: DRIVE_MAP_HTML, baseUrl: 'https://app.rangepilot.net/' }}
        style={styles.web}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        overScrollMode="never"
        bounces={false}
        setSupportMultipleWindows={false}
        androidLayerType="hardware"
        nestedScrollEnabled
        onLoadEnd={() => {
          loaded.current = true;
          send();
        }}
        onMessage={() => {
          loaded.current = true;
          send();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, backgroundColor: C.card },
  web: { flex: 1, backgroundColor: '#14181c' },
});
