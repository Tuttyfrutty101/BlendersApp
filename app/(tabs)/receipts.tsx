import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { buildCartItemsFromOrderItems } from '@/lib/reorderFromOrder';
import { enqueueReorderItems } from '@/lib/pendingReorder';
import { supabase } from '@/supabase';
import type { CartItem } from '@/types/cart';
import type { OrderItemJson, OrderRow, OrderStatus } from '@/types/order';

const PAGE_BG = '#F8FAF9';
const CARD = '#FFFFFF';
const BTN_GREEN = '#1A9D58';
const ACTIVE_BORDER = '#22C55E';
/** Pale footer behind progress bar */
const ACTIVE_PROGRESS_FOOTER_BG = '#F0FDF4';
const TEXT_PRIMARY = '#000000';
const MUTED = '#6B7280';
const SECTION_LABEL = '#9CA3AF';
/** Dark green status pill text (mock) */
const STATUS_PILL_TEXT = '#166534';
const THUMB_PLACEHOLDER_PAST = '#15803D';
/** Light neutral slot when menu image is missing (active card) */
const THUMB_PLACEHOLDER_ACTIVE = '#E8EAEB';

const ACTIVE_STATUSES: OrderStatus[] = ['placed', 'preparing', 'ready'];

function isActiveStatus(s: string): s is OrderStatus {
  return ACTIVE_STATUSES.includes(s as OrderStatus);
}

function progressForStatus(status: OrderStatus): number {
  switch (status) {
    case 'placed':
      return 0.25;
    case 'preparing':
      return 0.5;
    case 'ready':
      return 1;
    default:
      return 0;
  }
}

function statusBadgeLabel(status: OrderStatus): string {
  switch (status) {
    case 'placed':
      return 'Placed';
    case 'preparing':
      return 'Preparing';
    case 'ready':
      return 'Ready';
    default:
      return status;
  }
}

