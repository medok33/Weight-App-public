export type BudgetMode = 'frugal' | 'balanced' | 'flexible';
export type BudgetPreferences = { mode: BudgetMode };
export type BudgetScreenState = 'loading' | 'empty' | 'error' | 'forbidden' | 'success';
