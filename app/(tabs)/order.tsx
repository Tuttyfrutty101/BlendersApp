import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import {
  Alert,
  Animated,
  Easing,
  FlatList,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
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

type Step = 'location' | 'category' | 'item' | 'customize';

type Location = {
  id: string;
  name: string;
  address: string;
  hours_weekday: string;
  hours_weekend: string;
  latitude: number | null;
  longitude: number | null;
};

type CategoryId = 'smoothie' | 'bowl' | 'shot' | 'juice' | 'focused health blend';

type MenuItem = {
  id: string;
  name: string;
  description: string;
  category: CategoryId;
  featured: boolean;
  image_url: string | null;
  sizes: number[];
  prices: Record<string, number>;
};

type CartItem = {
  id: string;
  name: string;
  /** Fluid ounces for this line item. */
  size: number;
  supplements: string[];
  price: number;
};

type Supplement = {
  id: string;
  name: string;
  price: number;
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

function normalizeMenuItemRow(row: {
  id: string;
  name: string;
  description: string;
  category: string;
  featured?: boolean;
  image_url?: string | null;
  sizes?: unknown;
  prices?: unknown;
}): MenuItem {
  const rawSizes = Array.isArray(row.sizes) ? row.sizes : [];
  const sizes = rawSizes
    .map((s) => (typeof s === 'number' ? s : Number(s)))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category as CategoryId,
    featured: row.featured === true,
    image_url: typeof row.image_url === 'string' ? row.image_url : null,
    sizes,
    prices: normalizePrices(row.prices),
  };
}

function priceForOz(prices: Record<string, number>, oz: number): number {
  return prices[String(oz)] ?? 0;
}

function sortedSizes(item: MenuItem): number[] {
  return [...item.sizes].sort((a, b) => a - b);
}

function parseTimeValue(token: string): number | null {
  const trimmed = token.trim().toLowerCase();
  const m = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(a|am|p|pm)?$/i);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const suffix = m[3];
  if (hour > 23 || minute > 59) return null;
  if (suffix) {
    const isPm = suffix.startsWith('p');
    const isAm = suffix.startsWith('a');
    if (isPm && hour < 12) hour += 12;
    if (isAm && hour === 12) hour = 0;
  }
  return hour * 60 + minute;
}

function isStoreOpenNow(hoursText: string, now: Date): boolean | null {
  const clean = hoursText.trim().toLowerCase().replace(/\s+/g, ' ');
  const rangeMatch = clean.match(/(\d{1,2}(?::\d{2})?\s*(?:a|am|p|pm)?)\s*[-–]\s*(\d{1,2}(?::\d{2})?\s*(?:a|am|p|pm)?)/i);
  if (!rangeMatch) return null;
  const open = parseTimeValue(rangeMatch[1]);
  const close = parseTimeValue(rangeMatch[2]);
  if (open == null || close == null) return null;
  const current = now.getHours() * 60 + now.getMinutes();
  if (close < open) {
    return current >= open || current <= close;
  }
  return current >= open && current <= close;
}

function displayHoursForToday(location: Location, now: Date): { label: string; isOpen: boolean | null } {
  const day = now.getDay();
  const isWeekend = day === 0 || day === 6;
  const label = isWeekend ? location.hours_weekend : location.hours_weekday;
  return { label, isOpen: isStoreOpenNow(label, now) };
}

function formatHoursInline(hoursText: string): string {
  return hoursText.replace(/\s*[-–]\s*/g, '–');
}

