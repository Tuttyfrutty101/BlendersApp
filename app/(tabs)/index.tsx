import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { supabase } from '@/supabase';

const NEXT_REWARD = 200;

type FeaturedCard = {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
};

export default function HomeScreen() {
  const router = useRouter();
  const [points, setPoints] = useState(0);
  const [displayName, setDisplayName] = useState('there');
  const [featuredCards, setFeaturedCards] = useState<FeaturedCard[]>([]);

  useEffect(() => {
    const loadRewardsPoints = async () => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        console.error('Failed to get authenticated user:', userError);
        return;
      }

      const authName =
        typeof user.user_metadata?.name === 'string' ? user.user_metadata.name.trim() : '';
      if (authName) {
        setDisplayName(authName);
      }

      const { data: profile, error: fetchError } = await supabase
        .from('users')
        .select('name, rewards_points')
        .eq('id', user.id)
        .maybeSingle();

      if (fetchError) {
        console.error('Failed to fetch user rewards points:', fetchError);
        return;
      }

      if (profile?.name) {
        setDisplayName(profile.name);
      }

      setPoints(profile?.rewards_points ?? 0);
    };

    loadRewardsPoints();
  }, []);

  useEffect(() => {
    const loadFeaturedCards = async () => {
      const { data, error } = await supabase
        .from('featured')
        .select('id, title, description, image_url')
        .order('display_order', { ascending: true });

      if (error) {
        console.error('Failed to load featured cards:', error);
        setFeaturedCards([]);
        return;
      }

      setFeaturedCards((data as FeaturedCard[]) ?? []);
    };

    loadFeaturedCards();
  }, []);

  const progress = points / NEXT_REWARD;
  const pointsToNextReward = Math.max(NEXT_REWARD - points, 0);

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.topRow}>
            <Pressable style={styles.storesButton} onPress={() => router.push('/order')}>
              <MaterialIcons name="location-on" size={18} color="#5A6B5F" />
              <ThemedText style={styles.storesButtonText}>Stores</ThemedText>
            </Pressable>
            <View style={styles.headerActions}>
              <Pressable style={styles.iconButton}>
                <MaterialIcons name="receipt-long" size={20} color="#5A6B5F" />
              </Pressable>
              <Pressable style={styles.iconButton} onPress={() => router.push('/account')}>
                <MaterialIcons name="account-circle" size={22} color="#5A6B5F" />
              </Pressable>
            </View>
          </View>

          <ThemedText type="title" style={styles.welcomeText}>
            Start the day with your favorite, {displayName}
          </ThemedText>

          <Pressable onPress={() => router.push('/rewards')}>
            <LinearGradient
              colors={['#006C45', '#0A8B57', '#13A25F']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.rewardsCard}>
              <View style={styles.rewardsTopRow}>
                <ThemedText style={styles.rewardsLabel}>Reward balance</ThemedText>
                <ThemedText style={styles.rewardsStatus}>GREEN STATUS</ThemedText>
              </View>
              <View style={styles.pointsRow}>
                <ThemedText style={styles.pointsValue}>{points}</ThemedText>
                <ThemedText style={styles.pointsOrange}>🍊</ThemedText>
              </View>
              <ThemedText style={styles.rewardSubtext}>
                {pointsToNextReward} points until your next reward at {NEXT_REWARD}.
              </ThemedText>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.min(progress, 1) * 100}%` }]} />
              </View>
            </LinearGradient>
          </Pressable>

          {featuredCards.map((card) => (
            <View key={card.id} style={styles.heroCard}>
              {card.image_url ? (
                <Image source={{ uri: card.image_url }} style={styles.heroImage} contentFit="cover" />
              ) : (
                <View style={styles.heroImage} />
              )}
              <View style={styles.heroBody}>
                <ThemedText style={styles.heroTitle}>{card.title}</ThemedText>
                {card.description ? (
                  <ThemedText style={styles.heroCopy}>{card.description}</ThemedText>
                ) : null}
              </View>
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F8FAF8',
  },
  safeArea: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 36,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  storesButton: {
    height: 38,
    borderRadius: 19,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5ECE6',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  storesButtonText: {
    color: '#30473A',
    fontWeight: '700',
    fontSize: 14,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5ECE6',
  },
  welcomeText: {
    fontSize: 38,
    lineHeight: 42,
    fontWeight: '800',
    color: '#0A1711',
    marginBottom: 14,
  },
  rewardsCard: {
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#06543A',
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  rewardsTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rewardsLabel: {
    color: '#E8FFF1',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  rewardsStatus: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  pointsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    marginBottom: 6,
  },
  pointsValue: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 42,
    lineHeight: 48,
  },
  pointsOrange: {
    fontSize: 28,
    marginLeft: 4,
    marginTop: -2,
  },
  rewardSubtext: {
    color: '#D9FEE6',
    fontSize: 13,
    marginBottom: 12,
  },
  progressTrack: {
    height: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.28)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#FF9D2E',
  },
  heroCard: {
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8EEE9',
    marginBottom: 20,
    shadowColor: '#163126',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  heroImage: {
    height: 165,
    backgroundColor: '#FFB562',
  },
  heroBody: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  heroTitle: {
    fontSize: 33,
    lineHeight: 37,
    fontWeight: '800',
    color: '#141414',
    marginBottom: 4,
  },
  heroCopy: {
    fontSize: 15,
    lineHeight: 21,
    color: '#4A534F',
  },
});
