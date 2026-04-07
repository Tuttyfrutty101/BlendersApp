import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/supabase';

const MENU_ITEMS = [
  'Payment Methods',
  'Rewards Balance',
  'Order History',
  'Notifications',
  'Sign Out',
];

export default function AccountScreen() {
  const [name, setName] = useState('User');
  const [email, setEmail] = useState('');

  useEffect(() => {
    const loadProfile = async () => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        console.error('Failed to get current user:', userError);
        return;
      }

      setEmail(user.email ?? '');

      const fallbackName =
        typeof user.user_metadata?.name === 'string' && user.user_metadata.name.trim()
          ? user.user_metadata.name.trim()
          : 'User';

      const { data: profile, error: profileError } = await supabase
        .from('users')
        .select('name')
        .eq('id', user.id)
        .maybeSingle();

      if (profileError) {
        console.error('Failed to load profile name:', profileError);
        setName(fallbackName);
        return;
      }

      setName(profile?.name || fallbackName);
    };

    loadProfile();
  }, []);

  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  const handleMenuPress = async (item: string) => {
    if (item !== 'Sign Out') return;

    const { error } = await supabase.auth.signOut();

    if (error) {
      Alert.alert('Sign out failed', error.message);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.profileSection}>
        <View style={styles.avatar}>
          <ThemedText type="subtitle" style={styles.avatarText}>
            {initials || 'U'}
          </ThemedText>
        </View>
        <View style={styles.profileInfo}>
          <ThemedText type="title" style={styles.name}>
            {name}
          </ThemedText>
          <ThemedText style={styles.email}>{email || 'No email'}</ThemedText>
        </View>
      </View>

      <View style={styles.menuList}>
        {MENU_ITEMS.map((item, index) => (
          <Pressable
            key={item}
            style={[styles.menuItem, index !== MENU_ITEMS.length - 1 && styles.menuItemBorder]}
            onPress={() => handleMenuPress(item)}>
            <ThemedText type="defaultSemiBold">{item}</ThemedText>
            <IconSymbol name="chevron.right" size={18} color="#8A8A8E" />
          </Pressable>
        ))}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
    backgroundColor: '#FFFFFF',
  },
  profileSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 28,
  },
  avatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#D9F2E6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#0F9D58',
    fontWeight: '700',
  },
  profileInfo: {
    marginLeft: 14,
  },
  name: {
    fontSize: 22,
  },
  email: {
    marginTop: 4,
    color: '#6B7280',
  },
  menuList: {
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#ECECEC',
    backgroundColor: '#FFFFFF',
  },
  menuItem: {
    paddingVertical: 16,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  menuItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#F1F1F1',
  },
});

