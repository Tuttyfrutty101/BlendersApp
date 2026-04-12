/** Cart line item — shared with order flow and reorder-from-receipt. */
export type CartItem = {
  id: string;
  name: string;
  /** Fluid ounces for this line item. */
  size: number;
  supplements: string[];
  alterations: string[];
  specialInstructions?: string;
  price: number;
  /** Thumbnail from menu at reorder time — used when the in-memory menu list is not loaded yet. */
  imageUrl?: string | null;
  /** Source menu item — used when reopening customize from checkout. */
  menuItemId?: string;
  juiceBuildFromMenuCard?: boolean;
  supplementSelections?: Record<string, number>;
  supplementSelectionOrder?: string[];
  alterationIds?: string[];
  juiceIngredientIds?: string[];
};
