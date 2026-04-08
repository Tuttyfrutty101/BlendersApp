import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { supabase } from '@/supabase';

type RewardTier = {
  id: string;
  points: number;
  title: string;
  description: string;
};

const REWARD_TIERS: RewardTier[] = [
  {
    id: 'boost',
    points: 75,
    title: 'Free Boost',
    description: 'Add one boost to any drink at no charge.',
  },
  {
    id: 'shot',
    points: 150,
    title: 'Free Wellness Shot',
    description: 'Redeem one cold-pressed wellness shot.',
  },
  {
    id: 'drink',
    points: 200,
    title: 'Free Drink',
    description: 'Any smoothie or juice on the house.',
  },
  {
    id: 'bowl',
    points: 300,
    title: 'Free Bowl',
    description: 'Redeem one bowl of your choice.',
  },
];

export default function RewardsScreen() {
  const [points, setPoints] = useState(0);

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

      const { data: profile, error: fetchError } = await supabase
        .from('users')
        .select('rewards_points')
        .eq('id', user.id)
        .maybeSingle();

      if (fetchError) {
        console.error('Failed to fetch reward balance:', fetchError);
        return;
      }

      setPoints(profile?.rewards_points ?? 0);
    };

    loadRewardsPoints();
  }, []);

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <LinearGradient
            colors={['#006C45', '#0A8B57', '#13A25F']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.balanceCard}>
            <ThemedText style={styles.balanceLabel}>Redeemable balance</ThemedText>
            <View style={styles.balanceRow}>
              <ThemedText style={styles.balanceValue}>{points}</ThemedText>
              <ThemedText style={styles.orangeIcon}>🍊</ThemedText>
            </View>
          </LinearGradient>

          <View style={styles.section}>
            <ThemedText type="title" style={styles.sectionTitle}>
              Redeem Track
            </ThemedText>
            {REWARD_TIERS.map((tier) => {
              const unlocked = points >= tier.points;
              return (
                <View key={tier.id} style={[styles.tierCard, unlocked && styles.tierCardUnlocked]}>
                  <View style={styles.tierPointsPill}>
                    <ThemedText style={styles.tierPointsText}>{tier.points} pts</ThemedText>
                  </View>
                  <View style={styles.tierBody}>
                    <ThemedText style={styles.tierTitle}>{tier.title}</ThemedText>
                    <ThemedText style={styles.tierDescription}>{tier.description}</ThemedText>
                  </View>
                  <ThemedText style={[styles.tierStatus, unlocked && styles.tierStatusUnlocked]}>
                    {unlocked ? 'Unlocked' : 'Locked'}
                  </ThemedText>
                </View>
              );
            })}
          </View>
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
    paddingBottom: 30,
  },
  balanceCard: {
    borderRadius: 18,
    padding: 16,
    minHeight: 230,
    marginBottom: 18,
    shadowColor: '#06543A',
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  balanceLabel: {
    color: '#E8FFF1',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
    textAlign: 'center',
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  balanceValue: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 44,
    lineHeight: 50,
  },
  orangeIcon: {
    fontSize: 32,
    marginLeft: 6,
    marginTop: -2,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 28,
    marginBottom: 2,
    color: '#102019',
  },
  tierCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5ECE6',
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  tierCardUnlocked: {
    borderColor: '#9ED7BB',
    backgroundColor: '#F4FFF9',
  },
  tierPointsPill: {
    backgroundColor: '#FFF4E7',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  tierPointsText: {
    color: '#A55C00',
    fontWeight: '700',
    fontSize: 12,
  },
  tierBody: {
    flex: 1,
  },
  tierTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#16241D',
  },
  tierDescription: {
    marginTop: 2,
    color: '#5A655F',
    fontSize: 13,
    lineHeight: 18,
  },
  tierStatus: {
    color: '#7A8780',
    fontWeight: '700',
    fontSize: 12,
  },
  tierStatusUnlocked: {
    color: '#0A8B57',
  },
});
