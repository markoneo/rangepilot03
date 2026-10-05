import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getPermissionStatus, requestPermission as requestGeoPermission } from '@/utils/geolocation';
import { MapPin, ArrowLeft, ExternalLink } from 'lucide-react-native';

type PermState = 'prompt' | 'denied';

export default function DrivePermissionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<PermState>('prompt');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    checkAndRedirect();
  }, []);

  const checkAndRedirect = async () => {
    const status = await getPermissionStatus();
    if (status === 'granted') {
      router.replace({ pathname: '/drive', params: { start: '1' } });
    }
  };

  const requestPermission = async () => {
    setLoading(true);
    const status = await requestGeoPermission();
    setLoading(false);
    if (status === 'granted') {
      router.replace({ pathname: '/drive', params: { start: '1' } });
    } else if (status === 'denied') {
      setState('denied');
    }
  };

  const openSettings = () => {
    if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:');
    } else {
      Linking.openSettings();
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + 24 }]}>
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
        <ArrowLeft size={20} color="#9CA3AF" strokeWidth={2} />
      </TouchableOpacity>

      <View style={styles.content}>
        <View style={styles.iconRing}>
          <View style={styles.iconInner}>
            <MapPin size={36} color={state === 'denied' ? '#EF4444' : '#3B82F6'} strokeWidth={2} />
          </View>
        </View>

        {state === 'prompt' ? (
          <>
            <Text style={styles.title}>Enable GPS to{'\n'}track your drive</Text>
            <Text style={styles.body}>
              Range Pilot uses your location to measure distance and keep your range accurate.
              {Platform.OS !== 'web'
                ? ' Choose “Allow all the time / Always” so it keeps counting with the screen off.'
                : ''}
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.title}>Location access{'\n'}is turned off</Text>
            <Text style={styles.body}>
              Please enable location access in your device Settings to use Drive Mode.
            </Text>
          </>
        )}

        <View style={styles.featureList}>
          {[
            'Live range while you drive',
            'Works through tunnels',
            'Learns your real consumption',
          ].map((f) => (
            <View key={f} style={styles.featureRow}>
              <View style={styles.featureDot} />
              <Text style={styles.featureText}>{f}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.actions}>
        {state === 'prompt' ? (
          <>
            <TouchableOpacity
              style={[styles.primaryBtn, loading && styles.btnDisabled]}
              onPress={requestPermission}
              activeOpacity={0.85}
              disabled={loading}
            >
              <MapPin size={18} color="#FFFFFF" strokeWidth={2.5} />
              <Text style={styles.primaryBtnText}>
                {loading ? 'Requesting...' : 'Enable GPS'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.ghostBtn} onPress={() => router.back()} activeOpacity={0.7}>
              <Text style={styles.ghostBtnText}>Not now</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity style={styles.primaryBtn} onPress={openSettings} activeOpacity={0.85}>
              <ExternalLink size={18} color="#FFFFFF" strokeWidth={2.5} />
              <Text style={styles.primaryBtnText}>Open Settings</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.ghostBtn} onPress={() => router.back()} activeOpacity={0.7}>
              <Text style={styles.ghostBtnText}>Back</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0B0F14',
    paddingHorizontal: 28,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconRing: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 1,
    borderColor: '#1F2937',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 36,
  },
  iconInner: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 8,
  },
  title: {
    fontSize: 30,
    fontFamily: 'Inter-Bold',
    color: '#F9FAFB',
    textAlign: 'center',
    letterSpacing: -0.8,
    lineHeight: 38,
    marginBottom: 16,
  },
  body: {
    fontSize: 15,
    fontFamily: 'Inter-Regular',
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 36,
  },
  featureList: {
    width: '100%',
    gap: 12,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
  },
  featureDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#3B82F6',
  },
  featureText: {
    fontSize: 14,
    fontFamily: 'Inter-Medium',
    color: '#9CA3AF',
  },
  actions: {
    gap: 12,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#3B82F6',
    borderRadius: 18,
    paddingVertical: 18,
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  btnDisabled: {
    opacity: 0.7,
  },
  primaryBtnText: {
    fontSize: 16,
    fontFamily: 'Inter-SemiBold',
    color: '#FFFFFF',
  },
  ghostBtn: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  ghostBtnText: {
    fontSize: 15,
    fontFamily: 'Inter-Medium',
    color: '#6B7280',
  },
});
