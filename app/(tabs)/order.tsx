import { useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  View,
  ScrollView,
  SafeAreaView,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { supabase } from '@/supabase';

type Step = 'location' | 'category' | 'item' | 'customize';

type Location = {
  id: string;
  name: string;
  address: string;
  hours: string;
};

type CategoryId = 'smoothie' | 'bowl' | 'shot' | 'juice' | 'focused health blend';

type MenuItem = {
  id: string;
  name: string;
  description: string;
  category: CategoryId;
  price_small: number;
  price_large: number;
};

type CartItem = {
  id: string;
  name: string;
  size: '12oz' | '24oz';
  supplements: string[];
  price: number;
};

const LOCATIONS: Location[] = [
  { id: 'downtown', name: 'Downtown SB', address: '720 State St', hours: '7a–10p' },
  { id: 'fivepoints', name: 'Five Points', address: '3973 State St', hours: '7a–10p' },
  { id: 'mesa', name: 'The Mesa', address: '315 Meigs Rd', hours: '7a–10p' },
  { id: 'iv', name: 'Isla Vista', address: '6560 Pardall Rd', hours: '7a–10p' },
  { id: 'montecito', name: 'Montecito', address: '1046-F Coast Village Rd', hours: '7a–10p' },
];

const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: 'smoothie', label: 'Smoothies' },
  { id: 'bowl', label: 'Bowls' },
  { id: 'shot', label: 'Shots' },
  { id: 'juice', label: 'Fresh Juice' },
  { id: 'focused health blend', label: 'Focused Health Blends' },
];

const SUPPLEMENTS = [
  { id: 'protein', label: 'Protein +$1.00', price: 1 },
  { id: 'vitamin-c', label: 'Vitamin C +$0.75', price: 0.75 },
  { id: 'energy', label: 'Energy Boost +$1.25', price: 1.25 },
];

