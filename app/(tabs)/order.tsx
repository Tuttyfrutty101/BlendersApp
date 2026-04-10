import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import {
  Alert,
  Animated,
  Easing,
  FlatList,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { supabase } from '@/supabase';

/** Hero image for the “Build your juice” customize flow (from Supabase Storage). */
const JUICE_BUILD_MODAL_IMAGE_URL =
  'https://ytcgjydjgiovaiiudmoq.supabase.co/storage/v1/object/public/images/IMG_2502.jpg';

const CART_FLY_BUBBLE_SIZE = 120;
const CART_FLY_END_SCALE = 20 / CART_FLY_BUBBLE_SIZE;
const CART_FLY_DURATION_MS = 500;
const CART_FLY_BEZIER_STEPS = 41;

const SB_SALES_TAX_RATE = 0.0875;
const CHECKOUT_BG = '#ECEFEE';
/** Width of pencil + trash columns when checkout line edit mode is on. */
const CHECKOUT_LINE_EDIT_ACTIONS_WIDTH = 88;
/** Lighter Blenders green (matches brand gradient mid-tone) for checkout CTAs. */
const CHECKOUT_LIGHT_GREEN = '#0A8B57';
const PLACE_ORDER_GREEN = CHECKOUT_LIGHT_GREEN;

function cubicBezier1D(t: number, a: number, b: number, c: number, d: number): number {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

type BezierPoint = { x: number; y: number };

function cubicBezier2D(t: number, p0: BezierPoint, p1: BezierPoint, p2: BezierPoint, p3: BezierPoint): BezierPoint {
  return {
    x: cubicBezier1D(t, p0.x, p1.x, p2.x, p3.x),
    y: cubicBezier1D(t, p0.y, p1.y, p2.y, p3.y),
  };
}

type Step = 'location' | 'category' | 'item' | 'customize';

type Location = {
  id: string;
  name: string;
  address: string;
  /** Postgres `time`, e.g. `07:00:00`. */
  open_weekday: string;
  close_weekday: string;
  open_weekend: string;
  close_weekend: string;
  latitude: number | null;
  longitude: number | null;
};

type CategoryId = 'smoothie' | 'bowl' | 'shot' | 'juice' | 'focused health blend';
type SmoothieSubcategory = 'juicy' | 'creamy' | 'powerful' | 'tropical' | 'secret';
type MaterialIconName = keyof typeof MaterialIcons.glyphMap;

type MenuItem = {
  id: string;
  name: string;
  description: string;
  category: CategoryId;
  subcategory: SmoothieSubcategory | null;
  featured: boolean;
  image_url: string | null;
  sizes: number[];
  prices: Record<string, number>;
  alterations: Alteration[];
};

type CartItem = {
  id: string;
  name: string;
  /** Fluid ounces for this line item. */
  size: number;
  supplements: string[];
  alterations: string[];
  specialInstructions?: string;
  price: number;
  /** Source menu item — used when reopening customize from checkout. */
  menuItemId?: string;
  juiceBuildFromMenuCard?: boolean;
  supplementSelections?: Record<string, number>;
  supplementSelectionOrder?: string[];
  alterationIds?: string[];
  juiceIngredientIds?: string[];
};

function getCartFlyImageUri(item: MenuItem, isJuiceBuildFromCard: boolean): string | null {
  if (isJuiceBuildFromCard || item.category === 'juice') {
    return JUICE_BUILD_MODAL_IMAGE_URL;
  }
  return item.image_url;
}

function checkoutImageUriForCartLine(item: CartItem, menuItems: MenuItem[]): string | null {
  if (item.juiceBuildFromMenuCard || item.name.startsWith('Juice (')) {
    return JUICE_BUILD_MODAL_IMAGE_URL;
  }
  if (item.menuItemId) {
    const m = menuItems.find((x) => x.id === item.menuItemId);
    if (m?.category === 'juice') return JUICE_BUILD_MODAL_IMAGE_URL;
    return m?.image_url ?? null;
  }
  return null;
}

type Supplement = {
  id: string;
  name: string;
  price: number;
};

type AlterationType = 'add' | 'substitute' | 'remove' | 'request';
type Alteration = {
  id: string;
  name: string;
  price: number;
  type: AlterationType;
};

function normalizeSupplementRow(row: { id: string; name: string; price: unknown }): Supplement {
  const p = typeof row.price === 'number' ? row.price : Number(row.price);
  return {
    id: row.id,
    name: row.name,
    price: Number.isFinite(p) ? p : 0,
  };
}

function normalizePrices(value: unknown): Record<string, number> {
  if (value == null || typeof value !== 'object') {
    return {};
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    if (Number.isFinite(n)) {
      out[k] = n;
    }
  }
  return out;
}

function normalizeAlterations(value: unknown): Alteration[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: Alteration[] = [];
  value.forEach((entry, index) => {
    if (entry == null || typeof entry !== 'object') return;
    const row = entry as Record<string, unknown>;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    const typeRaw = typeof row.type === 'string' ? row.type.trim().toLowerCase() : '';
    const p = typeof row.price === 'number' ? row.price : Number(row.price);
    if (!name) return;
    if (typeRaw !== 'add' && typeRaw !== 'substitute' && typeRaw !== 'remove' && typeRaw !== 'request') return;
    if (!Number.isFinite(p)) return;
    out.push({
      id: `${typeRaw}-${name.toLowerCase()}-${index}`,
      name,
      type: typeRaw as AlterationType,
      price: p,
    });
  });
  return out;
}

/** Display label under alteration name: free, surcharge, or discount. */
function formatAlterationPriceLabel(price: number): string {
  if (price < 0) {
    return `-$${Math.abs(price).toFixed(2)}`;
  }
  if (price === 0) {
    return 'Free';
  }
  return `+$${price.toFixed(2)}`;
}

function formatAlterationLineForCart(alt: { name: string; price: number }): string {
  if (alt.price < 0) {
    return `${alt.name} -$${Math.abs(alt.price).toFixed(2)}`;
  }
  if (alt.price === 0) {
    return `${alt.name} (Free)`;
  }
  return `${alt.name} (+$${alt.price.toFixed(2)})`;
}

/** Emoji for juice ingredient grid — matches common produce names from menu_items. */
function emojiForJuiceIngredient(name: string): string {
  const n = name.trim().toLowerCase();
  const pairs: [string, string][] = [
    ['orange', '🍊'],
    ['lemon', '🍋'],
    ['lime', '🍋'],
    ['grapefruit', '🍊'],
    ['apple', '🍎'],
    ['green apple', '🍏'],
    ['banana', '🍌'],
    ['strawberry', '🍓'],
    ['blueberry', '🫐'],
    ['grape', '🍇'],
    ['watermelon', '🍉'],
    ['pineapple', '🍍'],
    ['mango', '🥭'],
    ['peach', '🍑'],
    ['cherry', '🍒'],
    ['kiwi', '🥝'],
    ['pear', '🍐'],
    ['tomato', '🍅'],
    ['garlic', '🧄'],
    ['parsley', '🌿'],
    ['spinach', '🌿'],
    ['celery', '🥦'],
    ['carrot', '🥕'],
    ['cucumber', '🥒'],
    ['broccoli', '🥦'],
    ['lettuce', '🥬'],
    ['kale', '🥬'],
    ['ginger', '🫚'],
    ['beet', '🟣'],
    ['coconut', '🥥'],
    ['avocado', '🥑'],
  ];
  for (const [key, emoji] of pairs) {
    if (n.includes(key)) return emoji;
  }
  return '🧃';
}

function normalizeMenuItemRow(row: {
  id: string;
  name: string;
  description: string;
  category: string;
  subcategory?: string | null;
  featured?: boolean;
  image_url?: string | null;
  sizes?: unknown;
  prices?: unknown;
  alterations?: unknown;
}): MenuItem {
  const rawSizes = Array.isArray(row.sizes) ? row.sizes : [];
  const sizes = rawSizes
    .map((s) => (typeof s === 'number' ? s : Number(s)))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  const normalizedSubcategory =
    typeof row.subcategory === 'string' ? row.subcategory.trim().toLowerCase() : null;
  const smoothieSubcategories: SmoothieSubcategory[] = ['juicy', 'creamy', 'powerful', 'tropical', 'secret'];
  const subcategory: SmoothieSubcategory | null =
    normalizedSubcategory != null &&
    (smoothieSubcategories as string[]).includes(normalizedSubcategory)
      ? (normalizedSubcategory as SmoothieSubcategory)
      : null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category as CategoryId,
    subcategory,
    featured: row.featured === true,
    image_url: typeof row.image_url === 'string' ? row.image_url : null,
    sizes,
    prices: normalizePrices(row.prices),
    alterations: normalizeAlterations(row.alterations),
  };
}

function priceForOz(prices: Record<string, number>, oz: number): number {
  return prices[String(oz)] ?? 0;
}

function sortedSizes(item: MenuItem): number[] {
  return [...item.sizes].sort((a, b) => a - b);
}

function isWeekendDate(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

function getStoreHoursForDate(location: Location, d: Date): { open: string; close: string } {
  return isWeekendDate(d)
    ? { open: location.open_weekend, close: location.close_weekend }
    : { open: location.open_weekday, close: location.close_weekday };
}

/** Minutes since midnight from a Postgres `time` string (`HH:MM:SS` or `HH:MM`). */
function minutesFromPgTime(t: string): number {
  const parts = t.trim().split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1] ?? 0);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

/** e.g. `07:00:00` → `7:00 AM` */
function formatTimeForDisplay(pgTime: string): string {
  const parts = pgTime.trim().split(':');
  let h = Number(parts[0]);
  const m = Number(parts[1] ?? 0);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const mm = m.toString().padStart(2, '0');
  return `${hour12}:${mm} ${ampm}`;
}

function isStoreOpen(location: Location, now: Date): boolean {
  const { open: oStr, close: cStr } = getStoreHoursForDate(location, now);
  const om = minutesFromPgTime(oStr);
  const cm = minutesFromPgTime(cStr);
  const nm = now.getHours() * 60 + now.getMinutes();
  if (cm <= om) {
    return nm >= om || nm < cm;
  }
  return nm >= om && nm < cm;
}

function getStoreStatusLine(
  location: Location,
  now: Date,
): { text: string; tone: 'open' | 'closed' } {
  if (isStoreOpen(location, now)) {
    const { close } = getStoreHoursForDate(location, now);
    return { text: `Open now · Closes at ${formatTimeForDisplay(close)}`, tone: 'open' };
  }

  const { open: oStr } = getStoreHoursForDate(location, now);
  const om = minutesFromPgTime(oStr);
  const nm = now.getHours() * 60 + now.getMinutes();

  if (nm < om) {
    return { text: `Closed · Opens at ${formatTimeForDisplay(oStr)}`, tone: 'closed' };
  }

  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  const nextOpen = getStoreHoursForDate(location, next).open;
  return { text: `Closed · Opens at ${formatTimeForDisplay(nextOpen)}`, tone: 'closed' };
}

function normalizeStoreRow(row: {
  id: string;
  name: string;
  address: string;
  open_weekday: string;
  close_weekday: string;
  open_weekend: string;
  close_weekend: string;
  latitude: unknown;
  longitude: unknown;
}): Location {
  let latitude =
    typeof row.latitude === 'number'
      ? row.latitude
      : typeof row.latitude === 'string'
        ? Number(row.latitude)
        : NaN;
  let longitude =
    typeof row.longitude === 'number'
      ? row.longitude
      : typeof row.longitude === 'string'
        ? Number(row.longitude)
        : NaN;

  // If values were accidentally saved as lng/lat, swap them.
  if (Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) > 90 && Math.abs(longitude) <= 90) {
    const tmp = latitude;
    latitude = longitude;
    longitude = tmp;
  }

  return {
    id: row.id,
    name: row.name,
    address: row.address,
    open_weekday: row.open_weekday,
    close_weekday: row.close_weekday,
    open_weekend: row.open_weekend,
    close_weekend: row.close_weekend,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
  };
}

const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: 'smoothie', label: 'Smoothies' },
  { id: 'bowl', label: 'Bowls' },
  { id: 'shot', label: 'Shots' },
  { id: 'juice', label: 'Fresh Juice' },
  { id: 'focused health blend', label: 'Focused Health Blends' },
];

/** General menu “Fresh Juice” row — circular thumbnail (not tied to a single menu item image). */
const FRESH_JUICE_MENU_CARD_IMAGE_URL =
  'https://ytcgjydjgiovaiiudmoq.supabase.co/storage/v1/object/public/images/IMG_2502.jpg';

const SMOOTHIE_SUBCATEGORY_FILTERS: { id: 'all' | SmoothieSubcategory; label: string; icon: MaterialIconName }[] = [
  { id: 'all', label: 'All', icon: 'apps' },
  { id: 'juicy', label: 'Juicy', icon: 'water-drop' },
  { id: 'creamy', label: 'Creamy', icon: 'icecream' },
  { id: 'powerful', label: 'Powerful', icon: 'bolt' },
  { id: 'tropical', label: 'Tropical', icon: 'wb-sunny' },
  { id: 'secret', label: 'Secret', icon: 'auto-awesome' },
];

/** Selected store card fill — scrim + gradient match this so the overlay blends in. */
const STORE_ROW_SELECTED_BG = '#F4FFF9';

/** Widths for Order Here slide (fade + solid + pill); clip must hide full group when off-screen. */
/** Wide enough for a smooth handoff from transparent into the solid scrim. */
const STORE_ORDER_FADE_GRADIENT_W = 20;
/** Narrow mint strip between gradient and pill (~half the old flex-filled band). */
const STORE_ORDER_SCRIM_SOLID_W = 12;
/** Same as text block: storeAddress lineHeight 20 + storeMeta marginTop 4 + lineHeight 20. */
const STORE_ORDER_SCRIM_HEIGHT = 44;
/** Minimum pill width; clip must cover fade + strip + pill. */
const STORE_ORDER_BUTTON_MIN_W = 100;
/** Mint gap between pill and card right inside the slide group. */
const STORE_ORDER_BUTTON_RIGHT_SPACER_W = 8;
const STORE_ORDER_BUTTON_CLIP_W =
  STORE_ORDER_FADE_GRADIENT_W +
  STORE_ORDER_SCRIM_SOLID_W +
  STORE_ORDER_BUTTON_MIN_W +
  24 +
  STORE_ORDER_BUTTON_RIGHT_SPACER_W;

type StoreLocationRowProps = {
  item: Location;
  isSelected: boolean;
  favoriteStoreIds: string[];
  now: Date;
  onSelectRow: () => void;
  onOrderHere: () => void;
  onToggleFavorite: (id: string) => void;
};

