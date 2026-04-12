import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useState } from 'react';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { queueCustomizeMenuItemFromHome } from '@/lib/pendingCustomizeFromHome';
import { supabase } from '@/supabase';
import type { OrderItemJson } from '@/types/order';

const NEXT_REWARD = 200;
/** Matches receipts “active” orders (not completed). */
const ACTIVE_ORDER_STATUSES = ['placed', 'preparing', 'ready'] as const;
const ACTIVE_ORDER_DOT = '#1A9D58';

type FeaturedCard = {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  menu_item_id: string;
};

function timeOfDayGreeting(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Good morning';
  if (h >= 12 && h < 17) return 'Good afternoon';
  if (h >= 17 && h < 22) return 'Good evening';
  return 'Good night';
}

function orderLineDedupeKey(line: OrderItemJson): string {
  if (line.menu_item_id) return `${line.menu_item_id}:${line.size}`;
  return `${line.name}:${line.size}`;
}

const ORDER_AGAIN_MAX = 16;
const ORDER_AGAIN_IMG_PLACEHOLDER = '#E5E7EB';

export default function HomeScreen() {
  const router = useRouter();
  const [points, setPoints] = useState(0);
  const [displayName, setDisplayName] = useState('there');
  const [featuredCards, setFeaturedCards] = useState<FeaturedCard[]>([]);
  const [hasActiveOrder, setHasActiveOrder] = useState(false);
  const [orderAgainItems, setOrderAgainItems] = useState<OrderItemJson[]>([]);

  const loadOrderAgainItems = useCallback(async () => {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      setOrderAgainItems([]);
      return;
    }

    const { data: orders, error } = await supabase
      .from('orders')
      .select('items, created_at')
      .eq('user_id', user.id)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(30);

    if (error) {
      console.error('Failed to load order history for Order again:', error);
      setOrderAgainItems([]);
      return;
    }

    const seen = new Set<string>();
    const collected: OrderItemJson[] = [];
    for (const row of orders ?? []) {
      const raw = row.items;
      const items = Array.isArray(raw) ? (raw as OrderItemJson[]) : [];
      for (const line of items) {
        const key = orderLineDedupeKey(line);
        if (seen.has(key)) continue;
        seen.add(key);
        collected.push({ ...line });
        if (collected.length >= ORDER_AGAIN_MAX) break;
      }
      if (collected.length >= ORDER_AGAIN_MAX) break;
    }

    const missingIds = new Set<string>();
    for (const line of collected) {
      const mid = line.menu_item_id;
      if (mid && !(line.image_url && String(line.image_url).trim())) {
        missingIds.add(mid);
      }
    }
    if (missingIds.size > 0) {
      const { data: menuRows } = await supabase
        .from('menu_items')
        .select('id, image_url')
        .in('id', [...missingIds]);
      const urlByMenuId = new Map(
        (menuRows ?? []).map((r: { id: string; image_url: string | null }) => [r.id, r.image_url]),
      );
      for (let i = 0; i < collected.length; i++) {
        const line = collected[i];
        const mid = line.menu_item_id;
        if (!mid || (line.image_url && String(line.image_url).trim())) continue;
        const u = urlByMenuId.get(mid);
        if (u) collected[i] = { ...line, image_url: u };
      }
    }

    setOrderAgainItems(collected);
  }, []);

  const loadActiveOrderBadge = useCallback(async () => {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      setHasActiveOrder(false);
      return;
    }
    const { data, error } = await supabase
      .from('orders')
      .select('id')
      .eq('user_id', user.id)
      .in('status', [...ACTIVE_ORDER_STATUSES])
      .limit(1);
    if (error) {
      console.error('Failed to check active orders:', error);
      setHasActiveOrder(false);
      return;
    }
    setHasActiveOrder((data?.length ?? 0) > 0);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadActiveOrderBadge();
      void loadOrderAgainItems();
    }, [loadActiveOrderBadge, loadOrderAgainItems]),
  );

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
        .select('id, title, description, image_url, menu_item_id')
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
  const greeting = timeOfDayGreeting();

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={[styles.horizontalInset, styles.topRow]}>
            <View style={styles.headerWelcome}>
              <ThemedText style={styles.headerGreeting}>{greeting}</ThemedText>
              <ThemedText style={styles.headerName} numberOfLines={1}>
                {displayName}
              </ThemedText>
            </View>
            <View style={styles.headerActions}>
              <View style={styles.receiptButtonWrap}>
                <Pressable style={styles.iconButton} onPress={() => router.push('/receipts')}>
                  <MaterialIcons name="receipt-long" size={20} color="#5A6B5F" />
                </Pressable>
                {hasActiveOrder ? <View style={styles.activeOrderDot} /> : null}
              </View>
              <Pressable style={styles.iconButton} onPress={() => router.push('/account')}>
                <MaterialIcons name="account-circle" size={22} color="#5A6B5F" />
              </Pressable>
            </View>
          </View>

          <View style={styles.horizontalInset}>
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
                <MaterialIcons name="star" size={30} color="#FF8A00" style={styles.pointsStarIcon} />
              </View>
              <ThemedText style={styles.rewardSubtext}>
                {pointsToNextReward} points until your next reward at {NEXT_REWARD}.
              </ThemedText>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.min(progress, 1) * 100}%` }]} />
              </View>
            </LinearGradient>
            </Pressable>
          </View>

          {orderAgainItems.length > 0 ? (
            <View style={styles.orderAgainSection}>
              <ThemedText style={[styles.sectionTitleLeft, styles.horizontalInset]}>Order again</ThemedText>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                nestedScrollEnabled
                style={styles.orderAgainScroll}
                contentContainerStyle={styles.orderAgainScrollContent}>
                {orderAgainItems.map((line) => (
                  <Pressable
                    key={orderLineDedupeKey(line)}
                    style={styles.orderAgainCard}
                    onPress={() => {
                      if (line.menu_item_id) {
                        queueCustomizeMenuItemFromHome(line.menu_item_id);
                      }
                      router.push('/order');
                    }}>
                    <View style={styles.orderAgainImageWrap}>
                      {line.image_url ? (
                        <Image
                          source={{ uri: line.image_url }}
                          style={styles.orderAgainImage}
                          contentFit="cover"
                        />
                      ) : (
                        <View style={[styles.orderAgainImage, styles.orderAgainImagePh]} />
                      )}
                    </View>
                    <Text style={styles.orderAgainName} numberOfLines={2}>
                      {line.name}
                    </Text>
                    <Text style={styles.orderAgainMeta}>{line.size} oz</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}

          {featuredCards.length > 0 ? (
            <ThemedText style={[styles.sectionTitleLeft, styles.horizontalInset]}>Featured</ThemedText>
          ) : null}

          {featuredCards.map((card) => (
            <Pressable
              key={card.id}
              style={[styles.horizontalInset, styles.heroCardWrap]}
              onPress={() => {
                queueCustomizeMenuItemFromHome(card.menu_item_id);
                router.push('/order');
              }}>
              <View style={styles.heroCard}>
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
            </Pressable>
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
    paddingTop: 8,
    paddingBottom: 36,
  },
  horizontalInset: {
    paddingHorizontal: 20,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  headerWelcome: {
    flex: 1,
    marginRight: 10,
    minWidth: 0,
    justifyContent: 'center',
  },
  headerGreeting: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
    letterSpacing: 0.2,
    marginBottom: 2,
  },
  headerName: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0A1711',
    letterSpacing: -0.3,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
    flexShrink: 0,
  },
  receiptButtonWrap: {
    position: 'relative',
    overflow: 'visible',
    /** Room so the badge can sit past the button edge without crowding the account icon */
    marginRight: 4,
  },
  activeOrderDot: {
    position: 'absolute',
    /** Straddles the white circle: less offset than half the box corner so ~half the dot reads on the receipt icon */
    top: -4,
    right: -4,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: ACTIVE_ORDER_DOT,
    borderWidth: 2,
    borderColor: '#FFFFFF',
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
  pointsStarIcon: {
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
  sectionTitleLeft: {
    fontSize: 20,
    fontWeight: '600',
    color: '#374151',
    letterSpacing: -0.2,
    marginBottom: 12,
  },
  orderAgainSection: {
    marginBottom: 14,
  },
  orderAgainScroll: {
    width: '100%',
  },
  orderAgainScrollContent: {
    flexDirection: 'row',
    paddingLeft: 20,
    paddingRight: 20,
  },
  orderAgainCard: {
    width: 118,
    marginRight: 12,
    alignItems: 'center',
  },
  orderAgainImageWrap: {
    width: 100,
    height: 100,
    borderRadius: 50,
    overflow: 'hidden',
    marginBottom: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8EEE9',
    alignSelf: 'center',
  },
  orderAgainImage: {
    width: 100,
    height: 100,
    backgroundColor: ORDER_AGAIN_IMG_PLACEHOLDER,
  },
  orderAgainImagePh: {
    backgroundColor: ORDER_AGAIN_IMG_PLACEHOLDER,
  },
  orderAgainName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1F2937',
    lineHeight: 17,
    marginBottom: 2,
    textAlign: 'center',
    alignSelf: 'stretch',
  },
  orderAgainMeta: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    textAlign: 'center',
    alignSelf: 'stretch',
  },
  heroCardWrap: {
    marginBottom: 20,
  },
  heroCard: {
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8EEE9',
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
