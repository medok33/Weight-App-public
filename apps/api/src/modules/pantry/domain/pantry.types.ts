export type PantryUnit = 'pcs' | 'g' | 'ml' | 'kg' | 'l';

export type PantryRecord = {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type PantryItemRecord = {
  id: string;
  pantryId: string;
  name: string;
  quantity: number;
  unit: PantryUnit;
  expiresOn: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PantryItemInput = {
  name: string;
  quantity: number;
  unit: PantryUnit;
  expiresOn?: string | null;
};

export type PantryExpiryStatus = 'ok' | 'soon' | 'expired' | 'unknown';

export type PantryItemView = PantryItemRecord & {
  expiryStatus: PantryExpiryStatus;
};

/** Minimal recipe shape deliberately compatible with meal-plan candidates. */
export type PantryMealCandidate = {
  id: string;
  name: string;
  calories: number;
  proteinG?: number;
  tags?: string[];
};

export type PantryIngredient = { productKey?: string; name: string };

export type PantryUsageExplanation = {
  available: string[];
  usedFromPantry: string[];
  toBuy: string[];
  soonExpiring: string[];
};