export default function OrderScreen() {
  const [step, setStep] = useState<Step>('location');
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<CategoryId | null>(null);
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [size, setSize] = useState<'12oz' | '24oz'>('12oz');
  const [selectedSupplements, setSelectedSupplements] = useState<string[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [categoryItems, setCategoryItems] = useState<MenuItem[]>([]);
  const [isLoadingCategoryItems, setIsLoadingCategoryItems] = useState(false);

  const currentItemTotal =
    selectedItem != null
      ? (size === '24oz' ? selectedItem.price_large : selectedItem.price_small) +
        selectedSupplements.reduce((sum, id) => {
          const sup = SUPPLEMENTS.find((s) => s.id === id);
          return sum + (sup?.price ?? 0);
        }, 0)
      : 0;

  const cartTotal = cart.reduce((sum, item) => sum + item.price, 0);

  const handleSelectLocation = (location: Location) => {
    setSelectedLocation(location);
    setStep('category');
  };

  const handleSelectCategory = async (category: CategoryId) => {
    setSelectedCategory(category);
    setIsLoadingCategoryItems(true);
    setCategoryItems([]);
    setStep('item');

    const { data, error } = await supabase
      .from('menu_items')
      .select('id, name, description, category, price_small, price_large')
      .eq('category', category)
      .order('name');

    if (error) {
      console.error('Failed to load category items:', error);
      setCategoryItems([]);
      setIsLoadingCategoryItems(false);
      return;
    }

    setCategoryItems((data as MenuItem[]) ?? []);
    setIsLoadingCategoryItems(false);
  };

  const handleSelectItem = (item: MenuItem) => {
    setSelectedItem(item);
    setSize('12oz');
    setSelectedSupplements([]);
    setStep('customize');
  };

  const toggleSupplement = (id: string) => {
    setSelectedSupplements((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  };

  const handleAddToCart = () => {
    if (!selectedItem) return;

    const newItem: CartItem = {
      id: `${selectedItem.id}-${Date.now()}`,
      name: selectedItem.name,
      size,
      supplements: selectedSupplements,
      price: Number(currentItemTotal.toFixed(2)),
    };

    setCart((prev) => [...prev, newItem]);
    setStep('category');
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
      Alert.alert('Order placed', 'Your order was submitted successfully.');
    } catch (error) {
      console.error('Failed to submit order:', error);
      Alert.alert('Checkout failed', 'There was a problem submitting your order.');
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  const renderHeader = () => {
    let title = 'Choose a location';
    let subtitle = 'Pick the Blenders that is most convenient for you.';

    if (step === 'category') {
      title = 'What are you craving?';
      subtitle = selectedLocation ? selectedLocation.name : 'Choose a category to get started.';
    } else if (step === 'item' && selectedCategory) {
      const catLabel = CATEGORIES.find((c) => c.id === selectedCategory)?.label ?? '';
      title = catLabel;
      subtitle = 'Select an item to customize.';
    } else if (step === 'customize' && selectedItem) {
      title = selectedItem.name;
      subtitle = 'Pick your size and boosts.';
    }

    return (
      <View style={styles.header}>
        <ThemedText type="title">{title}</ThemedText>
        <ThemedText style={styles.headerSubtitle}>{subtitle}</ThemedText>
      </View>
    );
  };

  const renderContent = () => {
    if (step === 'location') {
      return (
        <FlatList
          data={LOCATIONS}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => handleSelectLocation(item)}>
              <ThemedText type="subtitle">{item.name}</ThemedText>
              <ThemedText style={styles.cardLine}>{item.address}</ThemedText>
              <ThemedText style={styles.cardLine}>Hours: {item.hours}</ThemedText>
            </Pressable>
          )}
        />
      );
    }

    if (step === 'category') {
      return (
        <View style={styles.grid}>
          {CATEGORIES.map((category) => (
            <Pressable
              key={category.id}
              style={styles.categoryTile}
              onPress={() => handleSelectCategory(category.id)}>
              <ThemedText type="subtitle">{category.label}</ThemedText>
            </Pressable>
          ))}
        </View>
      );
    }

    if (step === 'item' && isLoadingCategoryItems) {
      return <ThemedText>Loading menu...</ThemedText>;
    }

    if (step === 'item') {
      return (
        <FlatList
          data={categoryItems}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => handleSelectItem(item)}>
              <ThemedText type="subtitle">{item.name}</ThemedText>
              <ThemedText style={styles.cardLine}>{item.description}</ThemedText>
              <ThemedText style={styles.cardPrice}>From ${item.price_small.toFixed(2)}</ThemedText>
            </Pressable>
          )}
        />
      );
    }

    if (step === 'customize' && selectedItem) {
      return (
        <ScrollView contentContainerStyle={styles.customizeContent}>
          <View style={styles.section}>
            <ThemedText type="subtitle" style={styles.sectionTitle}>
              Size
            </ThemedText>
            <View style={styles.row}>
              {['12oz', '24oz'].map((s) => (
                <Pressable
                  key={s}
                  style={[styles.chip, size === s && styles.chipSelected]}
                  onPress={() => setSize(s as '12oz' | '24oz')}>
                  <ThemedText>{s}</ThemedText>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <ThemedText type="subtitle" style={styles.sectionTitle}>
              Supplements
            </ThemedText>
            <View style={styles.rowWrap}>
              {SUPPLEMENTS.map((sup) => {
                const isSelected = selectedSupplements.includes(sup.id);
                return (
                  <Pressable
                    key={sup.id}
                    style={[styles.chip, isSelected && styles.chipSelected]}
                    onPress={() => toggleSupplement(sup.id)}>
                    <ThemedText>{sup.label}</ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.section}>
            <ThemedText style={styles.summaryLine}>
              Current item total: ${currentItemTotal.toFixed(2)}
            </ThemedText>
          </View>

          <Pressable style={styles.primaryButton} onPress={handleAddToCart}>
            <ThemedText style={styles.primaryButtonText}>
              Add to cart • ${currentItemTotal.toFixed(2)}
            </ThemedText>
          </Pressable>
        </ScrollView>
      );
    }

    return null;
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ThemedView style={styles.container}>
        {renderHeader()}
        <View style={styles.content}>{renderContent()}</View>
        <View style={styles.cartBar}>
          <View>
            <ThemedText type="subtitle">Cart</ThemedText>
            <ThemedText style={styles.cartLine}>
              {cart.length === 0
                ? 'No items yet'
                : `${cart.length} item${cart.length > 1 ? 's' : ''} • $${cartTotal.toFixed(2)}`}
            </ThemedText>
          </View>
          <Pressable
            style={[styles.checkoutButton, isSubmittingOrder && styles.checkoutButtonDisabled]}
            onPress={handleCheckout}
            disabled={isSubmittingOrder}>
            <ThemedText style={styles.checkoutText}>
              {isSubmittingOrder ? 'Placing...' : 'Checkout'}
            </ThemedText>
          </Pressable>
        </View>
      </ThemedView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  header: {
    marginBottom: 12,
  },
  headerSubtitle: {
    marginTop: 4,
  },
  content: {
    flex: 1,
    marginBottom: 12,
  },
  listContent: {
    paddingBottom: 16,
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
  cardLine: {
    marginTop: 2,
  },
  cardPrice: {
    marginTop: 6,
    fontWeight: '600',
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
  customizeContent: {
    paddingBottom: 16,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#F2F4F7',
  },
  chipSelected: {
    backgroundColor: '#D9F2E6',
  },
  summaryLine: {
    fontWeight: '600',
  },
  primaryButton: {
    backgroundColor: '#0F9D58',
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
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
});

