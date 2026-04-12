import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { supabase } from '@/supabase';

const GRADIENT = ['#006C45', '#0A8B57', '#13A25F'] as const;

/** Reward row icon circles (Blenders checkout green). */
const REWARD_ICON_GREEN = '#1A9D58';
const REWARD_ICON_GLYPH = '#FFFFFF';

const RING_SIZE = 176;
const RING_STROKE = 11;
const RING_R = (RING_SIZE - RING_STROKE) / 2 - 0.5;
const RING_CX = RING_SIZE / 2;
const RING_CY = RING_SIZE / 2;
const RING_CIRC = 2 * Math.PI * RING_R;

type AvailableReward = {
  id: string;
  title: string;
  points: number;
  icon: 'cup12' | 'cup24' | 'bowl';
};

const AVAILABLE_REWARDS: AvailableReward[] = [
  { id: 's12', title: 'Free 12 oz smoothie', points: 200, icon: 'cup12' },
  { id: 's24', title: 'Free 24 oz smoothie', points: 350, icon: 'cup24' },
  { id: 'bowl', title: 'Free acai bowl', points: 450, icon: 'bowl' },
];

/** Ionicons / MaterialIcons names from bundled glyph maps (`rice-bowl` must use hyphen, not underscore). */
function RewardRowIcon({ type }: { type: AvailableReward['icon'] }) {
  const size = 24;
  if (type === 'cup12' || type === 'cup24') {
    return <Ionicons name="pint" size={size} color={REWARD_ICON_GLYPH} />;
  }
  return <MaterialIcons name="rice-bowl" size={size} color={REWARD_ICON_GLYPH} />;
}

function PointsRing({ progress }: { progress: number }) {
  const pct = Math.min(1, Math.max(0, progress));
  const offset = RING_CIRC * (1 - pct);
  return (
    <Svg width={RING_SIZE} height={RING_SIZE}>
      <Circle
        cx={RING_CX}
        cy={RING_CY}
        r={RING_R}
        fill="none"
        stroke="rgba(255,255,255,0.22)"
        strokeWidth={RING_STROKE}
      />
      <G transform={`rotate(-90 ${RING_CX} ${RING_CY})`}>
        <Circle
          cx={RING_CX}
          cy={RING_CY}
          r={RING_R}
          fill="none"
          stroke="#FF9D2E"
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={RING_CIRC}
          strokeDashoffset={offset}
        />
      </G>
    </Svg>
  );
}

