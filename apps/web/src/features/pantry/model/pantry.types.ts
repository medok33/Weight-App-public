export type PantryExpiryStatus = 'ok' | 'soon' | 'expired' | 'unknown';

export type PantryItem = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  expiresOn: string | null;
  expiryStatus: PantryExpiryStatus;
};

export type PantryInventory = {
  pantry: { id: string; name: string };
  items: PantryItem[];
};

export type PantryScreenState = 'loading' | 'empty' | 'error' | 'forbidden' | 'success';
