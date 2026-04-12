/** Queued when the user taps Order again on Home so Order opens straight into customize. */
let pendingMenuItemId: string | null = null;

export function queueCustomizeMenuItemFromHome(menuItemId: string) {
  pendingMenuItemId = menuItemId;
}

export function peekCustomizeMenuItemFromHome(): string | null {
  return pendingMenuItemId;
}

export function clearCustomizeMenuItemFromHome() {
  pendingMenuItemId = null;
}
