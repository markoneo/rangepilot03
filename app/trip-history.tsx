import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Alert,
  Modal,
  TextInput,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  loadTrips,
  deleteTrip,
  updateTripTitle,
  TripRecord,
  formatDuration,
} from '@/utils/storage';
import {
  ArrowLeft,
  Navigation,
  Clock,
  Battery,
  Zap,
  Trash2,
  Pencil,
  ChartLine as LineChart,
} from 'lucide-react-native';

export default function TripHistoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [trips, setTrips] = useState<TripRecord[]>([]);
  const [editingTrip, setEditingTrip] = useState<TripRecord | null>(null);
  const [titleDraft, setTitleDraft] = useState('');

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const data = await loadTrips();
        setTrips(data);
      })();
    }, [])
  );

  const doDelete = async (id: string) => {
    await deleteTrip(id);
    setTrips((prev) => prev.filter((t) => t.id !== id));
  };

  const confirmDelete = (id: string) => {
    if (Platform.OS === 'web') {
      const ok =
        typeof globalThis !== 'undefined' && (globalThis as any).confirm
          ? (globalThis as any).confirm('Remove this trip from history?')
          : true;
      if (ok) doDelete(id);
      return;
    }
    Alert.alert('Delete Trip', 'Remove this trip from history?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => doDelete(id) },
    ]);
  };

  const openTitleEditor = (trip: TripRecord) => {
    setEditingTrip(trip);
    setTitleDraft(trip.title ?? '');
  };

  const saveTitle = async () => {
    if (!editingTrip) return;
    const trimmed = titleDraft.trim();
    await updateTripTitle(editingTrip.id, trimmed);
    setTrips((prev) =>
      prev.map((t) =>
        t.id === editingTrip.id ? { ...t, title: trimmed || undefined } : t
      )
    );
    setEditingTrip(null);
    setTitleDraft('');
  };

  const renderTrip = ({ item }: { item: TripRecord }) => {
    const batteryUsed = item.startBattery - item.endBattery;
    const energyUsed = (item.batteryCapacity * (batteryUsed / 100)).toFixed(1);
    const date = new Date(item.startedAt);
    const dateStr = date.toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
    const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const cons = item.realConsumption ?? item.consumption;
    const isReal = item.realConsumption !== null;
    const hasTitle = !!item.title && item.title.length > 0;

    return (
      <TouchableOpacity
        style={styles.tripCard}
        activeOpacity={0.85}
        onPress={() => router.push({ pathname: '/trip-summary', params: { tripId: item.id } })}
      >
        <View style={styles.tripTopRow}>
          <View style={styles.tripTopText}>
            <Text style={styles.tripDate}>
              {dateStr} · {timeStr}
            </Text>
            <Text style={styles.tripCar}>{item.carName}</Text>
          </View>
          <TouchableOpacity
            onPress={() => confirmDelete(item.id)}
            style={styles.iconBtn}
            activeOpacity={0.7}
            hitSlop={8}
          >
            <Trash2 size={22} color="#EF4444" strokeWidth={2} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          onPress={() => openTitleEditor(item)}
          activeOpacity={0.7}
          style={styles.titleRow}
        >
          <Text style={[styles.titleText, !hasTitle && styles.titlePlaceholder]} numberOfLines={1}>
            {hasTitle ? item.title : 'Add title'}
          </Text>
          <Pencil size={18} color="#5C6670" strokeWidth={2} />
        </TouchableOpacity>

        <View style={styles.tripDistRow}>
          <Navigation size={14} color="#34D17A" strokeWidth={2} />
          <Text style={styles.tripDistValue}>{item.distanceKm.toFixed(1)} km</Text>
        </View>

        <View style={styles.tripMetaRow}>
          <TripMeta
            icon={<Clock size={13} color="#5C6670" strokeWidth={2} />}
            value={formatDuration(item.durationSeconds)}
          />
          <TripMeta
            icon={<Battery size={13} color="#5C6670" strokeWidth={2} />}
            value={`${item.startBattery}% → ${item.endBattery.toFixed(0)}%`}
          />
          <TripMeta
            icon={<Zap size={13} color="#5C6670" strokeWidth={2} />}
            value={`${energyUsed} kWh`}
          />
          <TripMeta
            icon={<Zap size={13} color={isReal ? '#F59E0B' : '#5C6670'} strokeWidth={2} />}
            value={`${cons.toFixed(1)} kWh/100`}
            accent={isReal}
          />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <ArrowLeft size={20} color="#8B95A1" strokeWidth={2} />
        </TouchableOpacity>
        <Text style={styles.title}>Trips</Text>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.push('/analytics')}
          activeOpacity={0.7}
        >
          <LineChart size={20} color="#34D17A" strokeWidth={2} />
        </TouchableOpacity>
      </View>

      {trips.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Navigation size={32} color="#2A323A" strokeWidth={1.5} />
          </View>
          <Text style={styles.emptyTitle}>No trips yet</Text>
          <Text style={styles.emptyBody}>Complete your first drive to see it here.</Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => router.replace('/')} activeOpacity={0.85}>
            <Text style={styles.emptyBtnText}>Back to home</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={trips}
          keyExtractor={(item) => item.id}
          renderItem={renderTrip}
          ListHeaderComponent={
            <Text style={styles.hint}>
              {trips.length} {trips.length === 1 ? 'trip' : 'trips'} ·{' '}
              {trips.reduce((s, t) => s + t.distanceKm, 0).toFixed(0)} km total · tap a trip for details
            </Text>
          }
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
        />
      )}

      <Modal
        visible={editingTrip !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingTrip(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={styles.modalBackdropTouch}
            onPress={() => setEditingTrip(null)}
          />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Trip title</Text>
            <TextInput
              value={titleDraft}
              onChangeText={setTitleDraft}
              placeholder="e.g. Morning commute"
              placeholderTextColor="#5C6670"
              style={styles.modalInput}
              autoFocus
              maxLength={60}
              returnKeyType="done"
              onSubmitEditing={saveTitle}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnGhost]}
                onPress={() => setEditingTrip(null)}
                activeOpacity={0.7}
              >
                <Text style={styles.modalBtnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnPrimary]}
                onPress={saveTitle}
                activeOpacity={0.85}
              >
                <Text style={styles.modalBtnPrimaryText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function TripMeta({
  icon, value, accent,
}: {
  icon: React.ReactNode;
  value: string;
  accent?: boolean;
}) {
  return (
    <View style={styles.metaChip}>
      {icon}
      <Text style={[styles.metaValue, accent && styles.metaValueAccent]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0B0E11',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1B2229',
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 20,
    fontFamily: 'Inter-Bold',
    color: '#34D17A',
    letterSpacing: -0.2,
  },
  list: {
    padding: 16,
    gap: 12,
  },
  hint: {
    color: '#8B95A1',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 8,
  },
  tripCard: {
    backgroundColor: '#12161B',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1B2229',
    gap: 12,
  },
  tripTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  tripTopText: {
    flex: 1,
    paddingRight: 8,
  },
  tripDate: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    color: '#5C6670',
    marginBottom: 2,
  },
  tripCar: {
    fontSize: 14,
    fontFamily: 'Inter-SemiBold',
    color: '#8B95A1',
  },
  iconBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0B0E11',
    borderWidth: 1,
    borderColor: '#1B2229',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  titleText: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter-SemiBold',
    color: '#F2F5F7',
  },
  titlePlaceholder: {
    color: '#5C6670',
    fontFamily: 'Inter-Regular',
  },
  tripDistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tripDistValue: {
    fontSize: 28,
    fontFamily: 'Inter-Bold',
    color: '#F2F5F7',
    letterSpacing: -0.8,
  },
  tripMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1B2229',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  metaValue: {
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    color: '#8B95A1',
  },
  metaValueAccent: {
    color: '#F59E0B',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#12161B',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1B2229',
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: 'Inter-Bold',
    color: '#F2F5F7',
    letterSpacing: -0.3,
  },
  emptyBody: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: '#5C6670',
    textAlign: 'center',
    lineHeight: 22,
  },
  emptyBtn: {
    backgroundColor: '#34D17A',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 28,
    marginTop: 8,
  },
  emptyBtnText: {
    fontSize: 15,
    fontFamily: 'Inter-SemiBold',
    color: '#06130C',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalBackdropTouch: {
    ...StyleSheet.absoluteFillObject,
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#12161B',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1B2229',
    padding: 20,
    gap: 14,
  },
  modalTitle: {
    fontSize: 16,
    fontFamily: 'Inter-Bold',
    color: '#F2F5F7',
  },
  modalInput: {
    backgroundColor: '#0B0E11',
    borderWidth: 1,
    borderColor: '#1B2229',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: 'Inter-Regular',
    color: '#F2F5F7',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  modalBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
  },
  modalBtnGhost: {
    backgroundColor: 'transparent',
  },
  modalBtnGhostText: {
    fontSize: 14,
    fontFamily: 'Inter-SemiBold',
    color: '#8B95A1',
  },
  modalBtnPrimary: {
    backgroundColor: '#34D17A',
  },
  modalBtnPrimaryText: {
    fontSize: 14,
    fontFamily: 'Inter-SemiBold',
    color: '#06130C',
  },
});
