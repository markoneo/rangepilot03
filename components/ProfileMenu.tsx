import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
  TextInput,
  Image,
  Platform,
  ScrollView,
} from 'react-native';
import { Settings, LogOut, Camera, User as UserIcon, X, Check } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/utils/supabase';
import { signOut } from '@/utils/auth';
import { loadProfile, upsertProfile, UserProfile } from '@/utils/profile';

type Props = {
  size?: number;
};

export default function ProfileMenu({ size = 40 }: Props) {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string>('');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [avatarDraft, setAvatarDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const u = data.user;
      if (!u) return;
      setUserId(u.id);
      setEmail(u.email ?? '');
      const p = await loadProfile(u.id);
      setProfile(p);
    })();
  }, []);

  const initials = (() => {
    const n = profile?.display_name?.trim();
    if (n) {
      const parts = n.split(/\s+/);
      const a = parts[0]?.[0] ?? '';
      const b = parts[1]?.[0] ?? '';
      return (a + b).toUpperCase() || n[0].toUpperCase();
    }
    if (email) return email[0].toUpperCase();
    return '?';
  })();

  const openEdit = () => {
    setNameDraft(profile?.display_name ?? '');
    setAvatarDraft(profile?.avatar_url ?? null);
    setMenuOpen(false);
    setTimeout(() => setEditOpen(true), 50);
  };

  const pickImageWeb = () => {
    if (Platform.OS !== 'web') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 1_500_000) {
        alert('Please choose an image under 1.5 MB.');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const res = reader.result;
        if (typeof res === 'string') setAvatarDraft(res);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const pickImageNative = async () => {
    try {
      const ImagePicker = await import('expo-image-picker');
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return;
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.6,
        base64: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (asset.base64) {
        setAvatarDraft(`data:image/jpeg;base64,${asset.base64}`);
      } else if (asset.uri) {
        setAvatarDraft(asset.uri);
      }
    } catch {
      // expo-image-picker not installed; silently skip on native
    }
  };

  const pickImage = () => {
    if (Platform.OS === 'web') pickImageWeb();
    else pickImageNative();
  };

  const saveProfile = async () => {
    if (!userId) return;
    setSaving(true);
    const updated = await upsertProfile(userId, {
      display_name: nameDraft.trim(),
      avatar_url: avatarDraft,
    });
    setSaving(false);
    if (updated) setProfile(updated);
    setEditOpen(false);
  };

  const handleSignOut = async () => {
    setMenuOpen(false);
    await signOut();
  };

  const handleSettings = () => {
    setMenuOpen(false);
    router.push('/settings');
  };

  const avatarNode = profile?.avatar_url ? (
    <Image source={{ uri: profile.avatar_url }} style={{ width: size, height: size, borderRadius: size / 2 }} />
  ) : (
    <View
      style={[
        styles.avatarFallback,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Text style={[styles.avatarInitials, { fontSize: size * 0.4 }]}>{initials}</Text>
    </View>
  );

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => setMenuOpen(true)}
        style={[styles.avatarBtn, { width: size, height: size, borderRadius: size / 2 }]}
      >
        {avatarNode}
      </TouchableOpacity>

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setMenuOpen(false)}>
          <Pressable style={styles.menuCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.menuHeader}>
              <View style={styles.menuAvatarWrap}>
                {profile?.avatar_url ? (
                  <Image source={{ uri: profile.avatar_url }} style={styles.menuAvatar} />
                ) : (
                  <View style={[styles.menuAvatar, styles.avatarFallback]}>
                    <Text style={[styles.avatarInitials, { fontSize: 24 }]}>{initials}</Text>
                  </View>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.menuName} numberOfLines={1}>
                  {profile?.display_name?.trim() || 'Your profile'}
                </Text>
                <Text style={styles.menuEmail} numberOfLines={1}>
                  {email}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setMenuOpen(false)} hitSlop={10}>
                <X size={20} color="#6B7280" strokeWidth={2} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.menuItem} activeOpacity={0.75} onPress={openEdit}>
              <View style={styles.menuIconWrap}>
                <UserIcon size={18} color="#3B82F6" strokeWidth={2.2} />
              </View>
              <Text style={styles.menuItemText}>Edit profile</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.menuItem} activeOpacity={0.75} onPress={handleSettings}>
              <View style={styles.menuIconWrap}>
                <Settings size={18} color="#3B82F6" strokeWidth={2.2} />
              </View>
              <Text style={styles.menuItemText}>Settings</Text>
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            <TouchableOpacity style={styles.menuItem} activeOpacity={0.75} onPress={handleSignOut}>
              <View style={[styles.menuIconWrap, { backgroundColor: '#FEF2F2' }]}>
                <LogOut size={18} color="#EF4444" strokeWidth={2.2} />
              </View>
              <Text style={[styles.menuItemText, { color: '#EF4444' }]}>Log out</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={editOpen} transparent animationType="fade" onRequestClose={() => setEditOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setEditOpen(false)}>
          <Pressable style={styles.editCard} onPress={(e) => e.stopPropagation()}>
            <ScrollView
              contentContainerStyle={{ padding: 24 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.editHeader}>
                <Text style={styles.editTitle}>Edit profile</Text>
                <TouchableOpacity onPress={() => setEditOpen(false)} hitSlop={10}>
                  <X size={22} color="#6B7280" strokeWidth={2} />
                </TouchableOpacity>
              </View>

              <View style={styles.avatarPickerWrap}>
                <TouchableOpacity activeOpacity={0.85} onPress={pickImage} style={styles.avatarPicker}>
                  {avatarDraft ? (
                    <Image source={{ uri: avatarDraft }} style={styles.avatarLarge} />
                  ) : (
                    <View style={[styles.avatarLarge, styles.avatarFallback]}>
                      <Text style={[styles.avatarInitials, { fontSize: 36 }]}>{initials}</Text>
                    </View>
                  )}
                  <View style={styles.cameraBadge}>
                    <Camera size={16} color="#FFFFFF" strokeWidth={2.2} />
                  </View>
                </TouchableOpacity>
                <Text style={styles.avatarHint}>Tap to change photo</Text>
                {avatarDraft && (
                  <TouchableOpacity onPress={() => setAvatarDraft(null)} style={styles.removePhotoBtn}>
                    <Text style={styles.removePhotoText}>Remove photo</Text>
                  </TouchableOpacity>
                )}
              </View>

              <Text style={styles.fieldLabel}>Display name</Text>
              <TextInput
                style={styles.textInput}
                value={nameDraft}
                onChangeText={setNameDraft}
                placeholder="Your name"
                placeholderTextColor="#9CA3AF"
                maxLength={40}
                returnKeyType="done"
                onSubmitEditing={saveProfile}
              />

              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.7 }]}
                activeOpacity={0.85}
                onPress={saveProfile}
                disabled={saving}
              >
                <Check size={18} color="#FFFFFF" strokeWidth={2.4} />
                <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  avatarBtn: {
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
    backgroundColor: '#FFFFFF',
  },
  avatarFallback: {
    backgroundColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    color: '#FFFFFF',
    fontFamily: 'Inter-Bold',
    letterSpacing: 0.5,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  menuCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.18,
    shadowRadius: 30,
    elevation: 16,
  },
  menuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 4,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    marginBottom: 6,
  },
  menuAvatarWrap: {
    width: 48,
    height: 48,
  },
  menuAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  menuName: {
    fontSize: 15,
    fontFamily: 'Inter-SemiBold',
    color: '#111827',
  },
  menuEmail: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    color: '#6B7280',
    marginTop: 2,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: 12,
  },
  menuIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuItemText: {
    fontSize: 15,
    fontFamily: 'Inter-SemiBold',
    color: '#111827',
  },
  menuDivider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginVertical: 4,
  },
  editCard: {
    width: '100%',
    maxWidth: 400,
    maxHeight: '88%',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.2,
    shadowRadius: 32,
    elevation: 20,
  },
  editHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  editTitle: {
    fontSize: 20,
    fontFamily: 'Inter-Bold',
    color: '#111827',
    letterSpacing: -0.3,
  },
  avatarPickerWrap: {
    alignItems: 'center',
    marginBottom: 24,
  },
  avatarPicker: {
    position: 'relative',
  },
  avatarLarge: {
    width: 104,
    height: 104,
    borderRadius: 52,
  },
  cameraBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  avatarHint: {
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    color: '#6B7280',
    marginTop: 10,
  },
  removePhotoBtn: {
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  removePhotoText: {
    fontSize: 12,
    fontFamily: 'Inter-SemiBold',
    color: '#EF4444',
  },
  fieldLabel: {
    fontSize: 12,
    fontFamily: 'Inter-SemiBold',
    color: '#6B7280',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  textInput: {
    width: '100%',
    height: 52,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    fontFamily: 'Inter-Medium',
    color: '#111827',
    backgroundColor: '#F9FAFB',
    marginBottom: 20,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    backgroundColor: '#3B82F6',
    borderRadius: 14,
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 6,
  },
  saveBtnText: {
    fontSize: 16,
    fontFamily: 'Inter-SemiBold',
    color: '#FFFFFF',
  },
});
