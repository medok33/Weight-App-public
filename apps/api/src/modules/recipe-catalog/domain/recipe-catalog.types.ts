export type RecipeIngredient = { productId: string; quantity: number; unit: 'g' | 'ml' | 'piece' };
export type Recipe = { name: string; servings: number; ingredients: RecipeIngredient[] };
export type DietaryTaxonomy = { allergens: string[]; preferences: string[]; exclusions: string[] };