/** e.g. "Today 3:28 PM" for active orders */
function formatActiveOrderTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const timeStr = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    if (isToday) {
      return `Today ${timeStr}`;
    }
    return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${timeStr}`;
  } catch {
    return iso;
  }
}

/** e.g. "Apr 10, 2:45 PM" for completed cards (matches receipt mock) */
function formatPastOrderTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/** "Tropical Mango (24 oz), Ginger Shot (2 oz)" */
function pastItemsSummaryLine(items: OrderItemJson[]): string {
  if (!items.length) return '';
  return items.map((i) => `${i.name} (${i.size} oz)`).join(', ');
}

/** Small gray estimate line — static placeholder until real prep times exist */
function estimateLineForStatus(status: OrderStatus): string | null {
  switch (status) {
    case 'preparing':
      return 'Est. 8 min';
    case 'placed':
      return 'Est. 15 min';
    case 'ready':
      return 'Ready for pickup';
    default:
      return null;
  }
}

/** Two item thumbnails + optional +N (matches compact receipt mock). */
function OrderItemThumbnails({
  items,
  placeholderColor = THUMB_PLACEHOLDER_PAST,
}: {
  items: OrderItemJson[];
  /** Active card: light gray empty slots; past: optional darker placeholder */
  placeholderColor?: string;
}) {
  if (items.length === 0) return null;
  const maxPreview = 2;
  const overflow = items.length > maxPreview ? items.length - maxPreview : 0;
  const slice = items.slice(0, maxPreview);

  return (
    <View style={thumbStyles.row}>
      {slice.map((it, i) => (
        <View key={`${it.name}-${i}`} style={thumbStyles.thumbWrap}>
          {it.image_url ? (
            <Image source={{ uri: it.image_url }} style={thumbStyles.thumb} contentFit="cover" />
          ) : (
            <View style={[thumbStyles.thumb, { backgroundColor: placeholderColor }]} />
          )}
        </View>
      ))}
      {overflow > 0 ? (
        <View style={thumbStyles.overflowWrap}>
          <Text style={thumbStyles.overflowText}>+{overflow}</Text>
        </View>
      ) : null}
    </View>
  );
}

const thumbStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 6,
    marginBottom: 0,
  },
  thumbWrap: {
    borderRadius: 22,
    overflow: 'hidden',
  },
  thumb: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#E5E7EB',
  },
  overflowWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#E8EAEB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overflowText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#6B7280',
  },
});

/** Progress: left ring + inner dot, bright green fill on gray track, right ring fills when complete */
function OrderProgressBar({ progress }: { progress: number }) {
  const pct = Math.min(1, Math.max(0, progress));
  const rightFilled = pct >= 1;
  return (
    <View style={progressStyles.wrap}>
      <View style={progressStyles.startCap}>
        <View style={progressStyles.startCapInner} />
      </View>
      <View style={progressStyles.trackOuter}>
        <View style={progressStyles.trackBg} />
        <View style={[progressStyles.trackFill, { width: `${pct * 100}%` }]} />
      </View>
      <View style={[progressStyles.endCap, rightFilled && progressStyles.endCapFilled]} />
    </View>
  );
}

const progressStyles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  startCap: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2.5,
    borderColor: ACTIVE_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    backgroundColor: '#FFFFFF',
  },
  startCapInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: ACTIVE_BORDER,
  },
  trackOuter: {
    flex: 1,
    height: 10,
    justifyContent: 'center',
    position: 'relative',
  },
  trackBg: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 2,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#E5E7EB',
  },
  trackFill: {
    position: 'absolute',
    left: 0,
    top: 2,
    height: 6,
    borderRadius: 3,
    backgroundColor: ACTIVE_BORDER,
  },
  endCap: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2.5,
    borderColor: '#D1D5DB',
    marginLeft: 8,
    backgroundColor: '#FFFFFF',
  },
  endCapFilled: {
    borderColor: ACTIVE_BORDER,
    backgroundColor: ACTIVE_BORDER,
  },
});

function ReceiptDetailModal({
  order,
  onClose,
}: {
  order: OrderRow | null;
  onClose: () => void;
}) {
  const { height: windowHeight } = useWindowDimensions();
  const sheetTranslateY = useRef(new Animated.Value(0)).current;

  const dismissSheet = useCallback(() => {
    Animated.timing(sheetTranslateY, {
      toValue: windowHeight,
      duration: 280,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      onClose();
    });
  }, [sheetTranslateY, windowHeight, onClose]);

  useLayoutEffect(() => {
    if (!order) return;
    sheetTranslateY.setValue(windowHeight);
    const id = requestAnimationFrame(() => {
      Animated.timing(sheetTranslateY, {
        toValue: 0,
        duration: 310,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
    return () => cancelAnimationFrame(id);
  }, [order?.id, windowHeight, sheetTranslateY]);

  if (!order) return null;
  const storeName = order.stores?.name ?? 'Store';
  const items = Array.isArray(order.items) ? order.items : [];

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      {...(Platform.OS === 'ios' ? { presentationStyle: 'overFullScreen' as const } : {})}
      onRequestClose={dismissSheet}>
      <View style={detailStyles.backdrop}>
        <Pressable style={detailStyles.backdropDim} onPress={dismissSheet} accessibilityRole="button" accessibilityLabel="Dismiss" />
        <Animated.View style={[detailStyles.sheet, { transform: [{ translateY: sheetTranslateY }] }]}>
          <View style={detailStyles.sheetHeader}>
            <ThemedText style={detailStyles.sheetTitle}>Receipt</ThemedText>
            <Pressable onPress={dismissSheet} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <MaterialIcons name="close" size={26} color="#111827" />
            </Pressable>
          </View>
          <ScrollView style={detailStyles.scroll} showsVerticalScrollIndicator={false}>
            <ThemedText style={detailStyles.detailStore}>{storeName}</ThemedText>
            <ThemedText style={detailStyles.detailMeta}>{formatPastOrderTime(order.created_at)}</ThemedText>
            <ThemedText style={detailStyles.detailTotal}>${Number(order.total).toFixed(2)}</ThemedText>
            <View style={detailStyles.divider} />
            {items.map((line, idx) => (
              <View key={`${order.id}-line-${idx}`} style={detailStyles.lineRow}>
                <View style={detailStyles.lineTop}>
                  {line.image_url ? (
                    <Image
                      source={{ uri: line.image_url }}
                      style={detailStyles.lineThumb}
                      contentFit="cover"
                    />
                  ) : (
                    <View style={[detailStyles.lineThumb, detailStyles.lineThumbPh]} />
                  )}
                  <View style={detailStyles.lineTextCol}>
                    <ThemedText style={detailStyles.lineName}>
                      {line.name} · {line.size} oz
                    </ThemedText>
                    <ThemedText style={detailStyles.linePrice}>${Number(line.price).toFixed(2)}</ThemedText>
                  </View>
                </View>
                {line.supplements && line.supplements.length > 0 ? (
                  <ThemedText style={detailStyles.lineSub}>+ {line.supplements.join(', ')}</ThemedText>
                ) : null}
                {line.alterations && line.alterations.length > 0 ? (
                  <ThemedText style={detailStyles.lineSub}>{line.alterations.join(', ')}</ThemedText>
                ) : null}
              </View>
            ))}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const detailStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdropDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    backgroundColor: CARD,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    maxHeight: '88%',
    paddingBottom: 28,
    zIndex: 2,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
  },
  scroll: {
    paddingHorizontal: 18,
    paddingTop: 12,
  },
  detailStore: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
  },
  detailMeta: {
    marginTop: 4,
    fontSize: 14,
    color: MUTED,
  },
  detailTotal: {
    marginTop: 10,
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E5E7EB',
    marginVertical: 14,
  },
  lineRow: {
    marginBottom: 16,
  },
  lineTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  lineThumb: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E5E7EB',
  },
  lineThumbPh: {
    backgroundColor: THUMB_PLACEHOLDER_PAST,
  },
  lineTextCol: {
    flex: 1,
  },
  lineName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  linePrice: {
    fontSize: 14,
    fontWeight: '700',
    color: BTN_GREEN,
    marginTop: 2,
  },
  lineSub: {
    fontSize: 12,
    color: MUTED,
    marginTop: 4,
    marginLeft: 50,
  },
});

export default function ReceiptsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [detailOrder, setDetailOrder] = useState<OrderRow | null>(null);
  const [reorderBusyId, setReorderBusyId] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError || !user) {
        setOrders([]);
        return;
      }

      const { data, error } = await supabase
        .from('orders')
        .select('*, stores(name, address)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Failed to load orders:', error);
        setOrders([]);
        return;
      }

      let rows = (data ?? []) as OrderRow[];
      const missingIds = new Set<string>();
      for (const row of rows) {
        const items = Array.isArray(row.items) ? (row.items as OrderItemJson[]) : [];
        for (const line of items) {
          const mid = line.menu_item_id;
          if (mid && !(line.image_url && String(line.image_url).trim())) {
            missingIds.add(mid);
          }
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
        rows = rows.map((row) => {
          const items = Array.isArray(row.items) ? ([...(row.items as OrderItemJson[])] as OrderItemJson[]) : [];
          const patched = items.map((line) => {
            const mid = line.menu_item_id;
            if (!mid || (line.image_url && String(line.image_url).trim())) return line;
            const u = urlByMenuId.get(mid);
            return u ? { ...line, image_url: u } : line;
          });
          return { ...row, items: patched };
        });
      }

      setOrders(rows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const { activeOrders, pastOrders } = useMemo(() => {
    const active: OrderRow[] = [];
    const past: OrderRow[] = [];
    for (const o of orders) {
      if (isActiveStatus(o.status)) {
        active.push(o);
      } else if (o.status === 'completed') {
        past.push(o);
      }
    }
    return { activeOrders: active, pastOrders: past };
  }, [orders]);

  const closeDetail = () => setDetailOrder(null);

  const onReorder = async (order: OrderRow) => {
    setReorderBusyId(order.id);
    try {
      const lines: CartItem[] = await buildCartItemsFromOrderItems(order.items, order.id);
      if (lines.length === 0) {
        Alert.alert(
          'Cannot reorder',
          'We could not rebuild this order from the menu. Try adding items manually.',
        );
        return;
      }
      enqueueReorderItems(lines, order.store_id);
      router.push('/order');
    } finally {
      setReorderBusyId(null);
    }
  };

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView edges={['top']} style={styles.safeAreaTopWhite}>
        <View style={styles.header}>
          <Pressable style={styles.backCircle} onPress={() => router.back()} hitSlop={8}>
            <MaterialIcons name="chevron-left" size={26} color="#111827" />
          </Pressable>
          <ThemedText style={styles.headerTitle}>Receipts</ThemedText>
          <View style={styles.headerRightSpacer} />
        </View>
      </SafeAreaView>

      <View style={styles.mainBody}>
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={BTN_GREEN} />
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}>
            {activeOrders.length > 0 ? (
              <View style={styles.section}>
                <View style={styles.sectionLabelRow}>
                  <View style={styles.greenDot} />
                  <Text style={styles.sectionLabelCaps}>ACTIVE</Text>
                </View>
                {activeOrders.map((order) => {
                  const items = Array.isArray(order.items) ? order.items : [];
                  const storeName = order.stores?.name ?? 'Store';
                  const st = order.status as OrderStatus;
                  const est = estimateLineForStatus(st);
                  return (
                    <View key={order.id} style={styles.activeCard}>
                      <View style={styles.activeCardBody}>
                        <View style={styles.activeTopRow}>
                          <View style={styles.activeTopLeft}>
                            <View style={styles.statusPill}>
                              <Text style={styles.statusPillText}>{statusBadgeLabel(st)}</Text>
                            </View>
                            {est ? <Text style={styles.estMuted}>{est}</Text> : null}
                          </View>
                          <Text style={styles.timeRight}>{formatActiveOrderTime(order.created_at)}</Text>
                        </View>

                        <View style={styles.storeRow}>
                          <MaterialIcons name="place" size={18} color={ACTIVE_BORDER} />
                          <Text style={styles.storeNameActive}>{storeName}</Text>
                        </View>

                        <OrderItemThumbnails items={items} placeholderColor={THUMB_PLACEHOLDER_ACTIVE} />

                        <View style={styles.activeDivider} />

                        <View style={styles.activePriceRow}>
                          <Text style={styles.priceEmphasis}>
                            ${Number(order.total).toFixed(2)}
                          </Text>
                          <Pressable style={styles.viewOrderBtn} onPress={() => setDetailOrder(order)}>
                            <Text style={styles.viewOrderBtnText}>View order</Text>
                          </Pressable>
                        </View>
                      </View>

                      <View style={styles.activeProgressFooter}>
                        <OrderProgressBar progress={progressForStatus(st)} />
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : null}

            <View style={styles.section}>
              <Text style={styles.pastSectionCaps}>PAST ORDERS</Text>
              {pastOrders.length === 0 ? (
                <View style={styles.emptyPast}>
                  <ThemedText style={styles.emptyPastText}>
                    No orders yet — your receipts will appear here.
                  </ThemedText>
                </View>
              ) : (
                pastOrders.map((order) => {
                  const items = Array.isArray(order.items) ? order.items : [];
                  const storeName = order.stores?.name ?? 'Store';
                  const busy = reorderBusyId === order.id;
                  const itemsLine = pastItemsSummaryLine(items);
                  return (
                    <View key={order.id} style={styles.pastCard}>
                      <View style={styles.pastTopRow}>
                        <View style={styles.pastBadge}>
                          <Text style={styles.pastBadgeText}>Completed</Text>
                        </View>
                        <Text style={styles.pastTimeRight}>{formatPastOrderTime(order.created_at)}</Text>
                      </View>

                      <View style={styles.storeRowPast}>
                        <MaterialIcons name="place" size={17} color="#9CA3AF" />
                        <Text style={styles.storeNamePast}>{storeName}</Text>
                      </View>

                      {itemsLine.length > 0 ? (
                        <Text style={styles.pastItemsLine} numberOfLines={4}>
                          {itemsLine}
                        </Text>
                      ) : null}

                      <View style={styles.pastDivider} />

                      <View style={styles.pastFooterRow}>
                        <Text style={styles.pastPrice}>${Number(order.total).toFixed(2)}</Text>
                        <View style={styles.pastActions}>
                          <Pressable
                            style={styles.receiptPillBtn}
                            onPress={() => setDetailOrder(order)}
                            disabled={busy}>
                            <MaterialIcons name="description" size={17} color="#1F2937" />
                            <Text style={styles.receiptPillBtnText}>Receipt</Text>
                          </Pressable>
                          <Pressable
                            style={styles.reorderPillBtn}
                            onPress={() => onReorder(order)}
                            disabled={busy}>
                            {busy ? (
                              <ActivityIndicator color="#FFFFFF" />
                            ) : (
                              <>
                                <MaterialIcons name="replay" size={17} color="#FFFFFF" />
                                <Text style={styles.reorderPillBtnText}>Reorder</Text>
                              </>
                            )}
                          </Pressable>
                        </View>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          </ScrollView>
        )}
      </View>
      <ReceiptDetailModal order={detailOrder} onClose={closeDetail} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: PAGE_BG,
  },
  safeAreaTopWhite: {
    backgroundColor: CARD,
  },
  mainBody: {
    flex: 1,
    backgroundColor: PAGE_BG,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 14,
    backgroundColor: CARD,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8E8E8',
  },
  backCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.3,
  },
  headerRightSpacer: {
    width: 40,
  },
  loadingBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 20,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  greenDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: ACTIVE_BORDER,
  },
  sectionLabelCaps: {
    fontSize: 11,
    fontWeight: '700',
    color: SECTION_LABEL,
    letterSpacing: 1.4,
  },
  pastSectionCaps: {
    fontSize: 11,
    fontWeight: '700',
    color: SECTION_LABEL,
    letterSpacing: 1.4,
    marginBottom: 14,
  },
  activeCard: {
    backgroundColor: CARD,
    borderRadius: 18,
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: ACTIVE_BORDER,
    overflow: 'hidden',
  },
  activeCardBody: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
  },
  activeDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E5E7EB',
    marginTop: 14,
    marginBottom: 14,
  },
  activeProgressFooter: {
    backgroundColor: ACTIVE_PROGRESS_FOOTER_BG,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(34, 197, 94, 0.2)',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  activeTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  activeTopLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
    flex: 1,
  },
  statusPill: {
    backgroundColor: 'rgba(34, 197, 94, 0.14)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  statusPillText: {
    fontSize: 13,
    fontWeight: '800',
    color: STATUS_PILL_TEXT,
  },
  estMuted: {
    fontSize: 13,
    fontWeight: '600',
    color: MUTED,
  },
  timeRight: {
    fontSize: 13,
    fontWeight: '600',
    color: MUTED,
    marginLeft: 8,
    flexShrink: 0,
  },
  storeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  storeNameActive: {
    fontSize: 16,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  activePriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  priceEmphasis: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: TEXT_PRIMARY,
    minWidth: 0,
  },
  viewOrderBtn: {
    flexShrink: 0,
    backgroundColor: BTN_GREEN,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewOrderBtnText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  pastCard: {
    backgroundColor: CARD,
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 18,
    marginBottom: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E2E5E4',
  },
  pastTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  pastBadge: {
    backgroundColor: '#ECEFF0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  pastBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#374151',
  },
  pastTimeRight: {
    fontSize: 13,
    fontWeight: '500',
    color: '#6B7280',
    flexShrink: 0,
  },
  storeRowPast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 8,
  },
  storeNamePast: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
    flex: 1,
  },
  pastItemsLine: {
    fontSize: 13,
    fontWeight: '500',
    color: '#6B7280',
    lineHeight: 19,
    marginBottom: 2,
  },
  pastDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E8EAEB',
    marginTop: 12,
    marginBottom: 12,
  },
  pastFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  pastPrice: {
    fontSize: 16,
    fontWeight: '700',
    color: TEXT_PRIMARY,
    flexShrink: 0,
  },
  pastActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  receiptPillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: '#E8EAEB',
  },
  receiptPillBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
  },
  reorderPillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: BTN_GREEN,
    minWidth: 96,
  },
  reorderPillBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  emptyPast: {
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#EEF0EF',
  },
  emptyPastText: {
    fontSize: 15,
    color: MUTED,
    textAlign: 'center',
    lineHeight: 22,
  },
});
