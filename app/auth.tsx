import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { signInWithEmail, signUpWithEmail, resetPassword } from '@/utils/auth';

type Mode = 'login' | 'register' | 'forgot';

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const emailValid = /^\S+@\S+\.\S+$/.test(email.trim());
  const passwordValid = password.length >= 6;
  const passwordsMatch = password === confirmPassword;

  const canSubmit =
    mode === 'forgot'
      ? emailValid
      : mode === 'login'
        ? emailValid && passwordValid
        : emailValid && passwordValid && passwordsMatch;

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await signInWithEmail(email, password);
      } else if (mode === 'register') {
        await signUpWithEmail(email, password);
      } else {
        await resetPassword(email);
        setInfo('Password reset link sent. Check your inbox.');
      }
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setInfo(null);
    setConfirmPassword('');
    if (next === 'forgot') setPassword('');
  };

  const title =
    mode === 'login' ? 'Welcome back' : mode === 'register' ? 'Create account' : 'Reset password';
  const subtitle =
    mode === 'login'
      ? 'Sign in to continue tracking your drives'
      : mode === 'register'
        ? 'Join Range Pilot in a few seconds'
        : 'We will send you a reset link';
  const cta =
    mode === 'login' ? 'Sign In' : mode === 'register' ? 'Create Account' : 'Send Reset Link';

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brandRow}>
          <View style={styles.brandDot} />
          <Text style={styles.brandText}>RANGE PILOT</Text>
        </View>

        <View style={styles.iconWrap}>
          <Image
            source={require('../assets/images/range-pilot-icon.webp')}
            style={styles.logoImage}
            resizeMode="contain"
          />
        </View>

        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            placeholder="you@example.com"
            placeholderTextColor="#6B7280"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            returnKeyType="next"
          />

          {mode !== 'forgot' && (
            <>
              <Text style={[styles.label, { marginTop: 16 }]}>Password</Text>
              <TextInput
                style={styles.input}
                placeholder="At least 6 characters"
                placeholderTextColor="#6B7280"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                returnKeyType={mode === 'register' ? 'next' : 'done'}
                onSubmitEditing={mode === 'login' ? handleSubmit : undefined}
              />
            </>
          )}

          {mode === 'register' && (
            <>
              <Text style={[styles.label, { marginTop: 16 }]}>Confirm password</Text>
              <TextInput
                style={styles.input}
                placeholder="Re-enter your password"
                placeholderTextColor="#6B7280"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
              />
              {confirmPassword.length > 0 && !passwordsMatch && (
                <Text style={styles.fieldError}>Passwords don't match</Text>
              )}
            </>
          )}

          {error && <Text style={styles.errorText}>{error}</Text>}
          {info && <Text style={styles.infoText}>{info}</Text>}

          <TouchableOpacity
            style={[styles.primaryBtn, (!canSubmit || submitting) && styles.primaryBtnDisabled]}
            onPress={handleSubmit}
            activeOpacity={0.85}
            disabled={!canSubmit || submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryBtnText}>{cta}</Text>
            )}
          </TouchableOpacity>

          {mode === 'login' && (
            <TouchableOpacity onPress={() => switchMode('forgot')} style={styles.linkRow}>
              <Text style={styles.linkText}>Forgot password?</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.switchRow}>
          {mode === 'login' && (
            <Text style={styles.switchText}>
              New user?{' '}
              <Text style={styles.switchLink} onPress={() => switchMode('register')}>
                Register
              </Text>
            </Text>
          )}
          {mode === 'register' && (
            <Text style={styles.switchText}>
              Already have an account?{' '}
              <Text style={styles.switchLink} onPress={() => switchMode('login')}>
                Login
              </Text>
            </Text>
          )}
          {mode === 'forgot' && (
            <Text style={styles.switchText}>
              Remembered it?{' '}
              <Text style={styles.switchLink} onPress={() => switchMode('login')}>
                Back to login
              </Text>
            </Text>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0B0F14',
  },
  scroll: {
    paddingHorizontal: 24,
    flexGrow: 1,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 28,
  },
  brandDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#3B82F6',
  },
  brandText: {
    fontSize: 11,
    fontFamily: 'Inter-Bold',
    color: '#9CA3AF',
    letterSpacing: 2,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#1F2937',
    overflow: 'hidden',
  },
  logoImage: {
    width: 48,
    height: 48,
  },
  title: {
    fontSize: 26,
    fontFamily: 'Inter-Bold',
    color: '#F9FAFB',
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 26,
  },
  card: {
    backgroundColor: '#111827',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  label: {
    fontSize: 12,
    fontFamily: 'Inter-SemiBold',
    color: '#9CA3AF',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  input: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#1F2937',
    backgroundColor: '#0B0F14',
    paddingHorizontal: 16,
    fontSize: 16,
    fontFamily: 'Inter-Regular',
    color: '#F9FAFB',
  },
  fieldError: {
    marginTop: 8,
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    color: '#F97316',
  },
  errorText: {
    marginTop: 14,
    fontSize: 13,
    fontFamily: 'Inter-Medium',
    color: '#F87171',
    textAlign: 'center',
  },
  infoText: {
    marginTop: 14,
    fontSize: 13,
    fontFamily: 'Inter-Medium',
    color: '#10B981',
    textAlign: 'center',
  },
  primaryBtn: {
    marginTop: 20,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnDisabled: {
    opacity: 0.5,
  },
  primaryBtnText: {
    fontSize: 16,
    fontFamily: 'Inter-SemiBold',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  linkRow: {
    marginTop: 14,
    alignItems: 'center',
  },
  linkText: {
    fontSize: 13,
    fontFamily: 'Inter-Medium',
    color: '#3B82F6',
  },
  switchRow: {
    marginTop: 22,
    alignItems: 'center',
  },
  switchText: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: '#9CA3AF',
  },
  switchLink: {
    color: '#3B82F6',
    fontFamily: 'Inter-SemiBold',
  },
});
