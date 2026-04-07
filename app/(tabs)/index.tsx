import { useEffect, useState } from 'react';
import { StyleSheet, View, ScrollView } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { supabase } from '@/supabase';

const NEXT_REWARD = 200;
type MenuItem = {
  id: string;
  name: string;
  description: string;
};

export default function HomeScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const [points, setPoints] = useState(0);
  const [displayName, setDisplayName] = useState('there');
  const [featuredItems, setFeaturedItems] = useState<MenuItem[]>([]);
  const [popularItems, setPopularItems] = useState<MenuItem[]>([]);

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
    const loadMenuSections = async () => {
      const [{ data: featured, error: featuredError }, { data: popular, error: popularError }] =
        await Promise.all([
          supabase
            .from('menu_items')
            .select('id, name, description')
            .eq('is_featured', true)
            .order('name'),
          supabase
            .from('menu_items')
            .select('id, name, description')
            .eq('is_popular', true)
            .order('name'),
        ]);

      if (featuredError) {
        console.error('Failed to load featured items:', featuredError);
      } else {
        setFeaturedItems(featured ?? []);
      }

      if (popularError) {
        console.error('Failed to load popular items:', popularError);
      } else {
        setPopularItems(popular ?? []);
      }
    };

    loadMenuSections();
  }, []);

  const progress = points / NEXT_REWARD;
  const pointsToNextReward = Math.max(NEXT_REWARD - points, 0);

  return (
    <ThemedView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Welcome */}
        <ThemedText type="title" style={styles.welcomeText}>
          Hey {displayName} 👋
        </ThemedText>
        <ThemedText type="default" style={styles.subtitle}>
          Ready for a fresh Blenders run?
        </ThemedText>

        {/* Rewards card */}
        <View style={[styles.rewardsCard, { backgroundColor: palette.tint }]}>
          <ThemedText type="subtitle" style={styles.rewardsLabel}>
            Rewards
          </ThemedText>
          <ThemedText type="title" style={styles.pointsText}>
            {points} points
          </ThemedText>
          <ThemedText type="default" style={styles.rewardSubtext}>
            {pointsToNextReward} points until your next reward at {NEXT_REWARD}.
          </ThemedText>

          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${Math.min(progress, 1) * 100}%`,
                  backgroundColor: '#FF8A00',
                },
              ]}
            />
          </View>
        </View>

        {/* Featured */}
        <Section title="Featured">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.horizontalList}>
            {featuredItems.map((smoothie) => (
              <SmoothieCard
                key={smoothie.id}
                name={smoothie.name}
                ingredients={smoothie.description}
              />
            ))}
          </ScrollView>
        </Section>

        {/* Popular */}
        <Section title="Popular">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.horizontalList}>
            {popularItems.map((smoothie) => (
              <SmoothieCard
                key={smoothie.id}
                name={smoothie.name}
                ingredients={smoothie.description}
              />
            ))}
          </ScrollView>
        </Section>
      </ScrollView>
    </ThemedView>
  );
}

type SectionProps = {
  title: string;
  children: React.ReactNode;
};

function Section({ title, children }: SectionProps) {
  return (
    <View style={styles.section}>
      <ThemedText type="subtitle" style={styles.sectionTitle}>
        {title}
      </ThemedText>
      {children}
    </View>
  );
}

type SmoothieCardProps = {
  name: string;
  ingredients: string;
};

function SmoothieCard({ name, ingredients }: SmoothieCardProps) {
  return (
    <ThemedView style={styles.smoothieCard}>
      <ThemedText type="subtitle" style={styles.smoothieName}>
        {name}
      </ThemedText>
      <ThemedText type="default" style={styles.smoothieIngredients}>
        {ingredients}
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 32,
  },
  welcomeText: {
    marginBottom: 4,
  },
  subtitle: {
    marginBottom: 20,
  },
  rewardsCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
  },
  rewardsLabel: {
    color: '#FFFFFF',
    marginBottom: 4,
  },
  pointsText: {
    color: '#FFFFFF',
    marginBottom: 4,
  },
  rewardSubtext: {
    color: '#F1FFF8',
    marginBottom: 12,
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    marginBottom: 12,
  },
  horizontalList: {
    paddingRight: 8,
  },
  smoothieCard: {
    width: 200,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    marginRight: 12,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  smoothieName: {
    marginBottom: 4,
  },
  smoothieIngredients: {
    fontSize: 13,
  },
});