function HeroDecorCircles() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[styles.decorCircle, { top: -40, left: -30, width: 140, height: 140 }]} />
      <View style={[styles.decorCircle, { top: 20, right: -50, width: 180, height: 180 }]} />
      <View style={[styles.decorCircle, { bottom: -20, left: 40, width: 120, height: 120 }]} />
      <View style={[styles.decorCircle, { bottom: 40, right: -20, width: 100, height: 100 }]} />
    </View>
  );
}

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

  const { ringProgress, statusLine } = useMemo(() => {
    const next = AVAILABLE_REWARDS.find((r) => points < r.points);
    if (!next) {
      return {
        ringProgress: 1,
        statusLine: "You've unlocked every reward!",
      };
    }
    const need = next.points - points;
    let label = 'reward';
    if (next.id === 's12') label = 'free drink';
    else if (next.id === 's24') label = 'free 24 oz smoothie';
    else if (next.id === 'bowl') label = 'acai bowl';
    const line = `${need} points to your next ${label}`;
    const progress = next.points > 0 ? points / next.points : 0;
    return { ringProgress: progress, statusLine: line };
  }, [points]);

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <LinearGradient colors={[...GRADIENT]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
            <HeroDecorCircles />

            <View style={styles.heroHeaderRow}>
              <Text style={styles.heroTitle}>Rewards</Text>
              <View style={styles.tierPill}>
                <View style={styles.tierDot} />
                <Text style={styles.tierPillText}>Green tier</Text>
              </View>
            </View>

            <View style={styles.ringBlock}>
              <PointsRing progress={ringProgress} />
              <View style={styles.ringCenterOverlay} pointerEvents="none">
                <Text style={styles.ringPointsValue}>{points}</Text>
                <Text style={styles.ringPointsLabel}>points</Text>
              </View>
            </View>

            <Text style={styles.heroStatus}>{statusLine}</Text>
          </LinearGradient>

          <View style={styles.infoCardsRow}>
            <View style={styles.infoCard}>
              <View style={[styles.infoGlyph, styles.infoGlyphGreen]}>
                <Text style={styles.infoGlyphNum}>1</Text>
              </View>
              <Text style={styles.infoCardBig}>$1</Text>
              <Text style={styles.infoCardSmall}>= 1 point</Text>
            </View>
            <View style={styles.infoCard}>
              <View style={[styles.infoGlyph, styles.infoGlyphOrange]}>
                <MaterialIcons name="star" size={18} color="#FF8A00" />
              </View>
              <Text style={styles.infoCardBig}>200</Text>
              <Text style={styles.infoCardSmall}>= free drink</Text>
            </View>
            <View style={styles.infoCard}>
              <View style={[styles.infoGlyph, styles.infoGlyphGreen]}>
                <MaterialIcons name="check" size={20} color="#0A8B57" />
              </View>
              <Text style={styles.infoCardBig}>2x</Text>
              <Text style={styles.infoCardSmall}>on Tuesdays</Text>
            </View>
          </View>

          <ThemedText type="title" style={styles.availableHeading}>
            Available rewards
          </ThemedText>

          <View style={styles.rewardsList}>
            {AVAILABLE_REWARDS.map((reward) => {
              const unlocked = points >= reward.points;
              const needMore = Math.max(0, reward.points - points);
              return (
                <View key={reward.id} style={styles.rewardRow}>
                  <View style={styles.rewardIconCircle}>
                    <RewardRowIcon type={reward.icon} />
                  </View>
                  <View style={styles.rewardRowBody}>
                    <Text style={styles.rewardRowTitle}>{reward.title}</Text>
                    <Text style={styles.rewardRowMeta}>
                      {reward.points} points
                      {!unlocked ? ` · You need ${needMore} more` : ' · Unlocked'}
                    </Text>
                  </View>
                  <View style={[styles.lockPill, unlocked && styles.lockPillUnlocked]}>
                    <Text style={[styles.lockPillText, unlocked && styles.lockPillTextUnlocked]}>
                      {unlocked ? 'Ready' : 'Locked'}
                    </Text>
                  </View>
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
  scrollContent: {
    paddingBottom: 36,
  },
  hero: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 28,
    overflow: 'hidden',
  },
  decorCircle: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  heroHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    zIndex: 1,
  },
  heroTitle: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  tierPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.22)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  tierDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF8A00',
  },
  tierPillText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  ringBlock: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 14,
    width: RING_SIZE,
    height: RING_SIZE,
    zIndex: 1,
  },
  ringCenterOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringPointsValue: {
    color: '#FFFFFF',
    fontSize: 44,
    fontWeight: '800',
    letterSpacing: -1,
  },
  ringPointsLabel: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 15,
    fontWeight: '600',
    marginTop: 2,
  },
  heroStatus: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 21,
    paddingHorizontal: 12,
    zIndex: 1,
  },
  infoCardsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    marginTop: 4,
    marginBottom: 22,
  },
  infoCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E8EEE9',
    shadowColor: '#163126',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  infoGlyph: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  infoGlyphGreen: {
    backgroundColor: 'rgba(10,139,87,0.14)',
  },
  infoGlyphOrange: {
    backgroundColor: 'rgba(255,138,0,0.18)',
  },
  infoGlyphNum: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0A8B57',
  },
  infoCardBig: {
    fontSize: 17,
    fontWeight: '800',
    color: '#102019',
  },
  infoCardSmall: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '600',
    color: '#6B7872',
    textAlign: 'center',
  },
  availableHeading: {
    fontSize: 22,
    fontWeight: '800',
    color: '#102019',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  rewardsList: {
    paddingHorizontal: 16,
    gap: 10,
  },
  rewardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#E8EEE9',
    shadowColor: '#163126',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  rewardIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: REWARD_ICON_GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rewardRowBody: {
    flex: 1,
    minWidth: 0,
  },
  rewardRowTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#102019',
  },
  rewardRowMeta: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '500',
    color: '#6B7872',
  },
  lockPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#C5D0CA',
  },
  lockPillUnlocked: {
    backgroundColor: 'rgba(10,139,87,0.18)',
  },
  lockPillText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  lockPillTextUnlocked: {
    color: '#0A8B57',
  },
});
