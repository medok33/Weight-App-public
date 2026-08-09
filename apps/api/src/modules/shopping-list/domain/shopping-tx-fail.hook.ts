/** Test-only failure injection for transactional shopping rebuild (STEP_093 consistency). */
let failMode: 'before_list' | 'mid_items' | null = null;

export function setShoppingTxFailMode(mode: 'before_list' | 'mid_items' | null): void {
  failMode = mode;
}

export function peekShoppingTxFailMode(): 'before_list' | 'mid_items' | null {
  return failMode;
}

export function assertShoppingTxAllowed(stage: 'before_list' | 'mid_items'): void {
  if (failMode === stage) {
    throw new Error(`SHOPPING_TX_INJECTED_FAILURE:${stage}`);
  }
}