function StoreLocationRow({
  item,
  isSelected,
  favoriteStoreIds,
  now,
  onSelectRow,
  onOrderHere,
  onToggleFavorite,
}: StoreLocationRowProps) {
  const orderSlide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(orderSlide, {
      toValue: isSelected ? 1 : 0,
      duration: isSelected ? 260 : 200,
      easing: isSelected ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [item.id, isSelected, orderSlide]);

  const orderTranslateX = orderSlide.interpolate({
    inputRange: [0, 1],
    outputRange: [STORE_ORDER_BUTTON_CLIP_W, 0],
  });

  const statusLine = getStoreStatusLine(item, now);

  return (
    <Pressable
      style={[styles.storeRow, isSelected && styles.storeRowSelected]}
      onPress={onSelectRow}>
      <View style={styles.storeRowTop}>
        <ThemedText style={styles.storeTitle}>{item.name}</ThemedText>
        <View style={styles.storeIcons}>
          <Pressable
            style={styles.storeIconButton}
            onPress={() => onToggleFavorite(item.id)}>
            <MaterialIcons
              name={favoriteStoreIds.includes(item.id) ? 'favorite' : 'favorite-border'}
              size={22}
              color={favoriteStoreIds.includes(item.id) ? '#FF8A00' : '#58635D'}
            />
          </Pressable>
          <Pressable style={styles.storeIconButton}>
            <MaterialIcons name="info-outline" size={22} color="#58635D" />
          </Pressable>
        </View>
      </View>
      <View style={styles.storeRowMiddle}>
        <View style={styles.storeRowTextBlock}>
          <ThemedText
            style={styles.storeAddress}
            numberOfLines={1}
            ellipsizeMode="tail">
            {item.address}
          </ThemedText>
          <View style={styles.storeMetaRow}>
            <View
              style={[
                styles.storeStatusDot,
                statusLine.tone === 'open' ? styles.storeStatusDotOpen : styles.storeStatusDotClosed,
              ]}
            />
            <ThemedText
              style={[styles.storeMeta, statusLine.tone === 'open' ? styles.storeMetaOpen : styles.storeMetaClosed]}
              numberOfLines={1}
              ellipsizeMode="tail">
              {statusLine.text}
            </ThemedText>
          </View>
        </View>
        <View style={styles.storeOrderButtonOverlap} pointerEvents="box-none">
          <Animated.View
            style={[styles.storeOrderButtonSlideWrap, { transform: [{ translateX: orderTranslateX }] }]}>
            <View style={styles.storeOrderButtonWithFade}>
              <LinearGradient
                colors={['rgba(244,255,249,0)', STORE_ROW_SELECTED_BG]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={styles.storeOrderFadeGradient}
              />
              <View style={styles.storeOrderMintBackdrop}>
                <View style={styles.storeOrderScrimStrip} />
                <Pressable
                  style={styles.storeOrderButton}
                  onPress={() => {
                    onOrderHere();
                  }}>
                  <Text style={styles.storeOrderButtonText}>Order Here</Text>
                </Pressable>
              </View>
              <View style={styles.storeOrderButtonRightSpacer} />
            </View>
          </Animated.View>
        </View>
      </View>
    </Pressable>
  );
}

export default function OrderScreen() {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const storesListRef = useRef<FlatList<Location>>(null);
  const [step, setStep] = useState<Step>('location');
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<CategoryId | null>(null);
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [selectedSizeOz, setSelectedSizeOz] = useState<number | null>(null);
  const [selectedSupplements, setSelectedSupplements] = useState<Record<string, number>>({});
  const [supplementSelectionOrder, setSupplementSelectionOrder] = useState<string[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [favoriteStoreIds, setFavoriteStoreIds] = useState<string[]>([]);
  const [favoriteMenuItemIds, setFavoriteMenuItemIds] = useState<string[]>([]);
  const [categoryListTab, setCategoryListTab] = useState<'menu' | 'favorites'>('menu');
  const [storeListTab, setStoreListTab] = useState<'nearby' | 'favorites'>('nearby');
  const [storeSearch, setStoreSearch] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchAnim = useRef(new Animated.Value(0)).current;
  const [menuSearch, setMenuSearch] = useState('');
  const [isMenuSearchOpen, setIsMenuSearchOpen] = useState(false);
  const menuSearchAnim = useRef(new Animated.Value(0)).current;
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [categoryItems, setCategoryItems] = useState<MenuItem[]>([]);
  const [menuItemsByCategory, setMenuItemsByCategory] = useState<MenuItem[]>([]);
  const [selectedSmoothieSubcategory, setSelectedSmoothieSubcategory] = useState<'all' | SmoothieSubcategory>('all');
  const [isLoadingMenuCategories, setIsLoadingMenuCategories] = useState(false);
  const [supplements, setSupplements] = useState<Supplement[]>([]);
  const [isSupplementsModalOpen, setIsSupplementsModalOpen] = useState(false);
  const [draftSupplements, setDraftSupplements] = useState<Record<string, number>>({});
  const [draftSupplementSelectionOrder, setDraftSupplementSelectionOrder] = useState<string[]>([]);
  const [selectedAlterationIds, setSelectedAlterationIds] = useState<string[]>([]);
  const [isAlterationsModalOpen, setIsAlterationsModalOpen] = useState(false);
  const [draftAlterationIds, setDraftAlterationIds] = useState<string[]>([]);
  const [specialInstructions, setSpecialInstructions] = useState('');
  const [sizeToggleWidth, setSizeToggleWidth] = useState(0);
  /** Juice category: multi-select ingredient ids (price is size-based only). */
  const [selectedJuiceIngredientIds, setSelectedJuiceIngredientIds] = useState<string[]>([]);
  /** Fresh Juice card on general menu opens customize with chip UI instead of hero image. */
  const [juiceBuildFromMenuCard, setJuiceBuildFromMenuCard] = useState(false);

  /** Full-screen menu layer slides vertically (store pickup → categories, back). */
  const categorySlideY = useRef(new Animated.Value(0)).current;
  /** Item list slides horizontally over the category menu. */
  const itemSlideX = useRef(new Animated.Value(0)).current;
  /** Customize bottom sheet: translateY (off-screen = windowHeight → visible = 0). */
  const customizeSheetTranslateY = useRef(new Animated.Value(0)).current;
  /** Sliding indicator for selected size segment. */
  const sizeSelectorTranslateX = useRef(new Animated.Value(0)).current;
  /** Supplements full-cover sheet slides from bottom. */
  const supplementsSheetTranslateY = useRef(new Animated.Value(0)).current;
  /** Alterations full-cover sheet slides from bottom. */
  const alterationsSheetTranslateY = useRef(new Animated.Value(0)).current;
  /** Customize opened from category menu (featured/favorites) — item overlay stays off-screen; back returns to category. */
  const openedCustomizeFromCategoryOnlyRef = useRef(false);

  /** Add-to-cart fly animation → bag (after customize modal closes). */
  const cartFlyProgress = useRef(new Animated.Value(0)).current;
  const cartFlyEntranceScale = useRef(new Animated.Value(0)).current;
  const cartFlyBubbleOpacity = useRef(new Animated.Value(1)).current;
  const bagIconScale = useRef(new Animated.Value(1)).current;
  const storeStickyBagRef = useRef<View | null>(null);
  const [cartFlyAnim, setCartFlyAnim] = useState<{
    startLeft: number;
    startTop: number;
    uri: string | null;
    translateX: Animated.AnimatedInterpolation<number>;
    translateY: Animated.AnimatedInterpolation<number>;
    scale: ReturnType<typeof Animated.multiply>;
  } | null>(null);

  /** Checkout slides in from the right over the order flow. */
  const checkoutSlideX = useRef(new Animated.Value(0)).current;
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutEditMode, setCheckoutEditMode] = useState(false);
  const checkoutLineEditAnim = useRef(new Animated.Value(0)).current;
  const [checkoutRewardsPoints, setCheckoutRewardsPoints] = useState<number | null>(null);
  const [applyRewardsDiscount, setApplyRewardsDiscount] = useState(false);
  const editCartItemIdRef = useRef<string | null>(null);
  const returnToCheckoutAfterCustomizeRef = useRef(false);
  const savedStepBeforeCheckoutEditRef = useRef<Step>('category');

  const slideDuration = 300;

  const dismissCustomizeModal = (onClosed?: () => void) => {
    Animated.timing(customizeSheetTranslateY, {
      toValue: windowHeight,
      duration: 280,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        onClosed?.();
      }
    });
  };

  const runCartFlyAnimation = useCallback(
    (uri: string | null) => {
      const playBagBounce = () => {
        bagIconScale.setValue(1);
        Animated.sequence([
          Animated.timing(bagIconScale, {
            toValue: 1.3,
            duration: 100,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(bagIconScale, {
            toValue: 1,
            duration: 100,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
        ]).start();
      };

      const bagEl = storeStickyBagRef.current;
      if (!bagEl) {
        playBagBounce();
        return;
      }

      cartFlyProgress.setValue(0);
      cartFlyEntranceScale.setValue(0);
      cartFlyBubbleOpacity.setValue(1);
      const startCenterX = windowWidth / 2;
      const startCenterY = windowHeight / 2;
      const half = CART_FLY_BUBBLE_SIZE / 2;

      bagEl.measureInWindow((x, y, width, height) => {

        const endCenterX = x + width / 2;
        const endCenterY = y + height / 2;
        const p0: BezierPoint = { x: startCenterX, y: startCenterY };
        const p3: BezierPoint = { x: endCenterX, y: endCenterY };
        const dx = endCenterX - startCenterX;
        const dy = endCenterY - startCenterY;
        const dist = Math.hypot(dx, dy) || 1;
        const nx = -dy / dist;
        const ny = dx / dist;
        const bulge = Math.min(120, dist * 0.35);
        const p1: BezierPoint = {
          x: startCenterX + dx * 0.35 + nx * bulge,
          y: startCenterY + dy * 0.35 + ny * bulge,
        };
        const p2: BezierPoint = {
          x: startCenterX + dx * 0.65 + nx * bulge * 0.5,
          y: startCenterY + dy * 0.65 + ny * bulge * 0.5,
        };

        const nSteps = CART_FLY_BEZIER_STEPS;
        const inputRange = Array.from({ length: nSteps }, (_, i) => (nSteps > 1 ? i / (nSteps - 1) : 1));
        const translateXOut: number[] = [];
        const translateYOut: number[] = [];
        const scaleOut: number[] = [];
        for (let i = 0; i < nSteps; i++) {
          const t = nSteps > 1 ? i / (nSteps - 1) : 1;
          const pt = cubicBezier2D(t, p0, p1, p2, p3);
          translateXOut.push(pt.x - startCenterX);
          translateYOut.push(pt.y - startCenterY);
          scaleOut.push(1 + (CART_FLY_END_SCALE - 1) * t);
        }

        const translateX = cartFlyProgress.interpolate({ inputRange, outputRange: translateXOut });
        const translateY = cartFlyProgress.interpolate({ inputRange, outputRange: translateYOut });
        const pathScale = cartFlyProgress.interpolate({ inputRange, outputRange: scaleOut });
        const scale = Animated.multiply(cartFlyEntranceScale, pathScale);

        setCartFlyAnim({
          startLeft: startCenterX - half,
          startTop: startCenterY - half,
          uri,
          translateX,
          translateY,
          scale,
        });

        requestAnimationFrame(() => {
          Animated.sequence([
            Animated.timing(cartFlyEntranceScale, {
              toValue: 1.05,
              duration: 150,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.timing(cartFlyEntranceScale, {
              toValue: 0.95,
              duration: 100,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(cartFlyEntranceScale, {
              toValue: 1.05,
              duration: 100,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(cartFlyEntranceScale, {
              toValue: 1.0,
              duration: 100,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(cartFlyProgress, {
              toValue: 1,
              duration: CART_FLY_DURATION_MS,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ]).start(({ finished }) => {
            if (!finished) return;
            cartFlyBubbleOpacity.setValue(0);
            setCartFlyAnim(null);
            playBagBounce();
          });
        });
      });
    },
    [bagIconScale, cartFlyBubbleOpacity, cartFlyEntranceScale, cartFlyProgress, windowHeight, windowWidth],
  );

  const animateCategoryInFromTop = () => {
    itemSlideX.setValue(0);
    categorySlideY.setValue(-windowHeight);
    requestAnimationFrame(() => {
      Animated.timing(categorySlideY, {
        toValue: 0,
        duration: slideDuration + 40,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
  };

  const animateCategoryOutToTop = (onComplete?: () => void) => {
    Animated.timing(categorySlideY, {
      toValue: -windowHeight,
      duration: slideDuration,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        // Call onComplete (e.g. setStep) before any translate reset — resetting categorySlideY to 0 while
        // the overlay is still mounted snaps the sheet full-screen for a frame. Next open sets -height in animateCategoryInFromTop.
        onComplete?.();
      }
    });
  };

  const animateItemInFromRight = () => {
    itemSlideX.setValue(windowWidth);
    requestAnimationFrame(() => {
      Animated.timing(itemSlideX, {
        toValue: 0,
        duration: slideDuration,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
  };

  const animateItemOutToRight = (onComplete?: () => void) => {
    Animated.timing(itemSlideX, {
      toValue: windowWidth,
      duration: slideDuration - 20,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        // onComplete first (unmounts item layer). Do not set itemSlideX to 0 here — same-tick reset runs before
        // commit and flashes the panel. handleSelectCategory always sets windowWidth when opening again.
        onComplete?.();
      }
    });
  };

  const goBackFromItemList = () => {
    animateItemOutToRight(() => {
      setStep('category');
      setMenuSearch('');
      setIsMenuSearchOpen(false);
      menuSearchAnim.setValue(0);
      setSelectedJuiceIngredientIds([]);
    });
  };

  const goBackToStoreSelection = () => {
    if (step === 'customize') {
      dismissCustomizeModal(() => {
        setSelectedItem(null);
        setSelectedSizeOz(null);
        setSelectedSupplements({});
        setSupplementSelectionOrder([]);
        setSpecialInstructions('');
        setIsSupplementsModalOpen(false);
        setIsAlterationsModalOpen(false);
        setSelectedAlterationIds([]);
        setSelectedJuiceIngredientIds([]);
        setJuiceBuildFromMenuCard(false);
        openedCustomizeFromCategoryOnlyRef.current = false;
        categorySlideY.setValue(0);
        itemSlideX.setValue(0);
        setStep('location');
      });
      return;
    }

    if (step === 'item') {
      setMenuSearch('');
      setIsMenuSearchOpen(false);
      menuSearchAnim.setValue(0);
      animateCategoryOutToTop(() => {
        setStep('location');
      });
      return;
    }

    if (step === 'category') {
      animateCategoryOutToTop(() => setStep('location'));
    }
  };

  const selectedSupplementEntries = supplements
    .map((sup) => ({
      ...sup,
      quantity: selectedSupplements[sup.id] ?? 0,
    }))
    .filter((sup) => sup.quantity > 0);
  const freeSupplementId =
    supplementSelectionOrder.find((id) => (selectedSupplements[id] ?? 0) > 0) ??
    (selectedSupplementEntries.length > 0 ? selectedSupplementEntries[0].id : null);
  const selectedSupplementsAdditionalCost = selectedSupplementEntries.reduce((sum, sup) => {
    const freeUnits = sup.id === freeSupplementId ? 1 : 0;
    const paidUnits = Math.max(0, sup.quantity - freeUnits);
    return sum + paidUnits * sup.price;
  }, 0);
  const selectedAlterationEntries =
    selectedItem?.alterations.filter((alt) => selectedAlterationIds.includes(alt.id)) ?? [];
  const selectedAlterationsAdditionalCost = selectedAlterationEntries.reduce(
    (sum, alt) => sum + alt.price,
    0,
  );
  const currentItemTotal =
    selectedItem != null && selectedSizeOz != null
      ? priceForOz(selectedItem.prices, selectedSizeOz) +
        selectedSupplementsAdditionalCost +
        selectedAlterationsAdditionalCost
      : 0;
  const currentBasePrice =
    selectedItem != null && selectedSizeOz != null ? priceForOz(selectedItem.prices, selectedSizeOz) : 0;

  const defaultRegion = {
    latitude: 34.4214,
    longitude: -119.6982,
    latitudeDelta: 0.08,
    longitudeDelta: 0.08,
  };
  const tabbedLocations =
    storeListTab === 'favorites'
      ? locations.filter((location) => favoriteStoreIds.includes(location.id))
      : locations;
  const filteredLocations = tabbedLocations.filter((location) => {
    const q = storeSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      location.name.toLowerCase().includes(q) ||
      location.address.toLowerCase().includes(q)
    );
  });
  const markerLocations = filteredLocations.filter((location) => {
    if (location.latitude == null || location.longitude == null) return false;
    return Math.abs(location.latitude) <= 90 && Math.abs(location.longitude) <= 180;
  });
  const mapRegion =
    selectedLocation &&
    selectedLocation.latitude != null &&
    selectedLocation.longitude != null
      ? {
          latitude: selectedLocation.latitude,
          longitude: selectedLocation.longitude,
          latitudeDelta: 0.03,
          longitudeDelta: 0.03,
        }
      : markerLocations.length > 0
      ? {
          latitude:
            markerLocations.reduce((sum, location) => sum + (location.latitude ?? 0), 0) /
            markerLocations.length,
          longitude:
            markerLocations.reduce((sum, location) => sum + (location.longitude ?? 0), 0) /
            markerLocations.length,
          latitudeDelta:
            Math.max(
              ...markerLocations.map((location) => Math.abs((location.latitude ?? 0) - defaultRegion.latitude)),
              0.02,
            ) * 2.4,
          longitudeDelta:
            Math.max(
              ...markerLocations.map((location) =>
                Math.abs((location.longitude ?? 0) - defaultRegion.longitude),
              ),
              0.02,
            ) * 2.4,
        }
      : defaultRegion;
  const now = new Date();

  useEffect(() => {
    if (!selectedItem || selectedSizeOz == null || sizeToggleWidth <= 0) {
      return;
    }
    const sizeOptions = sortedSizes(selectedItem);
    if (sizeOptions.length === 0) {
      return;
    }
    const selectedIndex = Math.max(0, sizeOptions.findIndex((oz) => oz === selectedSizeOz));
    const segmentWidth = Math.max(0, (sizeToggleWidth - 14) / sizeOptions.length);
    Animated.spring(sizeSelectorTranslateX, {
      toValue: selectedIndex * segmentWidth,
      useNativeDriver: true,
      speed: 18,
      bounciness: 0,
    }).start();
  }, [selectedItem, selectedSizeOz, sizeToggleWidth, sizeSelectorTranslateX]);

  useEffect(() => {
    const loadStores = async () => {
      setIsLoadingLocations(true);
      const { data, error } = await supabase
        .from('stores')
        .select(
          'id, name, address, open_weekday, close_weekday, open_weekend, close_weekend, latitude, longitude',
        )
        .order('name');

      if (error) {
        console.error('Failed to load stores:', error);
        setLocations([]);
        setIsLoadingLocations(false);
        return;
      }

      setLocations((data ?? []).map((row) => normalizeStoreRow(row)));
      setIsLoadingLocations(false);
    };

    loadStores();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from('supplements').select('id, name, price').order('name');
      if (cancelled) return;
      if (error) {
        console.error('Failed to load supplements:', error);
        setSupplements([]);
        return;
      }
      setSupplements((data ?? []).map((row) => normalizeSupplementRow(row)));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const loadFavoriteStores = async () => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        console.error('Failed to get authenticated user for favorites:', userError);
        return;
      }

      setUserId(user.id);

      const { data: profile, error: profileError } = await supabase
        .from('users')
        .select('id, favorite_store_ids, favorite_menu_item_ids')
        .eq('id', user.id)
        .maybeSingle();

      if (profileError) {
        console.error('Failed to load favorite stores:', profileError);
        return;
      }

      if (profile?.id) {
        setFavoriteStoreIds((profile.favorite_store_ids as string[] | null) ?? []);
        setFavoriteMenuItemIds((profile.favorite_menu_item_ids as string[] | null) ?? []);
        return;
      }

      const { data: insertedUser, error: insertError } = await supabase
        .from('users')
        .insert({
          id: user.id,
          name: typeof user.user_metadata?.name === 'string' ? user.user_metadata.name : 'User',
          email: user.email ?? '',
          rewards_points: 0,
          favorite_store_ids: [],
          favorite_menu_item_ids: [],
        })
        .select('id, favorite_store_ids, favorite_menu_item_ids')
        .single();

      if (insertError) {
        console.error('Failed to create user profile for favorites:', insertError);
        return;
      }

      setFavoriteStoreIds((insertedUser.favorite_store_ids as string[] | null) ?? []);
      setFavoriteMenuItemIds((insertedUser.favorite_menu_item_ids as string[] | null) ?? []);
    };

    loadFavoriteStores();
  }, []);

  useLayoutEffect(() => {
    if (step !== 'customize') {
      return;
    }
    customizeSheetTranslateY.setValue(windowHeight);
    const id = requestAnimationFrame(() => {
      Animated.timing(customizeSheetTranslateY, {
        toValue: 0,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
    return () => cancelAnimationFrame(id);
  }, [step, windowHeight, customizeSheetTranslateY]);

  const toggleFavoriteStore = async (storeId: string) => {
    if (!userId) return;

    const nextFavorites = favoriteStoreIds.includes(storeId)
      ? favoriteStoreIds.filter((id) => id !== storeId)
      : [...favoriteStoreIds, storeId];

    setFavoriteStoreIds(nextFavorites);

    const { error } = await supabase
      .from('users')
      .update({ favorite_store_ids: nextFavorites })
      .eq('id', userId);

    if (error) {
      console.error('Failed to update favorite stores:', error);
      setFavoriteStoreIds(favoriteStoreIds);
    }
  };

  const toggleFavoriteMenuItem = async (menuItemId: string) => {
    if (!userId) return;

    const next = favoriteMenuItemIds.includes(menuItemId)
      ? favoriteMenuItemIds.filter((id) => id !== menuItemId)
      : [...favoriteMenuItemIds, menuItemId];

    setFavoriteMenuItemIds(next);

    const { error } = await supabase
      .from('users')
      .update({ favorite_menu_item_ids: next })
      .eq('id', userId);

    if (error) {
      console.error('Failed to update favorite menu items:', error);
      setFavoriteMenuItemIds(favoriteMenuItemIds);
    }
  };

  const toggleStoreSearch = () => {
    const nextOpen = !isSearchOpen;
    if (nextOpen) {
      setStoreListTab('nearby');
    }
    if (!nextOpen) {
      setStoreSearch('');
    }
    setIsSearchOpen(nextOpen);
    Animated.timing(searchAnim, {
      toValue: nextOpen ? 1 : 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  const handleStoreSearchChange = (value: string) => {
    setStoreSearch(value);
    if (value.trim().length > 0) {
      setStoreListTab('nearby');
    }
  };

  const toggleMenuSearch = () => {
    const nextOpen = !isMenuSearchOpen;
    if (selectedCategory === 'smoothie') {
      setSelectedSmoothieSubcategory('all');
    }
    if (nextOpen) {
      setCategoryListTab('menu');
    }
    if (!nextOpen) {
      setMenuSearch('');
    }
    setIsMenuSearchOpen(nextOpen);
    Animated.timing(menuSearchAnim, {
      toValue: nextOpen ? 1 : 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  const handleOrderHere = async () => {
    if (!selectedLocation) return;
    await loadMenuCategorySections();
    setStep('category');
    animateCategoryInFromTop();
  };

  const loadMenuCategorySections = async () => {
    setIsLoadingMenuCategories(true);
    const { data, error } = await supabase
      .from('menu_items')
      .select('id, name, description, category, subcategory, featured, image_url, sizes, prices, alterations')
      .order('name');

    if (error) {
      console.error('Failed to load menu categories:', error);
      setMenuItemsByCategory([]);
      setIsLoadingMenuCategories(false);
      return;
    }

    setMenuItemsByCategory((data ?? []).map((row) => normalizeMenuItemRow(row)));
    setIsLoadingMenuCategories(false);
  };

  const handleSelectLocationFromMap = (location: Location) => {
    setSelectedLocation(location);
    const index = filteredLocations.findIndex((item) => item.id === location.id);
    if (index >= 0) {
      storesListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.15 });
    }
  };

  const handleSelectCategory = (category: CategoryId) => {
    setSelectedCategory(category);
    setSelectedSmoothieSubcategory('all');
    setCategoryListTab('menu');
    setJuiceBuildFromMenuCard(false);
    setSelectedJuiceIngredientIds([]);
    // Same data as the overview (`loadMenuCategorySections`) — filter synchronously so the list is ready during the slide.
    const items = menuItemsByCategory
      .filter((item) => item.category === category)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
    setCategoryItems(items);
    setStep('item');
    animateItemInFromRight();
  };

  const openFreshJuiceBuildFromCard = () => {
    const items = menuItemsByCategory
      .filter((item) => item.category === 'juice')
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
    if (items.length === 0) {
      Alert.alert('Unavailable', 'No juice ingredients are available.');
      return;
    }
    const first = items[0];
    setSelectedCategory('juice');
    setCategoryItems(items);
    setSelectedItem(first);
    setSelectedJuiceIngredientIds([]);
    setSelectedSizeOz(sortedSizes(first).at(-1) ?? null);
    setSelectedSupplements({});
    setSupplementSelectionOrder([]);
    setSpecialInstructions('');
    setIsSupplementsModalOpen(false);
    setIsAlterationsModalOpen(false);
    setSelectedAlterationIds([]);
    setJuiceBuildFromMenuCard(true);
    openedCustomizeFromCategoryOnlyRef.current = true;
    itemSlideX.setValue(windowWidth);
    setStep('customize');
  };

  const goBackFromCustomize = () => {
    dismissCustomizeModal(() => {
      setIsSupplementsModalOpen(false);
      setIsAlterationsModalOpen(false);
      if (returnToCheckoutAfterCustomizeRef.current) {
        returnToCheckoutAfterCustomizeRef.current = false;
        editCartItemIdRef.current = null;
        setJuiceBuildFromMenuCard(false);
        setSelectedJuiceIngredientIds([]);
        categorySlideY.setValue(0);
        setStep(savedStepBeforeCheckoutEditRef.current);
        return;
      }
      setJuiceBuildFromMenuCard(false);
      setSelectedJuiceIngredientIds([]);
      categorySlideY.setValue(0);
      if (openedCustomizeFromCategoryOnlyRef.current) {
        openedCustomizeFromCategoryOnlyRef.current = false;
        setStep('category');
      } else {
        itemSlideX.setValue(0);
        setStep('item');
      }
    });
  };

  const handleSelectItem = (item: MenuItem) => {
    setJuiceBuildFromMenuCard(false);
    setSelectedItem(item);
    const sizes = sortedSizes(item);
    setSelectedSizeOz(sizes.at(-1) ?? null);
    setSelectedSupplements({});
    setSupplementSelectionOrder([]);
    setSpecialInstructions('');
    setIsSupplementsModalOpen(false);
    setIsAlterationsModalOpen(false);
    setSelectedAlterationIds([]);
    if (step === 'category') {
      openedCustomizeFromCategoryOnlyRef.current = true;
      itemSlideX.setValue(windowWidth);
    } else {
      openedCustomizeFromCategoryOnlyRef.current = false;
    }
    setStep('customize');
  };

  const openSupplementsModal = () => {
    setIsAlterationsModalOpen(false);
    setDraftSupplements(selectedSupplements);
    setDraftSupplementSelectionOrder(supplementSelectionOrder);
    supplementsSheetTranslateY.setValue(windowHeight);
    setIsSupplementsModalOpen(true);
    requestAnimationFrame(() => {
      Animated.timing(supplementsSheetTranslateY, {
        toValue: 0,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
  };

  const dismissSupplementsModal = (onClosed?: () => void) => {
    Animated.timing(supplementsSheetTranslateY, {
      toValue: windowHeight,
      duration: 220,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setIsSupplementsModalOpen(false);
        onClosed?.();
      }
    });
  };

  const setDraftSupplementQuantity = (id: string, nextQuantity: number) => {
    setDraftSupplements((prev) => {
      if (nextQuantity <= 0) {
        const { [id]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [id]: nextQuantity };
    });
  };

  const incrementDraftSupplement = (id: string) => {
    const current = draftSupplements[id] ?? 0;
    if (current === 0) {
      setDraftSupplementSelectionOrder((prev) => (prev.includes(id) ? prev : [...prev, id]));
    }
    setDraftSupplementQuantity(id, current + 1);
  };

  const decrementDraftSupplement = (id: string) => {
    const current = draftSupplements[id] ?? 0;
    if (current <= 1) {
      setDraftSupplementSelectionOrder((prev) => prev.filter((existingId) => existingId !== id));
    }
    setDraftSupplementQuantity(id, current - 1);
  };

  const openAlterationsModal = () => {
    setIsSupplementsModalOpen(false);
    setDraftAlterationIds(selectedAlterationIds);
    alterationsSheetTranslateY.setValue(windowHeight);
    setIsAlterationsModalOpen(true);
    requestAnimationFrame(() => {
      Animated.timing(alterationsSheetTranslateY, {
        toValue: 0,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
  };

  const dismissAlterationsModal = (onClosed?: () => void) => {
    Animated.timing(alterationsSheetTranslateY, {
      toValue: windowHeight,
      duration: 220,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setIsAlterationsModalOpen(false);
        onClosed?.();
      }
    });
  };

  const toggleDraftAlteration = (id: string) => {
    setDraftAlterationIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  };

  const toggleJuiceIngredient = (ingredientId: string) => {
    setSelectedJuiceIngredientIds((prev) =>
      prev.includes(ingredientId) ? prev.filter((id) => id !== ingredientId) : [...prev, ingredientId],
    );
  };

  const handleAddJuiceBuildToCart = () => {
    if (!juiceBuildFromMenuCard || !selectedItem) return;
    const template = categoryItems[0];
    if (!template || selectedSizeOz == null) return;
    if (selectedJuiceIngredientIds.length === 0) {
      Alert.alert('Select ingredients', 'Choose at least one ingredient for your juice.');
      return;
    }
    const ingredientNames = selectedJuiceIngredientIds
      .map((id) => categoryItems.find((m) => m.id === id)?.name)
      .filter((n): n is string => typeof n === 'string' && n.length > 0)
      .sort((a, b) => a.localeCompare(b));
    const base = priceForOz(template.prices, selectedSizeOz);
    const total = base + selectedSupplementsAdditionalCost + selectedAlterationsAdditionalCost;
    const replaceLineId = editCartItemIdRef.current;
    const newItem: CartItem = {
      id: replaceLineId ?? `juice-${Date.now()}`,
      name: `Juice (${ingredientNames.join(', ')})`,
      size: selectedSizeOz,
      supplements: selectedSupplementEntries.map((sup) =>
        sup.quantity > 1 ? `${sup.name} x${sup.quantity}` : sup.name,
      ),
      alterations: selectedAlterationEntries.map((alt) => formatAlterationLineForCart(alt)),
      specialInstructions: specialInstructions.trim() || undefined,
      price: Number(total.toFixed(2)),
      menuItemId: template.id,
      juiceBuildFromMenuCard: true,
      supplementSelections: { ...selectedSupplements },
      supplementSelectionOrder: [...supplementSelectionOrder],
      alterationIds: [...selectedAlterationIds],
      juiceIngredientIds: [...selectedJuiceIngredientIds],
    };

    const flyImageUri = getCartFlyImageUri(template, true);

    dismissCustomizeModal(() => {
      const backFromCheckout = returnToCheckoutAfterCustomizeRef.current;
      returnToCheckoutAfterCustomizeRef.current = false;
      editCartItemIdRef.current = null;

      setCart((prev) =>
        replaceLineId ? prev.map((c) => (c.id === replaceLineId ? newItem : c)) : [...prev, newItem],
      );
      setSelectedJuiceIngredientIds([]);
      setSelectedSupplements({});
      setSupplementSelectionOrder([]);
      setSpecialInstructions('');
      setIsSupplementsModalOpen(false);
      setIsAlterationsModalOpen(false);
      setSelectedAlterationIds([]);
      setJuiceBuildFromMenuCard(false);
      if (backFromCheckout) {
        setStep(savedStepBeforeCheckoutEditRef.current);
        return;
      }
      if (openedCustomizeFromCategoryOnlyRef.current) {
        openedCustomizeFromCategoryOnlyRef.current = false;
        setStep('category');
      } else {
        itemSlideX.setValue(0);
        setStep('item');
      }
      runCartFlyAnimation(flyImageUri);
    });
  };

  const handleAddToCart = () => {
    if (!selectedItem || selectedSizeOz == null) return;

    const replaceLineId = editCartItemIdRef.current;
    const newItem: CartItem = {
      id: replaceLineId ?? `${selectedItem.id}-${Date.now()}`,
      name: selectedItem.name,
      size: selectedSizeOz,
      supplements: selectedSupplementEntries.map((sup) =>
        sup.quantity > 1 ? `${sup.name} x${sup.quantity}` : sup.name,
      ),
      alterations: selectedAlterationEntries.map((alt) => formatAlterationLineForCart(alt)),
      specialInstructions: specialInstructions.trim() || undefined,
      price: Number(currentItemTotal.toFixed(2)),
      menuItemId: selectedItem.id,
      juiceBuildFromMenuCard,
      supplementSelections: { ...selectedSupplements },
      supplementSelectionOrder: [...supplementSelectionOrder],
      alterationIds: [...selectedAlterationIds],
      juiceIngredientIds:
        selectedJuiceIngredientIds.length > 0 ? [...selectedJuiceIngredientIds] : undefined,
    };

    const flyImageUri = getCartFlyImageUri(selectedItem, juiceBuildFromMenuCard);

    dismissCustomizeModal(() => {
      const backFromCheckout = returnToCheckoutAfterCustomizeRef.current;
      returnToCheckoutAfterCustomizeRef.current = false;
      editCartItemIdRef.current = null;

      setCart((prev) =>
        replaceLineId ? prev.map((c) => (c.id === replaceLineId ? newItem : c)) : [...prev, newItem],
      );
      setSpecialInstructions('');
      setIsSupplementsModalOpen(false);
      setIsAlterationsModalOpen(false);
      setSelectedAlterationIds([]);
      if (backFromCheckout) {
        setStep(savedStepBeforeCheckoutEditRef.current);
        return;
      }
      if (openedCustomizeFromCategoryOnlyRef.current) {
        openedCustomizeFromCategoryOnlyRef.current = false;
        setStep('category');
      } else {
        setStep('item');
      }
      runCartFlyAnimation(flyImageUri);
    });
  };

  const getOrCreateUserId = async () => {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      throw userError ?? new Error('No authenticated user found.');
    }

    const { data: existingUser, error: fetchError } = await supabase
      .from('users')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();

    if (fetchError) {
      throw fetchError;
    }

    if (existingUser?.id) {
      return existingUser.id;
    }

    const { data: insertedUser, error: insertError } = await supabase
      .from('users')
      .insert({
        id: user.id,
        name: typeof user.user_metadata?.name === 'string' ? user.user_metadata.name : 'User',
        email: user.email ?? '',
        rewards_points: 0,
        favorite_store_ids: [],
        favorite_menu_item_ids: [],
      })
      .select('id')
      .single();

    if (insertError) {
      throw insertError;
    }

    return insertedUser.id;
  };

  const openCheckout = () => {
    if (cart.length === 0) {
      Alert.alert('Your cart is empty', 'Add at least one item before checking out.');
      return;
    }

    if (!selectedLocation) {
      Alert.alert('Choose a location', 'Please select a store location before checkout.');
      setStep('location');
      return;
    }

    setCheckoutEditMode(false);
    checkoutLineEditAnim.setValue(0);
    setCheckoutOpen(true);
    checkoutSlideX.setValue(windowWidth);
    requestAnimationFrame(() => {
      Animated.timing(checkoutSlideX, {
        toValue: 0,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
  };

  const closeCheckout = () => {
    Animated.timing(checkoutSlideX, {
      toValue: windowWidth,
      duration: 280,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setCheckoutOpen(false);
        setCheckoutEditMode(false);
      }
    });
  };

  const handleCheckoutChangeStore = () => {
    Animated.timing(checkoutSlideX, {
      toValue: windowWidth,
      duration: 280,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      setCheckoutOpen(false);
      setCheckoutEditMode(false);
      goBackToStoreSelection();
    });
  };

  const submitOrderFromCheckout = async () => {
    if (cart.length === 0) {
      Alert.alert('Your cart is empty', 'Add at least one item before checking out.');
      return;
    }

    if (!selectedLocation) {
      Alert.alert('Choose a location', 'Please select a store location before checkout.');
      return;
    }

    setIsSubmittingOrder(true);

    try {
      const uid = await getOrCreateUserId();

      const itemsPayload = cart.map((item) => ({
        name: item.name,
        size: item.size,
        supplements: item.supplements,
        alterations: item.alterations,
        special_instructions: item.specialInstructions ?? null,
        price: item.price,
      }));

      const subtotal = cart.reduce((sum, item) => sum + item.price, 0);
      const tax = subtotal * SB_SALES_TAX_RATE;
      const orderTotal = subtotal + tax;

      const { error } = await supabase.from('orders').insert({
        user_id: uid,
        location: selectedLocation.name,
        items: itemsPayload,
        total: Number(orderTotal.toFixed(2)),
        status: 'placed',
      });

      if (error) {
        throw error;
      }

      setCart([]);
      closeCheckout();
      setStep('category');
      animateCategoryInFromTop();
      Alert.alert('Order placed', 'Your order was submitted successfully.');
    } catch (error) {
      console.error('Failed to submit order:', error);
      Alert.alert('Checkout failed', 'There was a problem submitting your order.');
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  useEffect(() => {
    if (!checkoutOpen) {
      return;
    }

    const loadRewards = async () => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setCheckoutRewardsPoints(null);
        return;
      }

      const { data: profile, error: fetchError } = await supabase
        .from('users')
        .select('rewards_points')
        .eq('id', user.id)
        .maybeSingle();

      if (fetchError) {
        console.error('Failed to fetch rewards for checkout:', fetchError);
        setCheckoutRewardsPoints(null);
        return;
      }

      setCheckoutRewardsPoints(profile?.rewards_points ?? 0);
    };

    loadRewards();
  }, [checkoutOpen]);

  useEffect(() => {
    checkoutLineEditAnim.stopAnimation();
    Animated.timing(checkoutLineEditAnim, {
      toValue: checkoutEditMode ? 1 : 0,
      duration: 280,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [checkoutEditMode, checkoutLineEditAnim]);

  const handleCheckoutAddMoreFromMenu = () => {
    closeCheckout();
    itemSlideX.setValue(0);
    categorySlideY.setValue(0);
    setStep('category');
    setCategoryListTab('menu');
  };

  const openCartItemForEditFromCheckout = (line: CartItem) => {
    if (!line.menuItemId) {
      Alert.alert('Unable to edit', 'This line item cannot be opened in the editor.');
      return;
    }

    const menuItem = menuItemsByCategory.find((m) => m.id === line.menuItemId);
    if (!menuItem) {
      Alert.alert('Unable to edit', 'This menu item is no longer available.');
      return;
    }

    savedStepBeforeCheckoutEditRef.current = step;
    returnToCheckoutAfterCustomizeRef.current = true;
    editCartItemIdRef.current = line.id;

    if (line.juiceBuildFromMenuCard) {
      const juiceItems = menuItemsByCategory
        .filter((i) => i.category === 'juice')
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name));
      if (juiceItems.length === 0) {
        Alert.alert('Unavailable', 'No juice ingredients are available.');
        editCartItemIdRef.current = null;
        returnToCheckoutAfterCustomizeRef.current = false;
        return;
      }
      setSelectedCategory('juice');
      setCategoryItems(juiceItems);
      setSelectedItem(juiceItems[0]);
      setJuiceBuildFromMenuCard(true);
      setSelectedJuiceIngredientIds(line.juiceIngredientIds ?? []);
      setSelectedSizeOz(line.size);
      setSelectedSupplements(line.supplementSelections ?? {});
      setSupplementSelectionOrder(line.supplementSelectionOrder ?? []);
      setSelectedAlterationIds(line.alterationIds ?? []);
      setSpecialInstructions(line.specialInstructions ?? '');
      setIsSupplementsModalOpen(false);
      setIsAlterationsModalOpen(false);
      openedCustomizeFromCategoryOnlyRef.current = false;
      itemSlideX.setValue(0);
    } else {
      setJuiceBuildFromMenuCard(false);
      setSelectedJuiceIngredientIds([]);
      const items = menuItemsByCategory
        .filter((i) => i.category === menuItem.category)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name));
      setSelectedCategory(menuItem.category);
      setCategoryItems(items);
      setSelectedItem(menuItem);
      setSelectedSizeOz(line.size);
      setSelectedSupplements(line.supplementSelections ?? {});
      setSupplementSelectionOrder(line.supplementSelectionOrder ?? []);
      setSelectedAlterationIds(line.alterationIds ?? []);
      setSpecialInstructions(line.specialInstructions ?? '');
      setIsSupplementsModalOpen(false);
      setIsAlterationsModalOpen(false);
      openedCustomizeFromCategoryOnlyRef.current = false;
      itemSlideX.setValue(0);
    }

    setStep('customize');
  };

  const confirmRemoveCartLine = (lineId: string) => {
    Alert.alert('Remove item?', 'This item will be removed from your order.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          setCart((prev) => {
            const next = prev.filter((c) => c.id !== lineId);
            if (next.length === 0) {
              closeCheckout();
            }
            return next;
          });
        },
      },
    ]);
  };

  const categorySearchQuery = menuSearch.trim().toLowerCase();
  const displayedCategoryItems = categoryItems.filter((item) => {
    const matchesSubcategory =
      selectedCategory !== 'smoothie' ||
      selectedSmoothieSubcategory === 'all' ||
      item.subcategory === selectedSmoothieSubcategory;
    if (!matchesSubcategory) return false;
    if (!categorySearchQuery) return true;
    return (
      item.name.toLowerCase().includes(categorySearchQuery) ||
      item.description.toLowerCase().includes(categorySearchQuery)
    );
  });

  const renderCategoryFlowHeader = () => null;

  const renderCategoryMenuTabs = () => (
    <View style={styles.categoryMenuTabsBar}>
      <View style={styles.categoryMenuTabsRow}>
        <Pressable
          style={[styles.storeTabButton, categoryListTab === 'menu' && styles.storeTabButtonActive]}
          onPress={() => setCategoryListTab('menu')}>
          <ThemedText
            style={[
              styles.storeTabButtonText,
              categoryListTab === 'menu' && styles.storeTabButtonTextActive,
            ]}>
            Menu
          </ThemedText>
        </Pressable>
        <Pressable
          style={[styles.storeTabButton, categoryListTab === 'favorites' && styles.storeTabButtonActive]}
          onPress={() => setCategoryListTab('favorites')}>
          <ThemedText
            style={[
              styles.storeTabButtonText,
              categoryListTab === 'favorites' && styles.storeTabButtonTextActive,
            ]}>
            Favorites
          </ThemedText>
        </Pressable>
      </View>
      <Animated.View
        pointerEvents={isMenuSearchOpen ? 'auto' : 'none'}
        style={[
          styles.categoryMenuSearchOverlay,
          {
            transform: [
              {
                translateX: menuSearchAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [windowWidth, 0],
                }),
              },
            ],
          },
        ]}>
        <TextInput
          value={menuSearch}
          onChangeText={setMenuSearch}
          placeholder={isMenuSearchOpen ? 'Search menu or ingredients' : ''}
          placeholderTextColor="#8A9890"
          style={[
            styles.searchInput,
            isMenuSearchOpen && styles.searchInputExpanded,
            styles.categoryMenuSearchInput,
            isMenuSearchOpen && styles.categoryMenuSearchInputExpanded,
          ]}
          autoCapitalize="none"
          clearButtonMode="never"
        />
      </Animated.View>
      <Pressable style={styles.categoryMenuSearchIconButton} onPress={toggleMenuSearch}>
        <Animated.View
          style={{
            transform: [
              {
                rotate: menuSearchAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0deg', '180deg'],
                }),
              },
            ],
          }}>
          <View style={styles.iconStack}>
            <Animated.View
              style={{
                opacity: menuSearchAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 0],
                }),
              }}>
              <MaterialIcons name="search" size={22} color="#5A6B5F" />
            </Animated.View>
            <Animated.View
              style={[
                styles.iconOverlay,
                {
                  opacity: menuSearchAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 1],
                  }),
                },
              ]}>
              <MaterialIcons name="close" size={22} color="#5A6B5F" />
            </Animated.View>
          </View>
        </Animated.View>
      </Pressable>
    </View>
  );

  const renderItemFlowHeader = () => {
    const categoryTitle =
      selectedCategory != null
        ? (CATEGORIES.find((c) => c.id === selectedCategory)?.label ?? 'Menu')
        : 'Menu';
    return (
      <>
        <View style={[styles.header, styles.itemHeaderWithFilters, styles.orderOverlayHPad]}>
          <View style={styles.itemHeaderRow}>
            <Pressable style={styles.searchIconButton} onPress={goBackFromItemList}>
              <MaterialIcons name="arrow-back" size={22} color="#5A6B5F" />
            </Pressable>
            <View style={styles.itemHeaderTitleWrap}>
              <View style={styles.itemHeaderTitleRow}>
                <ThemedText type="title" style={styles.itemHeaderTitle}>
                  {categoryTitle}
                </ThemedText>
                <ThemedText style={styles.itemHeaderCount}>{displayedCategoryItems.length}</ThemedText>
              </View>
            </View>
            <Pressable style={styles.searchIconButton} onPress={toggleMenuSearch}>
              <Animated.View
                style={{
                  transform: [
                    {
                      rotate: menuSearchAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0deg', '180deg'],
                      }),
                    },
                  ],
                }}>
                <View style={styles.iconStack}>
                  <Animated.View
                    style={{
                      opacity: menuSearchAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [1, 0],
                      }),
                    }}>
                    <MaterialIcons name="search" size={22} color="#5A6B5F" />
                  </Animated.View>
                  <Animated.View
                    style={[
                      styles.iconOverlay,
                      {
                        opacity: menuSearchAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, 1],
                        }),
                      },
                    ]}>
                    <MaterialIcons name="close" size={22} color="#5A6B5F" />
                  </Animated.View>
                </View>
              </Animated.View>
            </Pressable>
            <Animated.View
              pointerEvents={isMenuSearchOpen ? 'auto' : 'none'}
              style={[
                styles.itemSearchOverlay,
                {
                  transform: [
                    {
                      translateX: menuSearchAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [240, 0],
                      }),
                    },
                  ],
                },
              ]}>
              <TextInput
                value={menuSearch}
                onChangeText={setMenuSearch}
                placeholder={isMenuSearchOpen ? 'Search menu or ingredients' : ''}
                placeholderTextColor="#8A9890"
                style={[styles.searchInput, isMenuSearchOpen && styles.searchInputExpanded]}
                autoCapitalize="none"
              />
            </Animated.View>
          </View>
        </View>
        {selectedCategory === 'smoothie' ? (
          <View style={styles.subcategoryFiltersSection}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.subcategoryPillsRow}>
              {SMOOTHIE_SUBCATEGORY_FILTERS.map((pill) => {
                const isSelected = selectedSmoothieSubcategory === pill.id;
                return (
                  <Pressable
                    key={pill.id}
                    style={[styles.subcategoryPill, isSelected && styles.subcategoryPillSelected]}
                    onPress={() => {
                      if (isMenuSearchOpen || menuSearch.trim().length > 0) {
                        setMenuSearch('');
                        setIsMenuSearchOpen(false);
                        menuSearchAnim.setValue(0);
                      }
                      setSelectedSmoothieSubcategory(pill.id);
                    }}>
                    <View style={styles.subcategoryPillContent}>
                      <MaterialIcons
                        name={pill.icon}
                        size={14}
                        color={isSelected ? '#FFFFFF' : '#1D2823'}
                      />
                      <ThemedText
                        style={[
                          styles.subcategoryPillText,
                          isSelected && styles.subcategoryPillTextSelected,
                        ]}>
                        {pill.label}
                      </ThemedText>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : (
          <View style={styles.itemHeaderDividerOnly} />
        )}
      </>
    );
  };

  const renderCategoryMenuBody = () => {
    if (isLoadingMenuCategories) {
      return (
        <View style={styles.orderOverlayHPad}>
          <ThemedText>Loading menu...</ThemedText>
        </View>
      );
    }
    const searchQuery = menuSearch.trim().toLowerCase();

    const favoriteMenuItems: MenuItem[] = favoriteMenuItemIds
      .map((id) => menuItemsByCategory.find((m) => m.id === id))
      .filter((m): m is MenuItem => m != null)
      .sort((a, b) => a.name.localeCompare(b.name));

    const filteredFavoriteItems = favoriteMenuItems.filter((item) => {
      if (!searchQuery) return true;
      return (
        item.name.toLowerCase().includes(searchQuery) ||
        item.description.toLowerCase().includes(searchQuery)
      );
    });

    return (
      <View style={styles.categoryStepWrap}>
        <View style={styles.categoryHeaderDivider} />
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(26,37,32,0.16)', 'rgba(26,37,32,0.08)', 'rgba(26,37,32,0)']}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.categoryHeaderDividerShadow}
        />
        <ScrollView contentContainerStyle={styles.menuCategoryContent} showsVerticalScrollIndicator={false}>
          {categoryListTab === 'favorites' ? (
            <>
              {favoriteMenuItemIds.length === 0 ? (
                <View style={[styles.emptyStateWrap, styles.orderOverlayHPad]}>
                  <ThemedText style={styles.emptyStateText}>
                    You don&apos;t have any favorite menu items yet. Tap the heart on an item to add one.
                  </ThemedText>
                </View>
              ) : filteredFavoriteItems.length === 0 ? (
                <View style={[styles.emptyStateWrap, styles.orderOverlayHPad]}>
                  <ThemedText style={styles.emptyStateText}>No favorites match your search.</ThemedText>
                </View>
              ) : (
                <View style={[styles.menuCategorySection, styles.orderOverlayHPad]}>
                  {filteredFavoriteItems.map((item, index) => (
                    <View
                      key={item.id}
                      style={[
                        styles.menuItemRow,
                        index < filteredFavoriteItems.length - 1 && styles.menuItemRowDivider,
                      ]}>
                      <Pressable style={styles.menuItemRowMain} onPress={() => handleSelectItem(item)}>
                        <View style={styles.menuItemImageWrap}>
                          {item.image_url ? (
                            <Image
                              source={{ uri: item.image_url }}
                              style={styles.menuItemImage}
                              contentFit="cover"
                            />
                          ) : (
                            <View style={[styles.menuItemImage, styles.menuItemImagePlaceholder]} />
                          )}
                        </View>
                        <ThemedText style={[styles.menuItemName, styles.menuItemNameFlex]} numberOfLines={2}>
                          {item.name}
                        </ThemedText>
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}
            </>
          ) : (
            (() => {
              const itemsForCategory = (categoryId: CategoryId) =>
                menuItemsByCategory
                  .filter((item) => item.category === categoryId)
                  .filter((item) => {
                    if (!searchQuery) return true;
                    return (
                      item.name.toLowerCase().includes(searchQuery) ||
                      item.description.toLowerCase().includes(searchQuery)
                    );
                  });
              const featuredForCategory = (categoryId: CategoryId) =>
                itemsForCategory(categoryId).filter((item) => item.featured);
              const startingPriceValue = (item: MenuItem) => {
                const validPrices = sortedSizes(item).map((oz) => priceForOz(item.prices, oz)).filter((p) => p > 0);
                if (validPrices.length === 0) return 0;
                return Math.min(...validPrices);
              };
              const startingPriceLabel = (item: MenuItem) => {
                return `From $${startingPriceValue(item).toFixed(2)}`;
              };

              const smoothieFeatured = featuredForCategory('smoothie');
              const bowlFeatured = featuredForCategory('bowl');
              const shots = itemsForCategory('shot');
              const juices = itemsForCategory('juice');
              const focusedBlends = itemsForCategory('focused health blend');
              const firstJuice = juices[0];
              const focusedStartingPrice =
                focusedBlends.length > 0
                  ? Math.min(...focusedBlends.map((item) => startingPriceValue(item)))
                  : 0;

              return (
                <>
                  {(smoothieFeatured.length > 0 || !searchQuery) && (
                    <View style={styles.menuCategorySection}>
                      <View style={[styles.menuCategoryHeaderRow, styles.orderOverlayHPad]}>
                        <ThemedText type="subtitle" style={styles.menuCategoryTitle}>
                          Smoothies
                        </ThemedText>
                        <Pressable onPress={() => handleSelectCategory('smoothie')}>
                          <ThemedText style={styles.menuSeeAll}>See all</ThemedText>
                        </Pressable>
                      </View>
                      {smoothieFeatured.length === 0 ? (
                        <View style={styles.orderOverlayHPad}>
                          <ThemedText style={styles.noFeaturedText}>No featured smoothies available.</ThemedText>
                        </View>
                      ) : (
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          contentContainerStyle={styles.menuCarouselRow}>
                          {smoothieFeatured.map((item) => (
                            <Pressable
                              key={item.id}
                              style={styles.menuCarouselItem}
                              onPress={() => handleSelectItem(item)}>
                              <View style={styles.menuCarouselImageRing}>
                                {item.image_url ? (
                                  <Image source={{ uri: item.image_url }} style={styles.menuCarouselImage} contentFit="cover" />
                                ) : (
                                  <View style={[styles.menuCarouselImage, styles.menuItemImagePlaceholder]} />
                                )}
                              </View>
                              <ThemedText style={styles.menuCarouselName} numberOfLines={1}>
                                {item.name}
                              </ThemedText>
                              <ThemedText style={styles.menuCarouselPrice}>{startingPriceLabel(item)}</ThemedText>
                            </Pressable>
                          ))}
                        </ScrollView>
                      )}
                    </View>
                  )}

                  {(bowlFeatured.length > 0 || !searchQuery) && (
                    <View style={styles.menuCategorySection}>
                      <View style={[styles.menuCategoryHeaderRow, styles.orderOverlayHPad]}>
                        <ThemedText type="subtitle" style={styles.menuCategoryTitle}>
                          Bowls
                        </ThemedText>
                        <Pressable onPress={() => handleSelectCategory('bowl')}>
                          <ThemedText style={styles.menuSeeAll}>See all</ThemedText>
                        </Pressable>
                      </View>
                      {bowlFeatured.length === 0 ? (
                        <View style={styles.orderOverlayHPad}>
                          <ThemedText style={styles.noFeaturedText}>No featured bowls available.</ThemedText>
                        </View>
                      ) : (
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          contentContainerStyle={styles.menuCarouselRow}>
                          {bowlFeatured.map((item) => (
                            <Pressable
                              key={item.id}
                              style={styles.menuCarouselItem}
                              onPress={() => handleSelectItem(item)}>
                              <View style={styles.menuCarouselImageRing}>
                                {item.image_url ? (
                                  <Image source={{ uri: item.image_url }} style={styles.menuCarouselImage} contentFit="cover" />
                                ) : (
                                  <View style={[styles.menuCarouselImage, styles.menuItemImagePlaceholder]} />
                                )}
                              </View>
                              <ThemedText style={styles.menuCarouselName} numberOfLines={1}>
                                {item.name}
                              </ThemedText>
                              <ThemedText style={styles.menuCarouselPrice}>{startingPriceLabel(item)}</ThemedText>
                            </Pressable>
                          ))}
                        </ScrollView>
                      )}
                    </View>
                  )}

                  {(shots.length > 0 || !searchQuery) && (
                    <View style={styles.menuCategorySection}>
                      <View style={[styles.menuCategoryHeaderRow, styles.orderOverlayHPad]}>
                        <ThemedText type="subtitle" style={styles.menuCategoryTitle}>
                          Shots
                        </ThemedText>
                      </View>
                      {shots.length === 0 ? (
                        <View style={styles.orderOverlayHPad}>
                          <ThemedText style={styles.noFeaturedText}>No shots available.</ThemedText>
                        </View>
                      ) : (
                        <View style={[styles.shotGrid, styles.orderOverlayHPad]}>
                          {shots.map((item) => (
                            <Pressable
                              key={item.id}
                              style={styles.shotGridCard}
                              onPress={() => handleSelectItem(item)}>
                              <View style={styles.shotGridImageWrap}>
                                {item.image_url ? (
                                  <Image source={{ uri: item.image_url }} style={styles.shotGridImage} contentFit="cover" />
                                ) : (
                                  <View style={[styles.shotGridImage, styles.menuItemImagePlaceholder]} />
                                )}
                              </View>
                              <ThemedText style={styles.shotGridName} numberOfLines={2}>
                                {item.name}
                              </ThemedText>
                              <ThemedText style={styles.shotGridPrice}>{startingPriceLabel(item)}</ThemedText>
                            </Pressable>
                          ))}
                        </View>
                      )}
                    </View>
                  )}

                  {(firstJuice || !searchQuery) && (
                    <View style={styles.menuCategorySection}>
                      <View style={[styles.menuCategoryHeaderRow, styles.orderOverlayHPad]}>
                        <ThemedText type="subtitle" style={styles.menuCategoryTitle}>
                          Fresh Juice
                        </ThemedText>
                      </View>
                      {firstJuice ? (
                        <View style={styles.orderOverlayHPad}>
                          <Pressable style={styles.juiceBuildCard} onPress={openFreshJuiceBuildFromCard}>
                          <View style={styles.juiceBuildImageWrap}>
                            <Image
                              source={{ uri: FRESH_JUICE_MENU_CARD_IMAGE_URL }}
                              style={styles.juiceBuildImage}
                              contentFit="cover"
                            />
                          </View>
                          <View style={styles.juiceBuildTextWrap}>
                            <ThemedText style={styles.juiceBuildTitle}>Fresh Juice</ThemedText>
                            <ThemedText style={styles.juiceBuildSubtitle} numberOfLines={2}>
                              Build your own
                            </ThemedText>
                            <ThemedText style={styles.juiceBuildPrice}>{startingPriceLabel(firstJuice)}</ThemedText>
                          </View>
                          <MaterialIcons name="chevron-right" size={24} color="#6A746F" />
                        </Pressable>
                        </View>
                      ) : (
                        <View style={styles.orderOverlayHPad}>
                          <ThemedText style={styles.noFeaturedText}>No juice options available.</ThemedText>
                        </View>
                      )}
                    </View>
                  )}

                  {(focusedBlends.length > 0 || !searchQuery) && (
                    <View style={styles.menuCategorySection}>
                      <View style={[styles.menuCategoryHeaderRow, styles.orderOverlayHPad]}>
                        <ThemedText type="subtitle" style={styles.menuCategoryTitle}>
                          Focused Health Blends
                        </ThemedText>
                      </View>
                      {focusedBlends.length > 0 ? (
                        <View style={styles.orderOverlayHPad}>
                          <Pressable onPress={() => handleSelectCategory('focused health blend')}>
                          <LinearGradient
                            colors={['#0D4A37', '#1A6B50']}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={styles.wellnessBanner}>
                            <View style={styles.wellnessDecorCircleLg} />
                            <View style={styles.wellnessDecorCircleSm} />
                            <ThemedText style={styles.wellnessLabel}>Wellness collection</ThemedText>
                            <ThemedText style={styles.wellnessTitle}>Recovery, immunity and more</ThemedText>
                            <View style={styles.wellnessMetaRow}>
                              <ThemedText style={styles.wellnessCount}>
                                {focusedBlends.length} blends available
                              </ThemedText>
                              <ThemedText style={styles.wellnessFromPrice}>
                                From ${focusedStartingPrice.toFixed(2)}
                              </ThemedText>
                            </View>
                          </LinearGradient>
                        </Pressable>
                        </View>
                      ) : (
                        <View style={styles.orderOverlayHPad}>
                          <ThemedText style={styles.noFeaturedText}>No focused blends available.</ThemedText>
                        </View>
                      )}
                    </View>
                  )}
                </>
              );
            })()
          )}
        </ScrollView>
      </View>
    );
  };

  const renderItemGridList = (items: MenuItem[], listKey: string, listEmptyComponent: ReactElement) => {
    /** Horizontal space between the two columns (centered as a group; was ~40px with space-between). */
    const itemGridColumnGap = 14;
    const itemListHPad = 16;
    const itemGridCellWidth = (windowWidth - itemListHPad * 2 - itemGridColumnGap) / 2;

    return (
      <FlatList
        key={listKey}
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={[styles.itemGridRow, { gap: itemGridColumnGap }]}
        contentContainerStyle={[
          styles.listContent,
          selectedCategory === 'smoothie' && styles.listContentSmoothie,
        ]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View
            style={
              selectedCategory === 'smoothie'
                ? styles.smoothieListTopSpacer
                : styles.categoryListTopSpacer
            }
          />
        }
        ListEmptyComponent={<View style={styles.emptyStateWrap}>{listEmptyComponent}</View>}
        renderItem={({ item }) => (
          <Pressable
            style={[styles.itemGridCell, { width: itemGridCellWidth }]}
            onPress={() => handleSelectItem(item)}
            accessibilityRole="button"
            accessibilityLabel={item.name}>
            <View style={styles.itemGridImageWrap}>
              {item.image_url ? (
                <Image
                  source={{ uri: item.image_url }}
                  style={styles.itemGridImage}
                  contentFit="cover"
                />
              ) : (
                <View style={[styles.itemGridImage, styles.menuItemImagePlaceholder]} />
              )}
            </View>
            <View style={styles.itemGridTextBlock}>
              <ThemedText style={styles.itemGridName} numberOfLines={2}>
                {item.name}
              </ThemedText>
              {item.description.trim().length > 0 ? (
                <ThemedText
                  style={styles.itemGridDescription}
                  numberOfLines={2}
                  ellipsizeMode="tail">
                  {item.description}
                </ThemedText>
              ) : null}
            </View>
          </Pressable>
        )}
      />
    );
  };

  const renderItemListBody = () => {
    const categoryLabel =
      CATEGORIES.find((c) => c.id === selectedCategory)?.label ?? 'this category';
    return renderItemGridList(
      displayedCategoryItems,
      `category-items-${selectedCategory ?? 'none'}`,
      <ThemedText style={styles.emptyStateText}>
        No matches found in {categoryLabel}.
      </ThemedText>,
    );
  };

  const renderStoresStep = () => {
    if (isLoadingLocations) {
      return <ThemedText>Loading stores...</ThemedText>;
    }

    return (
        <View style={styles.locationStep}>
          <View style={styles.storesTopBlock}>
            <View style={styles.mapCard}>
              <MapView style={styles.map} region={mapRegion}>
                {markerLocations.map((location) => (
                  <Marker
                    key={location.id}
                    coordinate={{ latitude: location.latitude!, longitude: location.longitude! }}
                    onPress={() => handleSelectLocationFromMap(location)}>
                    {selectedLocation?.id === location.id ? (
                      <View style={styles.selectedMarkerPin}>
                        <View style={styles.selectedMarkerBadge}>
                          <ThemedText style={styles.selectedMarkerBadgeIcon}>🍊</ThemedText>
                        </View>
                        <View style={styles.selectedMarkerTip} />
                      </View>
                    ) : (
                      <View style={styles.markerDot} />
                    )}
                  </Marker>
                ))}
              </MapView>
              {markerLocations.length === 0 ? (
                <View style={styles.mapEmptyOverlay}>
                  <ThemedText style={styles.mapEmptyText}>
                    No valid coordinates found for stores.
                  </ThemedText>
                </View>
              ) : null}
            </View>
            <View style={styles.storeTabsSearchBar}>
              <View style={styles.storeTabsRow}>
                <Pressable
                  style={[styles.storeTabButton, storeListTab === 'nearby' && styles.storeTabButtonActive]}
                  onPress={() => setStoreListTab('nearby')}>
                  <ThemedText
                    style={[
                      styles.storeTabButtonText,
                      storeListTab === 'nearby' && styles.storeTabButtonTextActive,
                    ]}>
                    Nearby
                  </ThemedText>
                </Pressable>
                <Pressable
                  style={[
                    styles.storeTabButton,
                    storeListTab === 'favorites' && styles.storeTabButtonActive,
                  ]}
                  onPress={() => setStoreListTab('favorites')}>
                  <ThemedText
                    style={[
                      styles.storeTabButtonText,
                      storeListTab === 'favorites' && styles.storeTabButtonTextActive,
                    ]}>
                    Favorites
                  </ThemedText>
                </Pressable>
              </View>
              <Animated.View
                pointerEvents={isSearchOpen ? 'auto' : 'none'}
                style={[
                  styles.storeTabsSearchOverlay,
                  {
                    transform: [
                      {
                        translateX: searchAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [windowWidth, 0],
                        }),
                      },
                    ],
                  },
                ]}>
                <TextInput
                  value={storeSearch}
                  onChangeText={handleStoreSearchChange}
                  onFocus={() => setStoreListTab('nearby')}
                  placeholder={isSearchOpen ? 'Search Stores' : ''}
                  placeholderTextColor="#8A9890"
                  style={[
                    styles.searchInput,
                    isSearchOpen && styles.searchInputExpanded,
                    styles.storeTabsSearchInput,
                  ]}
                  autoCapitalize="none"
                />
              </Animated.View>
              <Pressable style={styles.storeSearchIconButton} onPress={toggleStoreSearch}>
                <Animated.View
                  style={{
                    transform: [
                      {
                        rotate: searchAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['0deg', '180deg'],
                        }),
                      },
                    ],
                  }}>
                  <View style={styles.iconStack}>
                    <Animated.View
                      style={{
                        opacity: searchAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [1, 0],
                        }),
                      }}>
                      <MaterialIcons name="search" size={22} color="#5A6B5F" />
                    </Animated.View>
                    <Animated.View
                      style={[
                        styles.iconOverlay,
                        {
                          opacity: searchAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, 1],
                          }),
                        },
                      ]}>
                      <MaterialIcons name="close" size={22} color="#5A6B5F" />
                    </Animated.View>
                  </View>
                </Animated.View>
              </Pressable>
            </View>
            <View pointerEvents="none" style={styles.tabsDividerShadow} />
          </View>

          <FlatList
            ref={storesListRef}
            data={filteredLocations}
            keyExtractor={(item) => item.id}
            style={styles.storesList}
            contentContainerStyle={styles.storesListContent}
            showsVerticalScrollIndicator={false}
            onScrollToIndexFailed={({ index }) => {
              setTimeout(() => {
                storesListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.15 });
              }, 120);
            }}
            ListEmptyComponent={
              <View style={styles.emptyStateWrap}>
                {storeListTab === 'favorites' && favoriteStoreIds.length === 0 ? (
                  <ThemedText style={styles.emptyStateText}>
                    You don&apos;t have any favorite stores yet. Tap the heart icon on a store to add one.
                  </ThemedText>
                ) : (
                  <ThemedText style={styles.emptyStateText}>No stores match your search.</ThemedText>
                )}
              </View>
            }
            renderItem={({ item: store }) => (
              <StoreLocationRow
                item={store}
                isSelected={selectedLocation?.id === store.id}
                favoriteStoreIds={favoriteStoreIds}
                now={now}
                onSelectRow={() => setSelectedLocation(store)}
                onOrderHere={() => {
                  setSelectedLocation(store);
                  handleOrderHere();
                }}
                onToggleFavorite={toggleFavoriteStore}
              />
            )}
          />
        </View>
      );
  };

  const renderSupplementsSection = () => (
    <View style={styles.customizeSection}>
      <ThemedText style={styles.customizeSectionLabel}>Customize</ThemedText>
      <View style={styles.customizeSupplementsCard}>
        <Pressable style={styles.customizeSupplementsHeader} onPress={openSupplementsModal}>
          <ThemedText style={styles.customizeSupplementsHeaderTitle}>Supplements</ThemedText>
          <View style={styles.customizeSupplementsHeaderRight}>
            <ThemedText style={styles.customizeSupplementsHelperBadge}>First free</ThemedText>
            <MaterialIcons name="keyboard-arrow-down" size={24} color="#6D7771" />
          </View>
        </Pressable>
        {selectedSupplementEntries.length > 0 ? (
          <>
            <View style={styles.customizeSupplementsHeaderDivider} />
            <View style={styles.customizeSupplementSummaryChips}>
              {selectedSupplementEntries.map((sup) => (
                <View key={sup.id} style={styles.customizeSupplementSummaryChip}>
                  <ThemedText style={styles.customizeSupplementSummaryChipText}>
                    {sup.name}
                    {sup.quantity > 1 ? ` x${sup.quantity}` : ''}
                  </ThemedText>
                </View>
              ))}
            </View>
          </>
        ) : null}
      </View>
    </View>
  );

  const renderAlterationsSection = () => {
    if (!selectedItem || selectedItem.alterations.length === 0) {
      return null;
    }
    const selected = selectedItem.alterations.filter((alt) => selectedAlterationIds.includes(alt.id));
    return (
      <View style={styles.customizeAlterationsSection}>
        <View style={styles.customizeSupplementsCard}>
          <Pressable style={styles.customizeSupplementsHeader} onPress={openAlterationsModal}>
            <ThemedText style={styles.customizeSupplementsHeaderTitle}>Alterations</ThemedText>
            <View style={styles.customizeSupplementsHeaderRight}>
              <MaterialIcons name="keyboard-arrow-down" size={24} color="#6D7771" />
            </View>
          </Pressable>
          {selected.length > 0 ? (
            <>
              <View style={styles.customizeSupplementsHeaderDivider} />
              <View style={styles.customizeSupplementSummaryChips}>
                {selected.map((alt) => (
                  <View
                    key={alt.id}
                    style={[
                      styles.customizeSupplementSummaryChip,
                      alt.type === 'remove' && styles.customizeAlterationRemoveChip,
                    ]}>
                    <ThemedText
                      style={[
                        styles.customizeSupplementSummaryChipText,
                        alt.type === 'remove' && styles.customizeAlterationRemoveChipText,
                      ]}>
                      {alt.name}
                    </ThemedText>
                  </View>
                ))}
              </View>
            </>
          ) : null}
        </View>
      </View>
    );
  };

  const renderContent = () => {
    if (!(step === 'customize' && selectedItem)) {
      return null;
    }

    const item = selectedItem;
    const sizeOptions = sortedSizes(item);
    const canAddSize = sizeOptions.length > 0 && selectedSizeOz != null;
    const showSizeOptions = item.category !== 'bowl';
    const showSupplementsSection = item.category !== 'shot';
    const juiceBuildInModal = item.category === 'juice' && juiceBuildFromMenuCard;
    const canAddJuiceModal = juiceBuildInModal && canAddSize && selectedJuiceIngredientIds.length > 0;
    const juiceGridGap = 12;
    const juiceCellWidth = (windowWidth - 40 - juiceGridGap * 2) / 3;

    const renderChooseSizeSection = () => {
      if (!showSizeOptions) return null;
      return (
        <View style={styles.customizeSection}>
          <ThemedText style={styles.customizeSectionLabel}>Choose size</ThemedText>
          {sizeOptions.length === 0 ? (
            <ThemedText style={styles.customizeEmptySizes}>No sizes are available for this item.</ThemedText>
          ) : (
            <View
              style={styles.customizeSizeRow}
              onLayout={(event) => setSizeToggleWidth(event.nativeEvent.layout.width)}>
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.customizeSizeSlider,
                  {
                    width: sizeOptions.length > 0 ? Math.max(0, (sizeToggleWidth - 14) / sizeOptions.length) : 0,
                    transform: [{ translateX: sizeSelectorTranslateX }],
                  },
                ]}
              />
              {sizeOptions.map((oz) => {
                const p = priceForOz(item.prices, oz);
                const selected = selectedSizeOz === oz;
                return (
                  <Pressable
                    key={oz}
                    style={styles.customizeSizeColumn}
                    onPress={() => setSelectedSizeOz(oz)}>
                    <ThemedText
                      style={[styles.customizeSizeOzText, selected && styles.customizeSizeOzTextSelected]}>
                      {oz} oz
                    </ThemedText>
                    <ThemedText
                      style={[
                        styles.customizeSizePriceText,
                        selected && styles.customizeSizePriceTextSelected,
                      ]}>
                      ${p.toFixed(2)}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      );
    };

    return (
      <View style={styles.customizeSheetInner}>
        <ScrollView
          style={styles.customizeScroll}
          contentContainerStyle={styles.customizeScrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">
          {juiceBuildInModal ? (
            <>
              <View style={styles.customizeHeroWrap}>
                <Image
                  source={{ uri: JUICE_BUILD_MODAL_IMAGE_URL }}
                  style={styles.customizeHeroImage}
                  contentFit="cover"
                />
              </View>
              <ThemedText style={styles.customizeItemTitle}>Build your juice</ThemedText>
              <ThemedText style={styles.customizeJuiceBuildSubtitle}>
                Select your ingredients — mix as many as you like.
              </ThemedText>
              {renderChooseSizeSection()}
              <View style={styles.juiceIngredientGrid}>
                {displayedCategoryItems.length === 0 ? (
                  <ThemedText style={styles.juiceBuildNoMatchText}>
                    No ingredients match your search.
                  </ThemedText>
                ) : (
                  displayedCategoryItems.map((ingredient) => {
                    const selected = selectedJuiceIngredientIds.includes(ingredient.id);
                    const emoji = emojiForJuiceIngredient(ingredient.name);
                    return (
                      <Pressable
                        key={ingredient.id}
                        style={[styles.juiceIngredientGridCell, { width: juiceCellWidth }]}
                        onPress={() => toggleJuiceIngredient(ingredient.id)}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={ingredient.name}>
                        <View style={styles.juiceIngredientCircleWrap}>
                          {selected ? (
                            <View style={styles.juiceIngredientCircleRing}>
                              <View style={styles.juiceIngredientCircleInner}>
                                <Text style={styles.juiceIngredientEmoji}>{emoji}</Text>
                              </View>
                              <View style={styles.juiceIngredientCheckBadge}>
                                <MaterialIcons name="check" size={12} color="#FFFFFF" />
                              </View>
                            </View>
                          ) : (
                            <View style={styles.juiceIngredientCircleGrey}>
                              <Text style={styles.juiceIngredientEmojiMuted}>{emoji}</Text>
                            </View>
                          )}
                        </View>
                        <ThemedText
                          style={selected ? styles.juiceIngredientLabelSelected : styles.juiceIngredientLabelIdle}
                          numberOfLines={2}>
                          {ingredient.name}
                        </ThemedText>
                      </Pressable>
                    );
                  })
                )}
              </View>
              {selectedJuiceIngredientIds.length > 0 ? (
                <View style={styles.juiceBlendCard}>
                  <ThemedText style={styles.juiceBlendTitle}>Your blend</ThemedText>
                  <View style={styles.juiceBlendChipsRow}>
                    {selectedJuiceIngredientIds.map((id) => {
                      const ing =
                        displayedCategoryItems.find((i) => i.id === id) ??
                        categoryItems.find((i) => i.id === id);
                      if (!ing) return null;
                      return (
                        <View key={id} style={styles.juiceBlendChip}>
                          <ThemedText style={styles.juiceBlendChipText}>{ing.name}</ThemedText>
                        </View>
                      );
                    })}
                  </View>
                </View>
              ) : null}
            </>
          ) : (
            <>
              <View style={styles.customizeHeroWrap}>
                {item.image_url ? (
                  <Image
                    source={{ uri: item.image_url }}
                    style={styles.customizeHeroImage}
                    contentFit="cover"
                  />
                ) : (
                  <View style={[styles.customizeHeroImage, styles.customizeHeroImagePlaceholder]} />
                )}
              </View>

              <ThemedText style={styles.customizeItemTitle}>{item.name}</ThemedText>
              <ThemedText style={styles.customizeItemDescription}>{item.description}</ThemedText>
            </>
          )}

          {!juiceBuildInModal ? renderChooseSizeSection() : null}

          {showSupplementsSection ? renderSupplementsSection() : null}
          {renderAlterationsSection()}

          <View style={styles.customizeSection}>
            <TextInput
              value={specialInstructions}
              onChangeText={setSpecialInstructions}
              placeholder="Special instructions..."
              placeholderTextColor="#B8C1BC"
              multiline
              style={styles.customizeSpecialInstructionsInput}
            />
          </View>

          <View style={styles.customizeCostCard}>
            {selectedSizeOz != null ? (
              <View style={styles.customizeCostRow}>
                <ThemedText style={styles.customizeCostLabel}>
                  {selectedSizeOz} oz {item.name}
                </ThemedText>
                <ThemedText style={styles.customizeCostValue}>${currentBasePrice.toFixed(2)}</ThemedText>
              </View>
            ) : null}
            {selectedSupplementEntries.map((sup) => {
              const freeUnits = sup.id === freeSupplementId ? 1 : 0;
              const paidUnits = Math.max(0, sup.quantity - freeUnits);
              const additionalCost = paidUnits * sup.price;
              return (
                <View key={sup.id} style={styles.customizeCostSubRow}>
                  <ThemedText style={styles.customizeCostSubLabel}>
                    {sup.name}
                    {sup.quantity > 1 ? ` x${sup.quantity}` : ''}
                  </ThemedText>
                  <ThemedText style={styles.customizeCostSubValue}>
                    {additionalCost > 0 ? `+$${additionalCost.toFixed(2)}` : 'Free'}
                  </ThemedText>
                </View>
              );
            })}
            {selectedAlterationEntries.map((alt) => (
              <View key={alt.id} style={styles.customizeCostSubRow}>
                <ThemedText style={styles.customizeCostSubLabel}>{alt.name}</ThemedText>
                <ThemedText style={styles.customizeCostSubValue}>
                  {formatAlterationPriceLabel(alt.price)}
                </ThemedText>
              </View>
            ))}
            <View style={styles.customizeCostDivider} />
            <View style={styles.customizeCostRow}>
              <ThemedText style={styles.customizeCostTotalLabel}>Total</ThemedText>
              <ThemedText style={styles.customizeCostTotalValue}>${currentItemTotal.toFixed(2)}</ThemedText>
            </View>
          </View>
        </ScrollView>

        <View style={[styles.customizeStickyAddWrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <Pressable
            style={[
              styles.customizeAddPill,
              { width: windowWidth * 0.8 },
              (juiceBuildInModal ? !canAddJuiceModal : !canAddSize) && styles.customizeAddPillDisabled,
            ]}
            onPress={juiceBuildInModal ? handleAddJuiceBuildToCart : handleAddToCart}
            disabled={juiceBuildInModal ? !canAddJuiceModal : !canAddSize}>
            <ThemedText style={styles.customizeAddPillText}>
              {returnToCheckoutAfterCustomizeRef.current ? 'Apply edits' : 'Add to order'}
            </ThemedText>
          </Pressable>
        </View>
      </View>
    );
  };

  /** Customize sheet UI (shared). When editing from checkout, this is mounted inside the checkout Modal so it layers above the order UI — a separate RN Modal would stack below checkout and look like a no-op. */
  const renderCustomizeSheetLayer = () => {
    if (!selectedItem) {
      return null;
    }

    const safeWindowHeight = Math.max(0, windowHeight - insets.top - insets.bottom);
    // Extend through bottom inset so the sheet is white to the physical bottom; footer uses padding for the home indicator.
    const sheetHeight = safeWindowHeight * 0.98 + insets.bottom;
    const sheetTop = windowHeight - sheetHeight;
    // Sheet often starts below the notch; don't add full insets.top again — only pad to clear safe area.
    const customizeHeaderPadTop = Math.max(insets.top - sheetTop, 8);

    return (
        <View style={styles.customizeModalRoot}>
          <Pressable
            style={styles.customizeModalBackdrop}
            onPress={goBackFromCustomize}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
          />
          <Animated.View
            style={[
              styles.customizeModalSheet,
              {
                height: sheetHeight,
                bottom: 0,
                transform: [{ translateY: customizeSheetTranslateY }],
              },
            ]}>
            <View
              style={[
                styles.customizeModalHeader,
                { paddingTop: customizeHeaderPadTop },
              ]}>
              <Pressable
                hitSlop={12}
                onPress={() => toggleFavoriteMenuItem(selectedItem.id)}>
                <MaterialIcons
                  name={favoriteMenuItemIds.includes(selectedItem.id) ? 'favorite' : 'favorite-border'}
                  size={26}
                  color={favoriteMenuItemIds.includes(selectedItem.id) ? '#FF8A00' : '#58635D'}
                />
              </Pressable>
              <View style={styles.customizeModalHeaderSpacer} />
              <Pressable
                hitSlop={12}
                onPress={goBackFromCustomize}
                accessibilityRole="button"
                accessibilityLabel="Close">
                <MaterialIcons name="close" size={28} color="#1A2520" />
              </Pressable>
            </View>
            {renderContent()}
            {isSupplementsModalOpen ? (
              <View style={styles.supplementsOverlayRoot}>
                <Animated.View
                  style={[
                    styles.supplementsModalSheet,
                    {
                      paddingTop: customizeHeaderPadTop + 10,
                      transform: [{ translateY: supplementsSheetTranslateY }],
                    },
                  ]}>
                  <View style={styles.supplementsModalHeader}>
                    <View>
                      <ThemedText style={styles.supplementsModalTitle}>Supplements</ThemedText>
                      <ThemedText style={styles.supplementsModalSubtitle}>
                        First free, then $1.25 per additional
                      </ThemedText>
                    </View>
                    <Pressable
                      hitSlop={12}
                      onPress={() =>
                        dismissSupplementsModal(() => {
                          setSelectedSupplements(draftSupplements);
                          setSupplementSelectionOrder(draftSupplementSelectionOrder);
                        })
                      }>
                      <MaterialIcons name="keyboard-arrow-up" size={26} color="#6D7771" />
                    </Pressable>
                  </View>
                  {supplements.length === 0 ? (
                    <ThemedText style={styles.customizeEmptySizes}>No supplements available.</ThemedText>
                  ) : (
                    <ScrollView
                      style={styles.supplementsModalList}
                      contentContainerStyle={styles.supplementsModalListContent}
                      showsVerticalScrollIndicator={false}>
                      {supplements.map((sup) => {
                        const quantity = draftSupplements[sup.id] ?? 0;
                        const draftEntries = supplements
                          .map((item) => ({
                            ...item,
                            quantity: draftSupplements[item.id] ?? 0,
                          }))
                          .filter((item) => item.quantity > 0);
                        const draftFreeSupplementId =
                          draftSupplementSelectionOrder.find((id) => (draftSupplements[id] ?? 0) > 0) ??
                          (draftEntries.length > 0 ? draftEntries[0].id : null);
                        const freeUnits = sup.id === draftFreeSupplementId ? 1 : 0;
                        const paidUnits = Math.max(0, quantity - freeUnits);
                        const additionalCost = paidUnits * sup.price;
                        const originalCost = quantity * sup.price;
                        const showDiscountedPair = Math.abs(originalCost - additionalCost) > 0.0001;
                        return (
                          <View key={sup.id} style={styles.customizeSupplementRow}>
                            <View style={styles.customizeSupplementTextWrap}>
                              <ThemedText style={styles.customizeSupplementName}>{sup.name}</ThemedText>
                              {quantity > 0 ? (
                                <View style={styles.customizeSupplementPriceRow}>
                                  {showDiscountedPair ? (
                                    <ThemedText style={styles.customizeSupplementPriceOriginal}>
                                      +${originalCost.toFixed(2)}
                                    </ThemedText>
                                  ) : null}
                                  <ThemedText style={styles.customizeSupplementPrice}>
                                    {additionalCost > 0 ? `+$${additionalCost.toFixed(2)}` : 'Free'}
                                  </ThemedText>
                                </View>
                              ) : null}
                            </View>
                            <View style={styles.customizeSupplementCounter}>
                              <Pressable
                                style={styles.customizeSupplementCounterButton}
                                onPress={() => decrementDraftSupplement(sup.id)}>
                                <MaterialIcons name="remove" size={16} color="#1A2520" />
                              </Pressable>
                              <ThemedText style={styles.customizeSupplementCounterValue}>{quantity}</ThemedText>
                              <Pressable
                                style={styles.customizeSupplementCounterButtonFilled}
                                onPress={() => incrementDraftSupplement(sup.id)}>
                                <MaterialIcons name="add" size={16} color="#FFFFFF" />
                              </Pressable>
                            </View>
                          </View>
                        );
                      })}
                    </ScrollView>
                  )}
                  <View
                    style={[
                      styles.supplementsModalStickyFooter,
                      { paddingBottom: Math.max(insets.bottom, 10) },
                    ]}>
                    <Pressable
                      style={styles.supplementsModalConfirmButton}
                      onPress={() =>
                        dismissSupplementsModal(() => {
                          setSelectedSupplements(draftSupplements);
                          setSupplementSelectionOrder(draftSupplementSelectionOrder);
                        })
                      }>
                      <ThemedText style={styles.supplementsModalConfirmButtonText}>Make changes</ThemedText>
                    </Pressable>
                  </View>
                </Animated.View>
              </View>
            ) : null}
            {isAlterationsModalOpen && selectedItem ? (
              <View style={styles.supplementsOverlayRoot}>
                <Animated.View
                  style={[
                    styles.supplementsModalSheet,
                    {
                      paddingTop: customizeHeaderPadTop + 10,
                      transform: [{ translateY: alterationsSheetTranslateY }],
                    },
                  ]}>
                  <View style={styles.supplementsModalHeader}>
                    <View>
                      <ThemedText style={styles.supplementsModalTitle}>Alterations</ThemedText>
                    </View>
                    <Pressable
                      hitSlop={12}
                      onPress={() =>
                        dismissAlterationsModal(() => {
                          setSelectedAlterationIds(draftAlterationIds);
                        })
                      }>
                      <MaterialIcons name="keyboard-arrow-up" size={26} color="#6D7771" />
                    </Pressable>
                  </View>
                  <ScrollView
                    style={styles.supplementsModalList}
                    contentContainerStyle={styles.alterationsModalListContent}
                    showsVerticalScrollIndicator={false}>
                    {(
                      ['request', 'add', 'substitute', 'remove'] as AlterationType[]
                    )
                      .map((type) => {
                        const items = selectedItem.alterations.filter((alt) => alt.type === type);
                        const sectionTitle =
                          type === 'add'
                            ? 'Add-ons'
                            : type === 'substitute'
                              ? 'Substitutions'
                              : type === 'remove'
                                ? 'Remove'
                                : 'Requests';
                        return { type, items, sectionTitle };
                      })
                      .filter((s) => s.items.length > 0)
                      .map((section, sectionIndex) => (
                        <View
                          key={section.type}
                          style={[
                            styles.alterationsSectionBlock,
                            sectionIndex > 0 && styles.alterationsSectionBlockSpaced,
                          ]}>
                          <View
                            style={[
                              styles.alterationsSectionTitleBand,
                              sectionIndex === 0 && styles.alterationsSectionTitleBandFirst,
                            ]}>
                            <ThemedText style={styles.alterationsSectionTitle}>{section.sectionTitle}</ThemedText>
                          </View>
                          {section.items.map((alt, itemIndex) => {
                            const selected = draftAlterationIds.includes(alt.id);
                            const isLastInSection = itemIndex === section.items.length - 1;
                            return (
                              <View
                                key={alt.id}
                                style={[
                                  styles.customizeSupplementRow,
                                  styles.alterationsModalItemRow,
                                  isLastInSection && styles.alterationsModalItemRowLast,
                                ]}>
                                <View style={styles.customizeSupplementTextWrap}>
                                  <ThemedText style={styles.customizeSupplementName}>{alt.name}</ThemedText>
                                  <ThemedText style={styles.customizeSupplementPrice}>
                                    {formatAlterationPriceLabel(alt.price)}
                                  </ThemedText>
                                </View>
                                <Pressable
                                  onPress={() => toggleDraftAlteration(alt.id)}
                                  style={[
                                    styles.alterationToggleTrack,
                                    selected && styles.alterationToggleTrackSelected,
                                  ]}>
                                  <View
                                    style={[
                                      styles.alterationToggleThumb,
                                      selected && styles.alterationToggleThumbSelected,
                                    ]}
                                  />
                                </Pressable>
                              </View>
                            );
                          })}
                        </View>
                      ))}
                  </ScrollView>
                  <View
                    style={[
                      styles.supplementsModalStickyFooter,
                      { paddingBottom: Math.max(insets.bottom, 10) },
                    ]}>
                    <Pressable
                      style={styles.supplementsModalConfirmButton}
                      onPress={() =>
                        dismissAlterationsModal(() => {
                          setSelectedAlterationIds(draftAlterationIds);
                        })
                      }>
                      <ThemedText style={styles.supplementsModalConfirmButtonText}>Make changes</ThemedText>
                    </Pressable>
                  </View>
                </Animated.View>
              </View>
            ) : null}
          </Animated.View>
        </View>
    );
  };

  const renderCustomizeModal = () => {
    if (step !== 'customize' || !selectedItem) {
      return null;
    }
    if (checkoutOpen && returnToCheckoutAfterCustomizeRef.current) {
      return null;
    }

    return (
      <Modal
        visible={step === 'customize'}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={goBackFromCustomize}>
        {renderCustomizeSheetLayer()}
      </Modal>
    );
  };

  const renderCheckoutScreen = () => {
    if (!checkoutOpen || !selectedLocation) {
      return null;
    }

    const subtotal = cart.reduce((sum, item) => sum + item.price, 0);
    const taxAmount = subtotal * SB_SALES_TAX_RATE;
    const orderTotal = subtotal + taxAmount;
    const pickupStatus = getStoreStatusLine(selectedLocation, new Date());
    const rewardPts = checkoutRewardsPoints ?? 0;

    return (
      <Modal
        visible
        transparent
        animationType="none"
        {...(Platform.OS === 'ios' ? { presentationStyle: 'overFullScreen' as const } : {})}
        statusBarTranslucent
        onRequestClose={() => {
          if (step === 'customize' && returnToCheckoutAfterCustomizeRef.current) {
            goBackFromCustomize();
            return;
          }
          closeCheckout();
        }}>
        <View style={styles.checkoutModalBackdrop} collapsable={false}>
          <Animated.View
            style={[
              styles.checkoutSlidePanel,
              { width: windowWidth, transform: [{ translateX: checkoutSlideX }] },
            ]}>
          <View style={[styles.checkoutInner, { paddingTop: insets.top }]}>
          <View style={styles.checkoutHeaderRow}>
            <Pressable
              style={styles.checkoutHeaderSide}
              onPress={closeCheckout}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <MaterialIcons name="arrow-back" size={24} color="#1D2823" />
            </Pressable>
            <ThemedText style={styles.checkoutHeaderTitleCenter}>Your order</ThemedText>
            <View style={styles.checkoutHeaderSide} />
          </View>

          <ScrollView
            style={styles.checkoutScroll}
            contentContainerStyle={styles.checkoutScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            <View style={[styles.checkoutCard, styles.checkoutOrderItemsCard]}>
              <View style={styles.checkoutOrderItemsCardHeader}>
                <ThemedText style={styles.checkoutOrderItemsCardTitle}>Order items</ThemedText>
                <Pressable
                  style={styles.checkoutOrderItemsEditHit}
                  onPress={() => setCheckoutEditMode((v) => !v)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <ThemedText style={styles.checkoutEditButton}>
                    {checkoutEditMode ? 'Done' : 'Edit'}
                  </ThemedText>
                </Pressable>
              </View>
              {cart.map((line, lineIndex) => {
                const lineImageUri = checkoutImageUriForCartLine(line, menuItemsByCategory);
                return (
                  <Fragment key={line.id}>
                    <View style={styles.checkoutLineRow}>
                      <Pressable
                        style={styles.checkoutLineMain}
                        onPress={() => {
                          if (!checkoutEditMode) {
                            setCheckoutEditMode(true);
                          } else {
                            openCartItemForEditFromCheckout(line);
                          }
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={
                          checkoutEditMode
                            ? `Edit ${line.name}`
                            : 'Show edit and delete actions for order items'
                        }>
                        <View style={styles.checkoutLineMainInner}>
                          <View style={styles.checkoutLineImageWrap}>
                            {lineImageUri ? (
                              <Image
                                source={{ uri: lineImageUri }}
                                style={styles.checkoutLineImage}
                                contentFit="cover"
                              />
                            ) : (
                              <View style={[styles.checkoutLineImage, styles.checkoutLineImagePlaceholder]} />
                            )}
                          </View>
                          <View style={styles.checkoutLineBody}>
                            <View style={styles.checkoutLineTitleRow}>
                              <ThemedText style={styles.checkoutLineName} numberOfLines={2}>
                                {line.name}
                              </ThemedText>
                              <ThemedText style={styles.checkoutLinePrice}>${line.price.toFixed(2)}</ThemedText>
                            </View>
                            <ThemedText style={styles.checkoutLineSize}>{line.size} oz</ThemedText>
                            {(line.supplements.length > 0 || line.alterations.length > 0) && (
                              <View style={styles.checkoutTagRow}>
                                {line.supplements.map((tag, i) => (
                                  <View key={`s-${i}`} style={[styles.checkoutTag, styles.checkoutTagSupplement]}>
                                    <ThemedText style={styles.checkoutTagTextSupplement}>{tag}</ThemedText>
                                  </View>
                                ))}
                                {line.alterations.map((tag, i) => (
                                  <View key={`a-${i}`} style={[styles.checkoutTag, styles.checkoutTagAlteration]}>
                                    <ThemedText style={styles.checkoutTagTextAlteration}>{tag}</ThemedText>
                                  </View>
                                ))}
                              </View>
                            )}
                          </View>
                        </View>
                      </Pressable>
                      <Animated.View
                        pointerEvents={checkoutEditMode ? 'auto' : 'none'}
                        style={[
                          styles.checkoutLineActionsShell,
                          {
                            width: checkoutLineEditAnim.interpolate({
                              inputRange: [0, 1],
                              outputRange: [0, CHECKOUT_LINE_EDIT_ACTIONS_WIDTH],
                            }),
                          },
                        ]}>
                        <Animated.View
                          style={[
                            styles.checkoutLineActionsInner,
                            {
                              transform: [
                                {
                                  translateX: checkoutLineEditAnim.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [CHECKOUT_LINE_EDIT_ACTIONS_WIDTH, 0],
                                  }),
                                },
                              ],
                            },
                          ]}>
                          <Pressable
                            style={styles.checkoutLineActionCol}
                            onPress={() => openCartItemForEditFromCheckout(line)}
                            hitSlop={6}>
                            <MaterialIcons name="edit" size={20} color={CHECKOUT_LIGHT_GREEN} />
                          </Pressable>
                          <Pressable
                            style={styles.checkoutLineActionCol}
                            onPress={() => confirmRemoveCartLine(line.id)}
                            hitSlop={6}>
                            <MaterialIcons name="delete-outline" size={22} color="#B85450" />
                          </Pressable>
                        </Animated.View>
                      </Animated.View>
                    </View>
                    {lineIndex < cart.length - 1 ? <View style={styles.checkoutItemDivider} /> : null}
                  </Fragment>
                );
              })}
              <Pressable style={styles.checkoutAddMoreRow} onPress={handleCheckoutAddMoreFromMenu}>
                <MaterialIcons name="add" size={22} color={CHECKOUT_LIGHT_GREEN} />
                <ThemedText style={styles.checkoutAddMoreText}>Add more items</ThemedText>
              </Pressable>
            </View>

            <View style={[styles.checkoutCard, styles.checkoutPickupCard]}>
              <View style={styles.checkoutPickupHeaderRow}>
                <View style={styles.checkoutPickupAtLeft}>
                  <MaterialIcons name="place" size={17} color={CHECKOUT_LIGHT_GREEN} />
                  <ThemedText style={styles.checkoutPickupAtText}>PICKUP AT</ThemedText>
                </View>
                <Pressable onPress={handleCheckoutChangeStore} hitSlop={10}>
                  <ThemedText style={styles.checkoutPickupChange}>Change</ThemedText>
                </Pressable>
              </View>
              <View style={styles.checkoutPickupCenter}>
                <ThemedText style={styles.checkoutPickupStoreTitle}>{selectedLocation.name}</ThemedText>
                <ThemedText style={styles.checkoutPickupAddressCentered}>{selectedLocation.address}</ThemedText>
                <View style={styles.checkoutPickupStatusRow}>
                  <View
                    style={[
                      styles.checkoutStatusDot,
                      pickupStatus.tone === 'open'
                        ? styles.checkoutStatusDotOpen
                        : styles.checkoutStatusDotClosed,
                    ]}
                  />
                  <ThemedText
                    style={
                      pickupStatus.tone === 'open'
                        ? styles.checkoutPickupStatusOpen
                        : styles.checkoutPickupStatusClosed
                    }>
                    {pickupStatus.text}
                  </ThemedText>
                </View>
              </View>
              <View style={styles.checkoutReadyBox}>
                <MaterialIcons name="schedule" size={20} color={CHECKOUT_LIGHT_GREEN} />
                <ThemedText style={styles.checkoutReadyTextBold}>Est. ready in 8–12 min</ThemedText>
              </View>
            </View>

            <View style={styles.checkoutCard}>
              <ThemedText style={styles.checkoutCardTitle}>Payment</ThemedText>
              <Pressable style={styles.checkoutPaymentRow}>
                <View style={styles.checkoutPaymentLeft}>
                  <View style={styles.checkoutPaymentBrandIcon}>
                    <FontAwesome5 name="cc-visa" brand size={26} color="#1434CB" />
                  </View>
                  <ThemedText style={styles.checkoutPaymentLabel}>Visa ···· 4289</ThemedText>
                </View>
                <MaterialIcons name="chevron-right" size={22} color="#B8C4BE" />
              </Pressable>
              <Pressable style={styles.checkoutPaymentRow}>
                <View style={styles.checkoutPaymentLeft}>
                  <View style={styles.checkoutPaymentBrandIcon}>
                    <FontAwesome5 name="cc-apple-pay" brand size={26} color="#000000" />
                  </View>
                  <ThemedText style={styles.checkoutPaymentLabel}>Apple Pay</ThemedText>
                </View>
                <MaterialIcons name="chevron-right" size={22} color="#B8C4BE" />
              </Pressable>
            </View>

            <View style={[styles.checkoutCard, styles.checkoutRewardsCard]}>
              <View style={styles.checkoutRewardsHeader}>
                <View style={styles.checkoutRewardsIconCircle}>
                  <Text style={styles.checkoutRewardsEmoji}>🍊</Text>
                </View>
                <ThemedText style={styles.checkoutRewardsSectionTitle}>REWARDS</ThemedText>
              </View>
              <View style={styles.checkoutRewardsBodyRow}>
                <View style={styles.checkoutRewardsTextCol}>
                  <ThemedText style={styles.checkoutRewardsBalance}>
                    {rewardPts} points available
                  </ThemedText>
                  <ThemedText style={styles.checkoutRewardsSubtitle}>apply points as discount</ThemedText>
                </View>
                <Switch
                  value={applyRewardsDiscount}
                  onValueChange={setApplyRewardsDiscount}
                  trackColor={{ false: '#D5DED9', true: '#8FCEB3' }}
                  thumbColor="#FFFFFF"
                />
              </View>
            </View>

            <View style={[styles.checkoutCard, styles.checkoutSummaryCard]}>
              <View style={styles.checkoutSummaryRow}>
                <ThemedText style={styles.checkoutSummaryLabel}>Subtotal</ThemedText>
                <ThemedText style={styles.checkoutSummaryValue}>${subtotal.toFixed(2)}</ThemedText>
              </View>
              <View style={styles.checkoutSummaryRow}>
                <ThemedText style={styles.checkoutSummaryLabel}>Tax (8.75%)</ThemedText>
                <ThemedText style={styles.checkoutSummaryValue}>${taxAmount.toFixed(2)}</ThemedText>
              </View>
              <View style={styles.checkoutSummaryRow}>
                <ThemedText style={styles.checkoutSummaryLabel}>Rewards discount</ThemedText>
                <ThemedText style={styles.checkoutSummaryDiscount}>-$0.00</ThemedText>
              </View>
              <View style={styles.checkoutSummaryDivider} />
              <View style={styles.checkoutSummaryRow}>
                <ThemedText style={styles.checkoutSummaryTotalLabel}>Total</ThemedText>
                <ThemedText style={styles.checkoutSummaryTotalValue}>${orderTotal.toFixed(2)}</ThemedText>
              </View>
            </View>
          </ScrollView>

          <View
            style={[styles.checkoutStickyBar, { paddingBottom: Math.max(insets.bottom, 12) }]}
            pointerEvents="box-none">
            <Pressable
              style={[styles.checkoutPlaceOrderBtn, isSubmittingOrder && styles.checkoutPlaceOrderBtnDisabled]}
              onPress={submitOrderFromCheckout}
              disabled={isSubmittingOrder}>
              <ThemedText style={styles.checkoutPlaceOrderText}>
                Place order · ${orderTotal.toFixed(2)}
              </ThemedText>
            </Pressable>
          </View>
        </View>
          </Animated.View>
          {step === 'customize' &&
          selectedItem &&
          returnToCheckoutAfterCustomizeRef.current ? (
            <View style={styles.checkoutCustomizeOverlay}>{renderCustomizeSheetLayer()}</View>
          ) : null}
        </View>
      </Modal>
    );
  };

  const renderPickupStickyBar = () =>
    selectedLocation ? (
      <LinearGradient
        colors={['#006C45', '#0A8B57', '#13A25F']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.storeStickyBar}>
        <Pressable style={styles.storeStickyLeft} onPress={goBackToStoreSelection}>
          <View style={styles.storeStickyTextWrap}>
            <ThemedText style={styles.storeStickyLabel}>Pickup store</ThemedText>
            <View style={styles.storeStickyNameRow}>
              <ThemedText style={styles.storeStickyName} numberOfLines={1} ellipsizeMode="tail">
                {selectedLocation.name}
              </ThemedText>
              <MaterialIcons
                style={styles.storeStickyChevron}
                name="keyboard-arrow-down"
                size={20}
                color="#FFFFFF"
              />
            </View>
          </View>
        </Pressable>
        <Pressable
          ref={storeStickyBagRef}
          collapsable={false}
          style={styles.storeStickyBag}
          onPress={openCheckout}
          disabled={isSubmittingOrder}>
          <Animated.View style={{ transform: [{ scale: bagIconScale }] }}>
            <MaterialIcons name="shopping-bag" size={20} color="#FFFFFF" />
          </Animated.View>
          <View style={styles.storeStickyBadge}>
            <ThemedText style={styles.storeStickyBadgeText}>{cart.length}</ThemedText>
          </View>
        </Pressable>
      </LinearGradient>
    ) : null;

  return (
    <>
    <SafeAreaView style={styles.safeArea}>
      <ThemedView style={styles.container}>
        <View style={styles.content}>
          {(step === 'location' || step === 'category' || step === 'item' || step === 'customize') && (
            <View
              style={styles.storesBaseLayer}
              pointerEvents={step === 'location' ? 'auto' : 'none'}>
              {renderStoresStep()}
            </View>
          )}
          {(step === 'category' || step === 'item' || step === 'customize') && (
            <Animated.View
              style={[styles.orderFlowOverlay, { transform: [{ translateY: categorySlideY }] }]}>
              <View style={styles.orderOverlayBody}>
                <View style={styles.orderMenuStack}>
                  {(step === 'category' || step === 'item' || step === 'customize') && (
                    <View
                      style={styles.orderCategoryLayer}
                      pointerEvents={step === 'item' || step === 'customize' ? 'none' : 'auto'}>
                      <View style={styles.orderOverlayInnerPad}>
                        <View style={styles.orderOverlayHPad}>
                          {renderCategoryFlowHeader()}
                          {step === 'category' || step === 'item' || step === 'customize'
                            ? renderCategoryMenuTabs()
                            : null}
                        </View>
                        <View style={styles.orderCategoryMenuFill}>{renderCategoryMenuBody()}</View>
                      </View>
                    </View>
                  )}
                  {(step === 'item' || step === 'customize') && (
                    <Animated.View
                      style={[styles.orderItemOverlay, { transform: [{ translateX: itemSlideX }] }]}>
                      <View style={styles.orderOverlayInnerPad}>
                        {renderItemFlowHeader()}
                        <View style={styles.orderItemListWrap}>{renderItemListBody()}</View>
                      </View>
                    </Animated.View>
                  )}
                </View>
              </View>
              {renderPickupStickyBar()}
            </Animated.View>
          )}
        </View>
      </ThemedView>
      {cartFlyAnim ? (
        <View pointerEvents="none" style={styles.cartFlyOverlay}>
          <Animated.View
            style={[
              styles.cartFlyBubble,
              {
                left: cartFlyAnim.startLeft,
                top: cartFlyAnim.startTop,
                opacity: cartFlyBubbleOpacity,
                transform: [
                  { translateX: cartFlyAnim.translateX },
                  { translateY: cartFlyAnim.translateY },
                  { scale: cartFlyAnim.scale },
                ],
              },
            ]}>
            {cartFlyAnim.uri ? (
              <Image
                source={{ uri: cartFlyAnim.uri }}
                style={styles.cartFlyBubbleImage}
                contentFit="cover"
              />
            ) : (
              <View style={styles.cartFlyBubblePlaceholder} />
            )}
          </Animated.View>
        </View>
      ) : null}
    </SafeAreaView>
    {renderCheckoutScreen()}
    {renderCustomizeModal()}
    </>
  );
}

const styles = StyleSheet.create({
  cartFlyOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10000,
    elevation: 10000,
  },
  cartFlyBubble: {
    position: 'absolute',
    width: CART_FLY_BUBBLE_SIZE,
    height: CART_FLY_BUBBLE_SIZE,
    borderRadius: CART_FLY_BUBBLE_SIZE / 2,
    borderWidth: 3,
    borderColor: '#FF8A00',
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  cartFlyBubbleImage: {
    width: '100%',
    height: '100%',
  },
  cartFlyBubblePlaceholder: {
    flex: 1,
    backgroundColor: '#E8E8E8',
  },
  /** Transparent layer so the order screen stays visible to the left while the panel slides (vs opaque fullScreen modal). */
  checkoutModalBackdrop: {
    flex: 1,
    backgroundColor: 'transparent',
    position: 'relative',
  },
  /** Customize sheet when editing a line from checkout — must live inside checkout Modal (see `renderCustomizeSheetLayer`). */
  checkoutCustomizeOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    elevation: 1000,
  },
  checkoutSlidePanel: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: CHECKOUT_BG,
  },
  checkoutInner: {
    flex: 1,
  },
  checkoutHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 12,
  },
  checkoutHeaderSide: {
    width: 56,
    justifyContent: 'center',
  },
  checkoutHeaderTitleCenter: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '700',
    color: '#1D2823',
  },
  checkoutEditButton: {
    fontSize: 16,
    fontWeight: '600',
    color: CHECKOUT_LIGHT_GREEN,
  },
  checkoutScroll: {
    flex: 1,
  },
  checkoutScrollContent: {
    paddingHorizontal: 16,
    /** Small inset after the last card; avoid a large spacer View that made the list scroll far past the summary. */
    paddingBottom: 16,
    flexGrow: 0,
  },
  checkoutCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(26,37,32,0.08)',
    padding: 14,
    marginBottom: 12,
  },
  /** Tighter bottom inset so “Add more items” sits closer to the card edge. */
  checkoutOrderItemsCard: {
    paddingBottom: 6,
  },
  checkoutOrderItemsCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    /** Line rows render below but can win hit-testing; keep header above for Edit/Done. */
    zIndex: 2,
    elevation: 4,
    position: 'relative',
  },
  checkoutOrderItemsEditHit: {
    paddingVertical: 4,
    paddingLeft: 8,
  },
  checkoutOrderItemsCardTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#5A6B5F',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  checkoutCardTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#5A6B5F',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  checkoutLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  checkoutLineMain: {
    flex: 1,
    minWidth: 0,
  },
  checkoutLineMainInner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  checkoutLineActionsShell: {
    overflow: 'hidden',
    justifyContent: 'center',
  },
  checkoutLineActionsInner: {
    width: CHECKOUT_LINE_EDIT_ACTIONS_WIDTH,
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkoutLineActionCol: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Full-bleed within order-items card (`checkoutCard` horizontal padding 14). */
  checkoutItemDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(26,37,32,0.12)',
    marginHorizontal: -14,
  },
  checkoutLineImageWrap: {
    marginRight: 10,
  },
  checkoutLineImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#EEF2F0',
  },
  checkoutLineImagePlaceholder: {
    backgroundColor: '#E4EAE7',
  },
  checkoutLineBody: {
    flex: 1,
    minWidth: 0,
  },
  checkoutLineTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  checkoutLineName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#1D2823',
  },
  checkoutLinePrice: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1D2823',
  },
  checkoutLineSize: {
    marginTop: 2,
    fontSize: 13,
    color: '#8A9890',
  },
  checkoutTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  checkoutTag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  checkoutTagSupplement: {
    backgroundColor: '#E8F5EC',
  },
  checkoutTagAlteration: {
    backgroundColor: '#FFF4E0',
  },
  checkoutTagTextSupplement: {
    fontSize: 11,
    fontWeight: '600',
    color: '#0B6E3A',
  },
  checkoutTagTextAlteration: {
    fontSize: 11,
    fontWeight: '600',
    color: '#A66B00',
  },
  checkoutAddMoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginHorizontal: -14,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(26,37,32,0.12)',
  },
  checkoutAddMoreText: {
    fontSize: 15,
    fontWeight: '600',
    color: CHECKOUT_LIGHT_GREEN,
  },
  checkoutPickupCard: {
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  checkoutPickupHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  checkoutPickupAtLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  checkoutPickupAtText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8A9890',
    letterSpacing: 1.2,
  },
  checkoutPickupChange: {
    fontSize: 15,
    fontWeight: '700',
    color: CHECKOUT_LIGHT_GREEN,
  },
  checkoutPickupCenter: {
    alignItems: 'center',
    marginBottom: 16,
  },
  checkoutPickupStoreTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1D2823',
    textAlign: 'center',
  },
  checkoutPickupAddressCentered: {
    marginTop: 5,
    fontSize: 13,
    color: '#5A6B5F',
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 8,
  },
  checkoutPickupStatusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    gap: 8,
    paddingHorizontal: 4,
  },
  checkoutPickupStatusOpen: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4CAF50',
    textAlign: 'center',
    flexShrink: 1,
  },
  checkoutPickupStatusClosed: {
    fontSize: 14,
    fontWeight: '600',
    color: '#D64545',
    textAlign: 'center',
    flexShrink: 1,
  },
  checkoutStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  checkoutStatusDotOpen: {
    backgroundColor: '#4CAF50',
  },
  checkoutStatusDotClosed: {
    backgroundColor: '#D64545',
  },
  checkoutReadyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#EEF2F0',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    alignSelf: 'stretch',
  },
  checkoutReadyTextBold: {
    fontSize: 15,
    color: '#1D2823',
    fontWeight: '700',
  },
  checkoutPaymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F4F7F5',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 8,
  },
  checkoutPaymentLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  checkoutPaymentBrandIcon: {
    width: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  checkoutPaymentLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: '#1D2823',
  },
  checkoutRewardsCard: {
    borderRadius: 20,
    padding: 18,
  },
  checkoutRewardsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  checkoutRewardsIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FF8A00',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkoutRewardsEmoji: {
    fontSize: 22,
    lineHeight: 26,
  },
  checkoutRewardsSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8A9890',
    letterSpacing: 1.2,
  },
  checkoutRewardsBodyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  checkoutRewardsTextCol: {
    flex: 1,
    minWidth: 0,
  },
  checkoutRewardsBalance: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1D2823',
  },
  checkoutRewardsSubtitle: {
    marginTop: 4,
    fontSize: 14,
    color: '#5A6B5F',
    fontWeight: '400',
  },
  checkoutSummaryCard: {
    marginBottom: 0,
  },
  checkoutSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  checkoutSummaryLabel: {
    fontSize: 14,
    color: '#8A9890',
  },
  checkoutSummaryValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1D2823',
  },
  checkoutSummaryDiscount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0B6E3A',
  },
  checkoutSummaryDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(26,37,32,0.12)',
    marginVertical: 8,
  },
  checkoutSummaryTotalLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1D2823',
  },
  checkoutSummaryTotalValue: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1D2823',
  },
  checkoutStickyBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(26,37,32,0.08)',
    backgroundColor: CHECKOUT_BG,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  checkoutPlaceOrderBtn: {
    backgroundColor: PLACE_ORDER_GREEN,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  checkoutPlaceOrderBtnDisabled: {
    opacity: 0.6,
  },
  checkoutPlaceOrderText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: '#FFFFFF',
  },
  header: {
    marginBottom: 12,
  },
  itemHeaderWithFilters: {
    marginBottom: 0,
  },
  categoryHeader: {
    marginBottom: 4,
  },
  headerSubtitle: {
    marginTop: 4,
  },
  categoryHeaderTitle: {
    fontSize: 21,
    lineHeight: 25,
  },
  itemHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    position: 'relative',
    overflow: 'hidden',
    minHeight: 56,
    gap: 8,
  },
  itemHeaderTitleWrap: {
    flex: 1,
  },
  itemHeaderTitleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  itemHeaderTitle: {
    fontSize: 24,
    lineHeight: 28,
  },
  itemHeaderCount: {
    color: '#5B6761',
    fontSize: 18,
    fontWeight: '600',
  },
  itemHeaderSubtitle: {
    marginTop: 2,
    color: '#5B6761',
    fontSize: 14,
    lineHeight: 18,
  },
  subcategoryFiltersSection: {
    marginTop: 2,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#DDE4DF',
  },
  itemHeaderDividerOnly: {
    marginTop: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#DDE4DF',
  },
  subcategoryPillsRow: {
    paddingLeft: 16,
    paddingRight: 16,
    paddingBottom: 0,
    gap: 8,
  },
  subcategoryPill: {
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: '#EEF2EF',
  },
  subcategoryPillContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  subcategoryPillSelected: {
    backgroundColor: '#0F9D58',
  },
  subcategoryPillText: {
    color: '#1D2823',
    fontWeight: '600',
    fontSize: 14,
  },
  subcategoryPillTextSelected: {
    color: '#FFFFFF',
  },
  content: {
    flex: 1,
    marginBottom: 0,
    position: 'relative',
  },
  storesBaseLayer: {
    flex: 1,
    zIndex: 0,
  },
  /** Full-width sheet over stores (negates container horizontal padding). */
  orderFlowOverlay: {
    position: 'absolute',
    left: -16,
    right: -16,
    top: 0,
    bottom: 0,
    backgroundColor: '#FFFFFF',
    zIndex: 2,
    flexDirection: 'column',
  },
  /** Column fill for order overlay; horizontal inset is on individual children (orderOverlayHPad), not here, so carousels can be full width. */
  orderOverlayInnerPad: {
    flex: 1,
    minHeight: 0,
  },
  /** Standard 16px horizontal inset for headers, tabs, and non-carousel blocks inside the order sheet. */
  orderOverlayHPad: {
    paddingHorizontal: 16,
  },
  orderOverlayBody: {
    flex: 1,
    minHeight: 0,
  },
  orderMenuStack: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
  },
  /** Always flex (never absolute) so layout doesn’t jump when the item overlay mounts/unmounts. */
  orderCategoryLayer: {
    flex: 1,
    minHeight: 0,
  },
  orderCategoryMenuFill: {
    flex: 1,
  },
  /** Slides horizontally over the category underlay. */
  orderItemOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FFFFFF',
    zIndex: 2,
  },
  orderItemListWrap: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 16,
  },
  listContentSmoothie: {
    paddingTop: 0,
  },
  smoothieListTopSpacer: {
    height: 16,
  },
  categoryListTopSpacer: {
    height: 16,
  },
  itemGridRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 24,
  },
  itemGridCell: {
    alignItems: 'center',
  },
  /** Same width as itemGridImageWrap so title/description don’t extend past the image. */
  itemGridTextBlock: {
    marginTop: 6,
    width: 132,
    alignSelf: 'center',
  },
  itemGridImageWrap: {
    width: 132,
    height: 132,
    borderRadius: 66,
    overflow: 'hidden',
    backgroundColor: '#0F5A44',
  },
  itemGridImage: {
    width: '100%',
    height: '100%',
  },
  itemGridName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1A2520',
    textAlign: 'center',
  },
  itemGridDescription: {
    marginTop: 2,
    fontSize: 13,
    lineHeight: 18,
    color: '#6A746F',
    textAlign: 'center',
  },
  juiceBuildNoMatchText: {
    fontSize: 15,
    color: '#6A746F',
    width: '100%',
  },
  juiceIngredientGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 12,
    rowGap: 20,
    marginTop: 32,
    justifyContent: 'flex-start',
  },
  juiceIngredientGridCell: {
    alignItems: 'center',
  },
  juiceIngredientCircleWrap: {
    alignItems: 'center',
    marginBottom: 4,
  },
  /** Orange ring + light Blenders green fill (selected). */
  juiceIngredientCircleRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FF8A00',
    padding: 3,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  juiceIngredientCircleInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#0A8B57',
    alignItems: 'center',
    justifyContent: 'center',
  },
  juiceIngredientCircleGrey: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#E8EEEA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  juiceIngredientEmoji: {
    fontSize: 26,
    lineHeight: 30,
  },
  juiceIngredientEmojiMuted: {
    fontSize: 26,
    lineHeight: 30,
    opacity: 0.62,
  },
  juiceIngredientCheckBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#0A8B57',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  juiceBlendCard: {
    marginTop: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5ECE8',
    backgroundColor: '#FAFCFB',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  /** Same as customizeSectionLabel, slightly smaller; title is left-aligned in card. */
  juiceBlendTitle: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    color: '#8F9A94',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    textAlign: 'left',
    marginBottom: 10,
  },
  juiceBlendChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  juiceBlendChip: {
    borderRadius: 999,
    backgroundColor: '#E7F4EE',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  juiceBlendChipText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
    color: '#1B5C40',
  },
  juiceIngredientLabelSelected: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1A2520',
    textAlign: 'center',
  },
  juiceIngredientLabelIdle: {
    fontSize: 13,
    fontWeight: '500',
    color: '#8A9590',
    textAlign: 'center',
  },
  storesTopBlock: {
    position: 'relative',
  },
  searchIconButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5ECE6',
    zIndex: 3,
  },
  /** Store tab bar: same control as header search, stacked above overlay. */
  storeSearchIconButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5ECE6',
    zIndex: 3,
    flexShrink: 0,
    marginLeft: 8,
  },
  iconStack: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconOverlay: {
    position: 'absolute',
  },
  itemSearchOverlay: {
    position: 'absolute',
    left: 46,
    right: 46,
    top: 0,
    bottom: 0,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    zIndex: 2,
  },
  searchInput: {
    borderWidth: 0,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 7,
    color: '#20302A',
    fontSize: 16,
  },
  searchInputExpanded: {
    borderWidth: 1,
    borderColor: '#D6DED9',
    paddingHorizontal: 10,
  },
  noStoresText: {
    marginTop: 8,
    marginBottom: 6,
    color: '#5B6761',
  },
  storeTabsSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
    minHeight: 48,
    marginTop: 2,
    marginBottom: 0,
    marginHorizontal: -16,
    paddingLeft: 16,
    paddingRight: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E3E9E5',
  },
  /** Slides in over the tab labels; right inset clears icon (38) + margin (8) + gap so the field isn’t under the button. */
  storeTabsSearchOverlay: {
    position: 'absolute',
    left: 16,
    right: 58,
    top: 0,
    bottom: 0,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    zIndex: 2,
  },
  /** TextInput respects overlay width so the border doesn’t extend past the reserved icon column. */
  storeTabsSearchInput: {
    alignSelf: 'stretch',
  },
  storeTabsRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    minWidth: 0,
    gap: 4,
  },
  storeTabButton: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    minWidth: 0,
    alignItems: 'center',
  },
  storeTabButtonActive: {
    borderBottomWidth: 3,
    borderBottomColor: '#0F9D58',
  },
  storeTabButtonText: {
    color: '#6A746F',
    fontWeight: '700',
    fontSize: 16,
  },
  storeTabButtonTextActive: {
    color: '#1D2823',
  },
  emptyStateWrap: {
    paddingVertical: 28,
    paddingHorizontal: 10,
  },
  emptyStateText: {
    color: '#5B6761',
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
  },
  locationStep: {
    flex: 1,
  },
  storesList: {
    flex: 1,
  },
  storesListContent: {
    paddingTop: 8,
    paddingBottom: 8,
    paddingHorizontal: 2,
  },
  fulfillmentToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  fulfillmentPill: {
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D9E4DE',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  fulfillmentPillActive: {
    backgroundColor: '#0F9D58',
    borderColor: '#0F9D58',
  },
  fulfillmentText: {
    color: '#4B5B52',
    fontWeight: '600',
  },
  fulfillmentActiveText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  skipPill: {
    marginLeft: 'auto',
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  skipText: {
    color: '#0F9D58',
    fontWeight: '700',
  },
  card: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardSelected: {
    borderWidth: 1,
    borderColor: '#0F9D58',
  },
  mapCard: {
    height: 280,
    borderRadius: 0,
    overflow: 'hidden',
    marginBottom: 8,
    marginHorizontal: -16,
  },
  tabsDividerShadow: {
    position: 'absolute',
    left: -16,
    right: -16,
    bottom: -10,
    height: 10,
    backgroundColor: 'transparent',
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 5 },
    elevation: 10,
  },
  map: {
    flex: 1,
  },
  filterPill: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 18,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  filterText: {
    color: '#1F2A24',
    fontWeight: '700',
    fontSize: 16,
  },
  markerDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#0F9D58',
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  selectedMarkerPin: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedMarkerBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#FF8A00',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  selectedMarkerBadgeIcon: {
    fontSize: 18,
    lineHeight: 20,
  },
  selectedMarkerTip: {
    marginTop: -2,
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 11,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#FF8A00',
  },
  mapEmptyOverlay: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  mapEmptyText: {
    fontSize: 12,
    color: '#4E5A54',
  },
  storeTabs: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E5EAE7',
  },
  storeTab: {
    color: '#6A746F',
    fontWeight: '700',
    fontSize: 21,
    paddingVertical: 12,
  },
  storeTabActive: {
    color: '#1A2520',
    borderBottomWidth: 3,
    borderBottomColor: '#0F9D58',
  },
  storeRow: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E7ECEA',
  },
  storeRowSelected: {
    borderColor: '#0F9D58',
    backgroundColor: STORE_ROW_SELECTED_BG,
  },
  storeRowTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  storeIcons: {
    flexDirection: 'row',
    gap: 6,
  },
  storeIconButton: {
    padding: 2,
  },
  storeTitle: {
    fontSize: 18,
    lineHeight: 20,
    fontWeight: '800',
    color: '#1C2520',
    flex: 1,
    marginRight: 8,
  },
  storeRowMiddle: {
    position: 'relative',
    marginTop: 4,
    minHeight: STORE_ORDER_SCRIM_HEIGHT,
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  /** Full card width; ellipsis uses this width only (button overlaps on top). */
  storeRowTextBlock: {
    alignSelf: 'stretch',
    width: '100%',
  },
  storeAddress: {
    fontSize: 13,
    lineHeight: 20,
    color: '#2B342F',
  },
  storeMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: -2,
  },
  storeStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    flexShrink: 0,
  },
  storeStatusDotOpen: {
    backgroundColor: '#4CAF50',
  },
  storeStatusDotClosed: {
    backgroundColor: '#D64545',
  },
  storeMeta: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 20,
    color: '#2B342F',
  },
  storeMetaOpen: {
    color: '#4CAF50',
    fontWeight: '600',
  },
  storeMetaClosed: {
    color: '#D64545',
    fontWeight: '600',
  },
  storeOrderButtonOverlap: {
    position: 'absolute',
    // Flush with card edge; storeRow uses padding: 14 so content’s right is inset otherwise.
    right: -14,
    top: 0,
    bottom: 0,
    width: STORE_ORDER_BUTTON_CLIP_W,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  storeOrderButtonSlideWrap: {
    width: STORE_ORDER_BUTTON_CLIP_W,
    height: STORE_ORDER_SCRIM_HEIGHT,
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'flex-end',
  },
  storeOrderButtonWithFade: {
    width: STORE_ORDER_BUTTON_CLIP_W,
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'flex-end',
    height: STORE_ORDER_SCRIM_HEIGHT,
  },
  storeOrderFadeGradient: {
    width: STORE_ORDER_FADE_GRADIENT_W,
    height: STORE_ORDER_SCRIM_HEIGHT,
  },
  /** Mint only behind strip + pill (intrinsic width); no extra wide band left of the button. */
  storeOrderMintBackdrop: {
    flexShrink: 0,
    height: STORE_ORDER_SCRIM_HEIGHT,
    backgroundColor: STORE_ROW_SELECTED_BG,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  /** Narrow band after fade; same fill as backdrop so text cannot show through gaps. */
  storeOrderScrimStrip: {
    width: STORE_ORDER_SCRIM_SOLID_W,
    alignSelf: 'stretch',
    backgroundColor: STORE_ROW_SELECTED_BG,
  },
  storeOrderButtonRightSpacer: {
    width: STORE_ORDER_BUTTON_RIGHT_SPACER_W,
    alignSelf: 'stretch',
    backgroundColor: STORE_ROW_SELECTED_BG,
  },
  storeOrderButton: {
    flexShrink: 0,
    minWidth: STORE_ORDER_BUTTON_MIN_W,
    borderRadius: 999,
    backgroundColor: '#0F9D58',
    borderWidth: 1,
    borderColor: '#0F9D58',
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeOrderButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
    lineHeight: 16,
    includeFontPadding: false,
  },
  locationPromptWrap: {
    paddingVertical: 4,
  },
  locationPrompt: {
    color: '#5E6A63',
    textAlign: 'center',
    marginBottom: 8,
  },
  locationCta: {
    marginTop: 4,
    backgroundColor: '#0F9D58',
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationCtaText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
  },
  cardLine: {
    marginTop: 2,
  },
  cardPrice: {
    marginTop: 6,
    fontWeight: '600',
  },
  menuCategoryContent: {
    paddingTop: 16,
    paddingBottom: 10,
  },
  categoryMenuTabsBar: {
    marginTop: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E3E9E5',
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  categoryMenuTabsRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    minWidth: 0,
    gap: 4,
  },
  /** Slides in over Menu / Favorites; insets keep field off screen edges and clear of the icon button. */
  categoryMenuSearchOverlay: {
    position: 'absolute',
    left: 12,
    right: 56,
    top: 0,
    bottom: 0,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    zIndex: 2,
  },
  categoryMenuSearchInput: {
    alignSelf: 'stretch',
    minWidth: 0,
  },
  categoryMenuSearchInputExpanded: {
    paddingLeft: 12,
    paddingRight: 12,
  },
  categoryMenuSearchIconButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5ECE6',
    zIndex: 3,
    flexShrink: 0,
    marginLeft: 8,
  },
  categoryStepWrap: {
    flex: 1,
    position: 'relative',
  },
  categoryHeaderDivider: {
    height: 1,
    backgroundColor: '#E3E9E5',
  },
  categoryHeaderDividerShadow: {
    position: 'absolute',
    top: 1,
    left: 0,
    right: 0,
    height: 14,
    zIndex: 2,
  },
  menuCategorySection: {
    marginBottom: 16,
    paddingBottom: 6,
  },
  menuCategoryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  menuCategoryTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  menuSeeAll: {
    color: '#0F9D58',
    fontWeight: '700',
    fontSize: 16,
  },
  noFeaturedText: {
    color: '#6A746F',
    fontSize: 13,
  },
  menuCarouselRow: {
    gap: 10,
    paddingLeft: 16,
    paddingRight: 16,
  },
  menuCarouselItem: {
    width: 130,
    alignItems: 'center',
  },
  menuCarouselImageRing: {
    width: 116,
    height: 116,
    borderRadius: 58,
    borderWidth: 3,
    borderColor: '#E8F5EE',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  menuCarouselImage: {
    width: 110,
    height: 110,
    borderRadius: 55,
    overflow: 'hidden',
  },
  menuCarouselName: {
    marginTop: 8,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '500',
    color: '#1A2520',
  },
  menuCarouselPrice: {
    marginTop: -1,
    textAlign: 'center',
    fontSize: 11,
    color: '#97A29C',
    fontWeight: '500',
  },
  shotGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
  },
  shotGridCard: {
    width: '31%',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2EAE5',
    backgroundColor: '#F8FBF9',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  shotGridImageWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#E8F5EE',
  },
  shotGridImage: {
    width: '100%',
    height: '100%',
  },
  shotGridName: {
    marginTop: 8,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
    color: '#1A2520',
  },
  shotGridPrice: {
    marginTop: -1,
    textAlign: 'center',
    fontSize: 11,
    color: '#97A29C',
    fontWeight: '500',
  },
  juiceBuildCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2EAE5',
    backgroundColor: '#F8FBF9',
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  juiceBuildImageWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    overflow: 'hidden',
    backgroundColor: '#E8F5EE',
  },
  juiceBuildImage: {
    width: '100%',
    height: '100%',
  },
  juiceBuildTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  juiceBuildTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A2520',
  },
  juiceBuildSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: '#70807A',
    lineHeight: 17,
  },
  juiceBuildPrice: {
    marginTop: 1,
    fontSize: 11,
    color: '#97A29C',
    fontWeight: '500',
  },
  wellnessBanner: {
    borderRadius: 16,
    overflow: 'hidden',
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  wellnessDecorCircleLg: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    right: -45,
    top: -40,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  wellnessDecorCircleSm: {
    position: 'absolute',
    width: 72,
    height: 72,
    borderRadius: 36,
    right: 32,
    bottom: -28,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  wellnessLabel: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 12,
    fontWeight: '600',
  },
  wellnessTitle: {
    marginTop: 3,
    color: '#FFFFFF',
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '800',
    maxWidth: '82%',
  },
  wellnessMetaRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  wellnessCount: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    fontWeight: '600',
  },
  wellnessFromPrice: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 11,
    fontWeight: '500',
  },
  menuItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 10,
  },
  menuItemRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#DDE4DF',
    paddingBottom: 10,
  },
  menuItemRowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
  },
  menuItemNameFlex: {
    flex: 1,
  },
  menuItemFavoriteButton: {
    padding: 4,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 2,
  },
  cardTitlePressable: {
    flex: 1,
    minWidth: 0,
  },
  cardFavoriteButton: {
    padding: 2,
    marginTop: -2,
  },
  menuItemImageWrap: {
    width: 58,
    height: 58,
    borderRadius: 29,
    overflow: 'hidden',
    backgroundColor: '#0F5A44',
  },
  menuItemImage: {
    width: '100%',
    height: '100%',
  },
  menuItemImagePlaceholder: {
    backgroundColor: '#DDE9E3',
  },
  menuItemName: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1A2520',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  categoryTile: {
    flexBasis: '48%',
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  customizeModalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  customizeModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  customizeModalSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
    flexDirection: 'column',
  },
  customizeModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8EEEA',
    backgroundColor: '#FFFFFF',
  },
  customizeModalHeaderSpacer: {
    flex: 1,
  },
  customizeSheetInner: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
    backgroundColor: '#FFFFFF',
  },
  customizeScroll: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  customizeScrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingBottom: 128,
  },
  customizeHeroWrap: {
    alignItems: 'center',
    marginTop: 4,
  },
  customizeHeroImage: {
    width: 220,
    height: 220,
    borderRadius: 110,
    overflow: 'hidden',
    backgroundColor: '#F2F4F3',
  },
  customizeHeroImagePlaceholder: {
    backgroundColor: '#E5ECE8',
  },
  customizeItemTitle: {
    marginTop: 8,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '800',
    color: '#1A2520',
    textAlign: 'center',
  },
  customizeItemDescription: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: '#95A19B',
    textAlign: 'center',
  },
  customizeJuiceBuildSubtitle: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 21,
    color: '#5B6761',
    textAlign: 'center',
  },
  customizeSection: {
    marginTop: 22,
  },
  customizeSectionLabel: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: '#8F9A94',
    textTransform: 'uppercase',
    letterSpacing: 2,
    textAlign: 'center',
  },
  customizeEmptySizes: {
    marginTop: 12,
    color: '#6A746F',
    fontSize: 15,
  },
  customizeSizeRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    marginTop: 12,
    backgroundColor: '#F7F9F8',
    borderRadius: 18,
    padding: 6,
    paddingRight: 8,
    position: 'relative',
    overflow: 'hidden',
  },
  customizeSizeColumn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    paddingVertical: 9,
    zIndex: 2,
  },
  customizeSizeSlider: {
    position: 'absolute',
    top: 6,
    bottom: 6,
    left: 6,
    borderRadius: 14,
    backgroundColor: '#FF8A00',
    zIndex: 1,
  },
  customizeSizeOzText: {
    fontSize: 17,
    lineHeight: 21,
    fontWeight: '700',
    color: '#8F9A94',
    textAlign: 'center',
  },
  customizeSizeOzTextSelected: {
    color: '#FFFFFF',
  },
  customizeSizePriceText: {
    marginTop: 2,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '600',
    color: '#B0B9B4',
    textAlign: 'center',
  },
  customizeSizePriceTextSelected: {
    color: '#FFFFFF',
  },
  customizeSupplementsCard: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#E4EAE7',
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  customizeSupplementsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  customizeSupplementsHeaderDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E8EEEA',
  },
  customizeSupplementsHeaderTitle: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '700',
    color: '#1A2520',
  },
  customizeSupplementsHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  customizeSupplementsHelperBadge: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: '#2B6C52',
    backgroundColor: '#E7F4EE',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  customizeSupplementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8EEEA',
  },
  customizeSupplementTextWrap: {
    flex: 1,
    minWidth: 0,
    paddingRight: 10,
  },
  customizeSupplementName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A2520',
  },
  customizeSupplementPrice: {
    marginTop: 3,
    fontSize: 14,
    fontWeight: '600',
    color: '#87928C',
  },
  customizeSupplementPriceRow: {
    marginTop: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  customizeSupplementPriceOriginal: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7A8680',
    textDecorationLine: 'line-through',
  },
  customizeSupplementCounter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  customizeSupplementCounterButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#D6DED9',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  customizeSupplementCounterButtonFilled: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0A8B57',
  },
  customizeSupplementCounterValue: {
    minWidth: 18,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '700',
    color: '#1A2520',
  },
  customizeSupplementSummaryChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    backgroundColor: '#FAFCFB',
  },
  customizeSupplementSummaryChip: {
    borderRadius: 999,
    backgroundColor: '#ECF8F2',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  customizeSupplementSummaryChipText: {
    color: '#225944',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
  },
  customizeAlterationRemoveChip: {
    backgroundColor: '#FDECEC',
  },
  customizeAlterationRemoveChipText: {
    color: '#A33A3A',
  },
  customizeAlterationsSection: {
    marginTop: 10,
  },
  customizeSpecialInstructionsInput: {
    marginTop: 10,
    minHeight: 58,
    maxHeight: 120,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E3E9E5',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
    fontSize: 16,
    color: '#1A2520',
    textAlignVertical: 'top',
  },
  customizeCostCard: {
    marginTop: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5ECE8',
    backgroundColor: '#FAFCFB',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  customizeCostRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  customizeCostSubRow: {
    marginTop: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  customizeCostLabel: {
    flex: 1,
    fontSize: 14,
    lineHeight: 18,
    color: '#55635C',
    fontWeight: '600',
  },
  customizeCostValue: {
    fontSize: 14,
    lineHeight: 18,
    color: '#1A2520',
    fontWeight: '600',
  },
  customizeCostSubLabel: {
    flex: 1,
    fontSize: 14,
    lineHeight: 18,
    color: '#55635C',
    fontWeight: '600',
  },
  customizeCostSubValue: {
    fontSize: 14,
    lineHeight: 18,
    color: '#1A2520',
    fontWeight: '600',
  },
  customizeCostDivider: {
    marginTop: 10,
    marginBottom: 10,
    height: 1,
    backgroundColor: '#E6ECE8',
  },
  customizeCostTotalLabel: {
    fontSize: 16,
    lineHeight: 20,
    color: '#1A2520',
    fontWeight: '600',
  },
  customizeCostTotalValue: {
    fontSize: 16,
    lineHeight: 20,
    color: '#1A2520',
    fontWeight: '800',
  },
  customizeStickyAddWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 12,
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 0,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -2 },
    elevation: 8,
  },
  customizeAddPill: {
    backgroundColor: '#0A8B57',
    paddingVertical: 14,
    paddingHorizontal: 22,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  supplementsOverlayRoot: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-start',
    zIndex: 12,
    backgroundColor: 'transparent',
  },
  supplementsModalSheet: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    maxHeight: undefined,
    paddingTop: 8,
  },
  supplementsModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#E7EDE9',
    paddingHorizontal: 18,
    paddingBottom: 10,
  },
  supplementsModalTitle: {
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '800',
    color: '#1A2520',
  },
  supplementsModalSubtitle: {
    marginTop: 2,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: '#7B8881',
  },
  supplementsModalList: {
    flex: 1,
  },
  supplementsModalListContent: {
    paddingHorizontal: 18,
    paddingTop: 4,
    paddingBottom: 94,
  },
  /** Alterations list: no horizontal padding so section title bands are edge-to-edge. */
  alterationsModalListContent: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 94,
  },
  alterationsSectionBlock: {
    marginTop: 0,
  },
  alterationsSectionBlockSpaced: {
    marginTop: 10,
  },
  alterationsSectionTitleBand: {
    width: '100%',
    alignSelf: 'stretch',
    backgroundColor: '#FAFCFB',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#E7EDE9',
  },
  alterationsSectionTitleBandFirst: {
    borderTopWidth: 0,
  },
  alterationsSectionTitle: {
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 2,
    color: '#8F9A94',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  alterationsModalItemRow: {
    paddingHorizontal: 18,
  },
  alterationsModalItemRowLast: {
    borderBottomWidth: 0,
  },
  alterationToggleTrack: {
    width: 46,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#E8EEEA',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  alterationToggleTrackSelected: {
    backgroundColor: '#0A8B57',
  },
  alterationToggleThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  alterationToggleThumbSelected: {
    alignSelf: 'flex-end',
  },
  supplementsModalStickyFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 10,
    paddingHorizontal: 16,
    paddingBottom: 0,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E7EDE9',
    alignItems: 'center',
  },
  supplementsModalConfirmButton: {
    backgroundColor: '#0A8B57',
    width: '100%',
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  supplementsModalConfirmButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '800',
  },
  customizeAddPillDisabled: {
    opacity: 0.45,
  },
  customizeAddPillText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 16,
  },
  cartBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  cartLine: {
    marginTop: 2,
  },
  checkoutButton: {
    backgroundColor: '#FF8A00',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  checkoutButtonDisabled: {
    opacity: 0.7,
  },
  checkoutText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  storeStickyBar: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    marginBottom: 0,
    marginHorizontal: 0,
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  storeStickyLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  storeStickyTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  storeStickyNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    minWidth: 0,
  },
  storeStickyLabel: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
  },
  storeStickyName: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
    flexShrink: 1,
    minWidth: 0,
  },
  storeStickyChevron: {
    marginLeft: 2,
    marginRight: 0,
    flexShrink: 0,
  },
  storeStickyBag: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 0,
    backgroundColor: '#FF8A00',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  storeStickyBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: '#054A2E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeStickyBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    lineHeight: 10,
    fontWeight: '700',
    textAlign: 'center',
  },
});

