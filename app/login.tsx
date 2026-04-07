import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { supabase } from '@/supabase';

export default function LoginScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
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

    checkSession();
  }, []);

  const handleAuth = async () => {
    if (!email.trim() || !password.trim() || (isSignUp && !name.trim())) {
      Alert.alert(
        'Missing info',
        isSignUp
          ? 'Please enter your name, email, and password.'
          : 'Please enter both email and password.',
      );
      return;
    }

    setIsLoading(true);

    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              name: name.trim(),
            },
          },
        });

        if (error) throw error;

        if (data.user?.id && data.user.email) {
          const userName =
            typeof data.user.user_metadata?.name === 'string' && data.user.user_metadata.name.trim()
              ? data.user.user_metadata.name.trim()
              : name.trim();

          const { error: profileInsertError } = await supabase.from('users').upsert(
            {
              id: data.user.id,
              name: userName,
              email: data.user.email,
            },
            { onConflict: 'id' },
          );

          if (profileInsertError) {
            throw profileInsertError;
          }
        }

        Alert.alert(
          'Account created',
          'Sign up successful. If email confirmation is enabled, verify your email first.',
        );
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (error) throw error;

        router.replace('/(tabs)');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Authentication failed.';
      Alert.alert('Auth error', message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.card}>
        <ThemedText type="title" style={styles.title}>
          {isSignUp ? 'Create Account' : 'Welcome Back'}
        </ThemedText>
        <ThemedText style={styles.subtitle}>
          {isSignUp ? 'Sign up to start ordering.' : 'Log in to continue to Blenders.'}
        </ThemedText>

        {isSignUp ? (
          <TextInput
            style={styles.input}
            placeholder="Full name"
            autoCapitalize="words"
            value={name}
            onChangeText={setName}
          />
        ) : null}

        <TextInput
          style={styles.input}
          placeholder="Email"
          keyboardType="email-address"
          autoCapitalize="none"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        <Pressable style={styles.primaryButton} onPress={handleAuth} disabled={isLoading}>
          <ThemedText style={styles.primaryButtonText}>
            {isLoading ? 'Please wait...' : isSignUp ? 'Sign Up' : 'Log In'}
          </ThemedText>
        </Pressable>

        <Pressable onPress={() => setIsSignUp((prev) => !prev)}>
          <ThemedText style={styles.linkText}>
            {isSignUp ? 'Already have an account? Log In' : "Don't have an account? Sign Up"}
          </ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    backgroundColor: '#F7FAF8',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  title: {
    marginBottom: 4,
  },
  subtitle: {
    marginBottom: 14,
    color: '#6B7280',
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    backgroundColor: '#FFFFFF',
  },
  primaryButton: {
    backgroundColor: '#0F9D58',
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  linkText: {
    marginTop: 12,
    color: '#0F9D58',
    textAlign: 'center',
    fontWeight: '600',
  },
});

