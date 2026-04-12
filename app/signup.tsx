import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthHeaderBackground } from '@/components/auth/AuthHeaderBackground';
import {
  AUTH_ACCENT,
  AUTH_BORDER,
  AUTH_GREEN,
  AUTH_INPUT_BG,
  AUTH_LABEL,
  AUTH_MUTED_HEADER,
} from '@/components/auth/authTheme';
import { supabase } from '@/supabase';

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string' && m.length > 0) {
      return m;
    }
  }
  return 'Something went wrong. Please try again.';
}

export default function SignUpScreen() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [birthday, setBirthday] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const checkSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        router.replace('/(tabs)');
      }
    };
    void checkSession();
  }, []);

  const upsertProfile = async (userId: string, userEmail: string, displayName: string) => {
    const { error: profileInsertError } = await supabase.from('users').upsert(
      {
        id: userId,
        name: displayName,
        email: userEmail,
      },
      { onConflict: 'id' },
    );
    if (profileInsertError) {
      throw profileInsertError;
    }
  };

  const finishAndGoHome = async (userId: string, userEmail: string, displayName: string) => {
    await upsertProfile(userId, userEmail, displayName);
    router.replace('/(tabs)');
  };

  const handleCreateAccount = async () => {
    const fn = firstName.trim();
    const ln = lastName.trim();
    const em = email.trim();
    if (!fn || !ln || !em || !password) {
      Alert.alert('Missing info', 'Please enter your first name, last name, email, and password.');
      return;
    }

    setIsLoading(true);
    try {
      const displayName = `${fn} ${ln}`.trim();
      const { data, error } = await supabase.auth.signUp({
        email: em,
        password,
        options: {
          data: {
            name: displayName,
            birthday: birthday.trim() || undefined,
          },
        },
      });

      if (error) {
        throw error;
      }

      if (data.session && data.user?.id && data.user.email) {
        await finishAndGoHome(data.user.id, data.user.email, displayName);
        return;
      }

      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: em,
        password,
      });

      if (signInError) {
        Alert.alert(
          'Check your email',
          'We created your account. Confirm your email if required, then sign in from the login screen.',
        );
        return;
      }

      if (signInData.session?.user?.id && signInData.user.email) {
        const metaName =
          typeof signInData.user.user_metadata?.name === 'string' &&
          signInData.user.user_metadata.name.trim()
            ? signInData.user.user_metadata.name.trim()
            : displayName;
        await finishAndGoHome(signInData.user.id, signInData.user.email, metaName);
      }
    } catch (err) {
      Alert.alert('Sign up error', errorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}>
          <AuthHeaderBackground>
            <SafeAreaView edges={['top']} style={styles.headerSafe}>
              <View style={styles.logoRing}>
                <Text style={styles.logoEmoji} accessibilityLabel="Blenders">
                  🍊
                </Text>
              </View>
              <Text style={styles.heroTitle}>Join Blenders</Text>
              <Text style={styles.heroSubtitle}>Create your account and start earning rewards</Text>
            </SafeAreaView>
          </AuthHeaderBackground>

          <View style={styles.sheet}>
            <View style={styles.card}>
              <View style={styles.nameRow}>
                <View style={styles.nameCol}>
                  <Text style={styles.label}>First name</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="First name"
                    placeholderTextColor={AUTH_LABEL}
                    value={firstName}
                    onChangeText={setFirstName}
                    autoCapitalize="words"
                  />
                </View>
                <View style={styles.nameCol}>
                  <Text style={styles.label}>Last name</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Last name"
                    placeholderTextColor={AUTH_LABEL}
                    value={lastName}
                    onChangeText={setLastName}
                    autoCapitalize="words"
                  />
                </View>
              </View>

              <Text style={styles.label}>Email</Text>
              <View style={styles.inputRow}>
                <MaterialIcons name="email" size={20} color={AUTH_LABEL} style={styles.inputIcon} />
                <TextInput
                  style={styles.inputFlex}
                  placeholder="your@email.com"
                  placeholderTextColor={AUTH_LABEL}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={email}
                  onChangeText={setEmail}
                />
              </View>

              <Text style={styles.label}>Password</Text>
              <View style={styles.inputRow}>
                <MaterialIcons name="lock" size={20} color={AUTH_LABEL} style={styles.inputIcon} />
                <TextInput
                  style={styles.inputFlex}
                  placeholder="Password"
                  placeholderTextColor={AUTH_LABEL}
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={setPassword}
                />
                <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={8} style={styles.eyeBtn}>
                  <MaterialIcons
                    name={showPassword ? 'visibility-off' : 'visibility'}
                    size={22}
                    color={AUTH_LABEL}
                  />
                </Pressable>
              </View>

              <Text style={styles.label}>Birthday</Text>
              <View style={styles.inputRow}>
                <MaterialIcons name="calendar-today" size={20} color={AUTH_LABEL} style={styles.inputIcon} />
                <TextInput
                  style={styles.inputFlex}
                  placeholder="MM / DD / YYYY"
                  placeholderTextColor={AUTH_LABEL}
                  value={birthday}
                  onChangeText={setBirthday}
                />
              </View>
              <Text style={styles.helper}>We&apos;ll send you a free smoothie on your birthday</Text>

              <Pressable
                style={[styles.primaryBtn, isLoading && styles.primaryBtnDisabled]}
                onPress={() => void handleCreateAccount()}
                disabled={isLoading}>
                {isLoading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryBtnText}>Create account</Text>
                )}
              </Pressable>

              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or sign up with</Text>
                <View style={styles.dividerLine} />
              </View>

              <View style={styles.socialRow}>
                <Pressable
                  style={styles.socialBtn}
                  onPress={() => Alert.alert('Coming soon', 'Google sign-in will be available soon.')}>
                  <Text style={styles.socialG}>G</Text>
                  <Text style={styles.socialBtnLabel}>Google</Text>
                </Pressable>
                <Pressable
                  style={styles.socialBtn}
                  onPress={() => Alert.alert('Coming soon', 'Apple sign-in will be available soon.')}>
                  <FontAwesome name="apple" size={22} color="#111827" />
                  <Text style={styles.socialBtnLabel}>Apple</Text>
                </Pressable>
              </View>

              <Pressable style={styles.footerLink} onPress={() => router.replace('/login')}>
                <Text style={styles.footerMuted}>
                  Already have an account? <Text style={styles.footerAccent}>Sign in</Text>
                </Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: AUTH_GREEN,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  headerSafe: {
    paddingHorizontal: 8,
    paddingTop: 20,
    paddingBottom: 20,
    alignItems: 'center',
  },
  logoRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  logoEmoji: {
    fontSize: 30,
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 8,
  },
  heroSubtitle: {
    fontSize: 15,
    fontWeight: '400',
    color: AUTH_MUTED_HEADER,
    textAlign: 'center',
    paddingHorizontal: 28,
    lineHeight: 22,
  },
  sheet: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    marginTop: -12,
    paddingTop: 8,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 6,
  },
  card: {
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 36,
  },
  nameRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 4,
  },
  nameCol: {
    flex: 1,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: AUTH_LABEL,
    textAlign: 'center',
    marginBottom: 8,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: AUTH_BORDER,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    fontSize: 16,
    backgroundColor: AUTH_INPUT_BG,
    color: '#111827',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: AUTH_BORDER,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: AUTH_INPUT_BG,
    marginTop: 4,
  },
  inputIcon: {
    marginRight: 8,
  },
  inputFlex: {
    flex: 1,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    fontSize: 16,
    color: '#111827',
  },
  eyeBtn: {
    padding: 4,
  },
  helper: {
    fontSize: 12,
    color: AUTH_LABEL,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  primaryBtn: {
    backgroundColor: AUTH_GREEN,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  primaryBtnDisabled: {
    opacity: 0.85,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 22,
    marginBottom: 16,
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: AUTH_BORDER,
  },
  dividerText: {
    fontSize: 12,
    color: AUTH_LABEL,
  },
  socialRow: {
    flexDirection: 'row',
    gap: 12,
  },
  socialBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: AUTH_BORDER,
    backgroundColor: '#FFFFFF',
  },
  socialG: {
    fontSize: 18,
    fontWeight: '700',
    color: '#4285F4',
  },
  socialBtnLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  footerLink: {
    marginTop: 24,
    alignItems: 'center',
  },
  footerMuted: {
    fontSize: 15,
    color: AUTH_LABEL,
    textAlign: 'center',
  },
  footerAccent: {
    color: AUTH_ACCENT,
    fontWeight: '700',
  },
});