function normalizeStoreRow(row: {
  id: string;
  name: string;
  address: string;
  hours_weekday: string;
  hours_weekend: string;
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
    hours_weekday: row.hours_weekday,
    hours_weekend: row.hours_weekend,
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

  const hoursForToday = displayHoursForToday(item, now);
  const status = hoursForToday.isOpen === false ? 'Closed' : 'Open';

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
          <ThemedText
            style={styles.storeMeta}
            numberOfLines={1}
            ellipsizeMode="tail">
            {status} {formatHoursInline(hoursForToday.label)}
          </ThemedText>
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
  const [selectedSupplements, setSelectedSupplements] = useState<string[]>([]);
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
  const [isLoadingMenuCategories, setIsLoadingMenuCategories] = useState(false);
  const [supplements, setSupplements] = useState<Supplement[]>([]);
  const [supplementsSectionExpanded, setSupplementsSectionExpanded] = useState(false);

  /** Full-screen menu layer slides vertically (store pickup → categories, back). */
  const categorySlideY = useRef(new Animated.Value(0)).current;
  /** Item list slides horizontally over the category menu. */
  const itemSlideX = useRef(new Animated.Value(0)).current;
  /** Customize bottom sheet: translateY (off-screen = windowHeight → visible = 0). */
  const customizeSheetTranslateY = useRef(new Animated.Value(0)).current;
  /** Customize opened from category menu (featured/favorites) — item overlay stays off-screen; back returns to category. */
  const openedCustomizeFromCategoryOnlyRef = useRef(false);

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
    });
  };

  const goBackToStoreSelection = () => {
    if (step === 'customize') {
      dismissCustomizeModal(() => {
        setSelectedItem(null);
        setSelectedSizeOz(null);
        setSelectedSupplements([]);
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

  const currentItemTotal =
    selectedItem != null && selectedSizeOz != null
      ? priceForOz(selectedItem.prices, selectedSizeOz) +
        selectedSupplements.reduce((sum, id) => {
          const sup = supplements.find((s) => s.id === id);
          return sum + (sup?.price ?? 0);
        }, 0)
      : 0;

  const cartTotal = cart.reduce((sum, item) => sum + item.price, 0);
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
    const loadStores = async () => {
      setIsLoadingLocations(true);
      const { data, error } = await supabase
        .from('stores')
        .select('id, name, address, hours_weekday, hours_weekend, latitude, longitude')
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
      .select('id, name, description, category, featured, image_url, sizes, prices')
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
    setCategoryListTab('menu');
    // Same data as the overview (`loadMenuCategorySections`) — filter synchronously so the list is ready during the slide.
    const items = menuItemsByCategory
      .filter((item) => item.category === category)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
    setCategoryItems(items);
    setStep('item');
    animateItemInFromRight();
  };

  const goBackFromCustomize = () => {
    dismissCustomizeModal(() => {
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
    setSelectedItem(item);
    const sizes = sortedSizes(item);
    setSelectedSizeOz(sizes.at(-1) ?? null);
    setSelectedSupplements([]);
    setSupplementsSectionExpanded(false);
    if (step === 'category') {
      openedCustomizeFromCategoryOnlyRef.current = true;
      itemSlideX.setValue(windowWidth);
    } else {
      openedCustomizeFromCategoryOnlyRef.current = false;
    }
    setStep('customize');
  };

  const toggleSupplement = (id: string) => {
    setSelectedSupplements((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  };

  const handleAddToCart = () => {
    if (!selectedItem || selectedSizeOz == null) return;

    const newItem: CartItem = {
      id: `${selectedItem.id}-${Date.now()}`,
      name: selectedItem.name,
      size: selectedSizeOz,
      supplements: selectedSupplements,
      price: Number(currentItemTotal.toFixed(2)),
    };

    dismissCustomizeModal(() => {
      openedCustomizeFromCategoryOnlyRef.current = false;
      setCart((prev) => [...prev, newItem]);
      setStep('category');
      animateCategoryInFromTop();
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

  const handleCheckout = async () => {
    if (cart.length === 0) {
      Alert.alert('Your cart is empty', 'Add at least one item before checking out.');
      return;
    }

    if (!selectedLocation) {
      Alert.alert('Choose a location', 'Please select a store location before checkout.');
      setStep('location');
      return;
    }

    setIsSubmittingOrder(true);

    try {
      const userId = await getOrCreateUserId();

      const itemsPayload = cart.map((item) => ({
        name: item.name,
        size: item.size,
        supplements: item.supplements,
        price: item.price,
      }));

      const { error } = await supabase.from('orders').insert({
        user_id: userId,
        location: selectedLocation.name,
        items: itemsPayload,
        total: Number(cartTotal.toFixed(2)),
        status: 'placed',
      });

      if (error) {
        throw error;
      }

      setCart([]);
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

  const renderCategoryFlowHeader = () => (
    <View style={[styles.header, styles.categoryHeader]}>
      <ThemedText type="title" style={styles.categoryHeaderTitle}>
        What are you craving?
      </ThemedText>
    </View>
  );

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
      <View style={styles.header}>
        <View style={styles.itemHeaderRow}>
          <Pressable style={styles.searchIconButton} onPress={goBackFromItemList}>
            <MaterialIcons name="arrow-back" size={22} color="#5A6B5F" />
          </Pressable>
          <View style={styles.itemHeaderTitleWrap}>
            <ThemedText type="title" style={styles.itemHeaderTitle}>
              {categoryTitle}
            </ThemedText>
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
    );
  };

  const renderCategoryMenuBody = () => {
    if (isLoadingMenuCategories) {
      return <ThemedText>Loading menu...</ThemedText>;
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
                <View style={styles.emptyStateWrap}>
                  <ThemedText style={styles.emptyStateText}>
                    You don&apos;t have any favorite menu items yet. Tap the heart on an item to add one.
                  </ThemedText>
                </View>
              ) : filteredFavoriteItems.length === 0 ? (
                <View style={styles.emptyStateWrap}>
                  <ThemedText style={styles.emptyStateText}>No favorites match your search.</ThemedText>
                </View>
              ) : (
                <View style={styles.menuCategorySection}>
                  {filteredFavoriteItems.map((item) => (
                    <View key={item.id} style={styles.menuItemRow}>
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
                      <Pressable
                        style={styles.menuItemFavoriteButton}
                        onPress={() => toggleFavoriteMenuItem(item.id)}>
                        <MaterialIcons
                          name={favoriteMenuItemIds.includes(item.id) ? 'favorite' : 'favorite-border'}
                          size={22}
                          color={favoriteMenuItemIds.includes(item.id) ? '#FF8A00' : '#58635D'}
                        />
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}
            </>
          ) : (
            CATEGORIES.map((category) => {
              const matchingAllItems = menuItemsByCategory
                .filter((item) => item.category === category.id)
                .filter((item) => {
                  if (!searchQuery) return true;
                  return (
                    item.name.toLowerCase().includes(searchQuery) ||
                    item.description.toLowerCase().includes(searchQuery)
                  );
                });
              const featuredItems = (
                searchQuery ? matchingAllItems : matchingAllItems.filter((item) => item.featured)
              ).slice(0, 4);

              if (searchQuery && matchingAllItems.length === 0) {
                return null;
              }

              return (
                <View key={category.id} style={styles.menuCategorySection}>
                  <View style={styles.menuCategoryHeaderRow}>
                    <ThemedText type="subtitle" style={styles.menuCategoryTitle}>
                      {category.label}
                    </ThemedText>
                    <Pressable onPress={() => handleSelectCategory(category.id)}>
                      <ThemedText style={styles.menuSeeAll}>See all</ThemedText>
                    </Pressable>
                  </View>

                  {featuredItems.length === 0 ? (
                    <ThemedText style={styles.noFeaturedText}>
                      No featured items in this category yet.
                    </ThemedText>
                  ) : (
                    featuredItems.map((item) => (
                      <View key={item.id} style={styles.menuItemRow}>
                        <Pressable
                          style={styles.menuItemRowMain}
                          onPress={() => handleSelectItem(item)}>
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
                        <Pressable
                          style={styles.menuItemFavoriteButton}
                          onPress={() => toggleFavoriteMenuItem(item.id)}>
                          <MaterialIcons
                            name={favoriteMenuItemIds.includes(item.id) ? 'favorite' : 'favorite-border'}
                            size={22}
                            color={favoriteMenuItemIds.includes(item.id) ? '#FF8A00' : '#58635D'}
                          />
                        </Pressable>
                      </View>
                    ))
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      </View>
    );
  };

  const renderItemGridList = (items: MenuItem[], listKey: string, listEmptyComponent: ReactElement) => {
    const searchQuery = menuSearch.trim().toLowerCase();
    const filteredItems = items.filter((item) => {
      if (!searchQuery) return true;
      return (
        item.name.toLowerCase().includes(searchQuery) ||
        item.description.toLowerCase().includes(searchQuery)
      );
    });

    const itemGridGap = 12;
    const itemListHPad = 16;
    const itemGridCellWidth = (windowWidth - itemListHPad * 2 - itemGridGap) / 2;

    return (
      <FlatList
        key={listKey}
        data={filteredItems}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.itemGridRow}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
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
            <ThemedText style={styles.itemGridName} numberOfLines={2}>
              {item.name}
            </ThemedText>
          </Pressable>
        )}
      />
    );
  };

  const renderItemListBody = () => {
    const categoryLabel =
      CATEGORIES.find((c) => c.id === selectedCategory)?.label ?? 'this category';
    return renderItemGridList(
      categoryItems,
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

  const renderContent = () => {
    if (!(step === 'customize' && selectedItem)) {
      return null;
    }

    const item = selectedItem;
    const sizeOptions = sortedSizes(item);
    const canAddSize = sizeOptions.length > 0 && selectedSizeOz != null;
    const showSizeOptions = item.category !== 'bowl';
    const showSupplementsSection = item.category !== 'shot';
    return (
      <View style={styles.customizeSheetInner}>
        <ScrollView
          style={styles.customizeScroll}
          contentContainerStyle={styles.customizeScrollContent}
          showsVerticalScrollIndicator={false}>
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

          {showSizeOptions ? (
            <View style={styles.customizeSection}>
              <ThemedText style={styles.customizeSectionTitle}>Size options</ThemedText>
              <View style={styles.customizeSectionDivider} />
              {sizeOptions.length === 0 ? (
                <ThemedText style={styles.customizeEmptySizes}>No sizes are available for this item.</ThemedText>
              ) : (
                <View style={styles.customizeSizeRow}>
                  {sizeOptions.map((oz) => {
                    const p = priceForOz(item.prices, oz);
                    const selected = selectedSizeOz === oz;
                    return (
                      <Pressable
                        key={oz}
                        style={styles.customizeSizeColumn}
                        onPress={() => setSelectedSizeOz(oz)}>
                        <View
                          style={[
                            styles.customizeSizeRing,
                            selected && styles.customizeSizeRingSelected,
                          ]}>
                          <ThemedText style={styles.customizeSizeOzText}>{oz} oz</ThemedText>
                          <ThemedText style={styles.customizeSizePriceText}>${p.toFixed(2)}</ThemedText>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          ) : null}

          {showSupplementsSection ? (
            <View style={styles.customizeSection}>
              <Pressable
                style={styles.customizeSupplementsHeader}
                onPress={() => setSupplementsSectionExpanded((v) => !v)}>
                <ThemedText style={styles.customizeSectionTitle}>Supplements</ThemedText>
                <MaterialIcons
                  name={supplementsSectionExpanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                  size={28}
                  color="#1A2520"
                />
              </Pressable>
              <View style={styles.customizeSectionDivider} />
              {supplementsSectionExpanded ? (
                supplements.length === 0 ? (
                  <ThemedText style={styles.customizeEmptySizes}>No supplements available.</ThemedText>
                ) : (
                  supplements.map((sup) => {
                    const isSelected = selectedSupplements.includes(sup.id);
                    return (
                      <Pressable
                        key={sup.id}
                        style={styles.customizeSupplementRow}
                        onPress={() => toggleSupplement(sup.id)}>
                        <MaterialIcons
                          name={isSelected ? 'check-box' : 'check-box-outline-blank'}
                          size={24}
                          color={isSelected ? '#0F9D58' : '#8A9890'}
                        />
                        <ThemedText style={styles.customizeSupplementName}>{sup.name}</ThemedText>
                        <ThemedText style={styles.customizeSupplementPrice}>+${sup.price.toFixed(2)}</ThemedText>
                      </Pressable>
                    );
                  })
                )
              ) : null}
            </View>
          ) : null}

          <View style={{ height: 100 }} />
        </ScrollView>

        <View style={[styles.customizeStickyAddWrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <Pressable
            style={[
              styles.customizeAddPill,
              { width: windowWidth * 0.8 },
              !canAddSize && styles.customizeAddPillDisabled,
            ]}
            onPress={handleAddToCart}
            disabled={!canAddSize}>
            <ThemedText style={styles.customizeAddPillText}>
              Add to order · ${currentItemTotal.toFixed(2)}
            </ThemedText>
          </Pressable>
        </View>
      </View>
    );
  };

  const renderCustomizeModal = () => {
    if (step !== 'customize' || !selectedItem) {
      return null;
    }

    const safeWindowHeight = Math.max(0, windowHeight - insets.top - insets.bottom);
    // Extend through bottom inset so the sheet is white to the physical bottom; footer uses padding for the home indicator.
    const sheetHeight = safeWindowHeight * 0.98 + insets.bottom;
    const sheetTop = windowHeight - sheetHeight;
    // Sheet often starts below the notch; don't add full insets.top again — only pad to clear safe area.
    const customizeHeaderPadTop = Math.max(insets.top - sheetTop, 8);

    return (
      <Modal
        visible={step === 'customize'}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={goBackFromCustomize}>
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
          </Animated.View>
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
            <ThemedText style={styles.storeStickyName} numberOfLines={1} ellipsizeMode="tail">
              {selectedLocation.name}
            </ThemedText>
          </View>
          <MaterialIcons style={styles.storeStickyChevron} name="keyboard-arrow-down" size={20} color="#FFFFFF" />
        </Pressable>
        <Pressable
          style={styles.storeStickyBag}
          onPress={handleCheckout}
          disabled={isSubmittingOrder}>
          <MaterialIcons name="shopping-bag" size={20} color="#FFFFFF" />
          <View style={styles.storeStickyBadge}>
            <ThemedText style={styles.storeStickyBadgeText}>{cart.length}</ThemedText>
          </View>
        </Pressable>
      </LinearGradient>
    ) : null;

  return (
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
                        {renderCategoryFlowHeader()}
                        {step === 'category' || step === 'item' || step === 'customize'
                          ? renderCategoryMenuTabs()
                          : null}
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
      {renderCustomizeModal()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
  itemHeaderTitle: {
    fontSize: 24,
    lineHeight: 28,
  },
  itemHeaderSubtitle: {
    marginTop: 2,
    color: '#5B6761',
    fontSize: 14,
    lineHeight: 18,
  },
  content: {
    flex: 1,
    marginBottom: 12,
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
  /** Horizontal inset for titles, lists, and cards inside the sheet. */
  orderOverlayInnerPad: {
    flex: 1,
    minHeight: 0,
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
  itemGridRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  itemGridCell: {
    alignItems: 'center',
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
    marginTop: 10,
    fontSize: 15,
    fontWeight: '600',
    color: '#1A2520',
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
  storeMeta: {
    marginTop: -2,
    fontSize: 13,
    lineHeight: 20,
    color: '#2B342F',
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
    marginHorizontal: -16,
    paddingLeft: 16,
    paddingRight: 16,
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
    marginHorizontal: -16,
  },
  categoryHeaderDividerShadow: {
    position: 'absolute',
    top: 1,
    left: -16,
    right: -16,
    height: 14,
    zIndex: 2,
  },
  menuCategorySection: {
    marginBottom: 16,
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
  menuItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 10,
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
  },
  customizeScrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
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
    marginTop: 10,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    color: '#1A2520',
    textAlign: 'center',
  },
  customizeSection: {
    marginTop: 28,
  },
  customizeSectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A2520',
  },
  customizeSectionDivider: {
    height: 2,
    backgroundColor: 'rgba(15, 157, 88, 0.28)',
    marginTop: 10,
    borderRadius: 1,
  },
  customizeEmptySizes: {
    marginTop: 12,
    color: '#6A746F',
    fontSize: 15,
  },
  customizeSizeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 14,
    marginTop: 18,
  },
  customizeSizeColumn: {
    alignItems: 'center',
  },
  customizeSizeRing: {
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 2,
    borderColor: '#D6DED9',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    backgroundColor: '#FFFFFF',
  },
  customizeSizeRingSelected: {
    borderWidth: 2,
    borderColor: '#0F9D58',
    backgroundColor: 'rgba(15, 157, 88, 0.16)',
  },
  customizeSizeOzText: {
    fontSize: 16,
    lineHeight: 18,
    fontWeight: '700',
    color: '#1A2520',
    textAlign: 'center',
  },
  customizeSizePriceText: {
    marginTop: 0,
    fontSize: 12,
    fontWeight: '600',
    color: '#4B5B52',
    textAlign: 'center',
  },
  customizeSupplementsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  customizeSupplementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8EEEA',
  },
  customizeSupplementName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#1A2520',
  },
  customizeSupplementPrice: {
    fontSize: 15,
    fontWeight: '600',
    color: '#4B5B52',
  },
  customizeStickyAddWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 12,
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5ECE6',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -2 },
    elevation: 8,
  },
  customizeAddPill: {
    backgroundColor: '#0F9D58',
    paddingVertical: 14,
    paddingHorizontal: 22,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
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
    borderRadius: 12,
    marginBottom: 6,
    marginHorizontal: 16,
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  storeStickyLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    flex: 1,
  },
  storeStickyTextWrap: {
    flex: 1,
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
  },
  storeStickyChevron: {
    marginLeft: 4,
    marginRight: 10,
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

