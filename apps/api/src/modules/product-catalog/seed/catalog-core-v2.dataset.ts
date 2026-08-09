import { withComputedChecksum } from './checksum';
import { PILOT_PRODUCTS } from './pilot-v1.dataset';
import {
  SEED_SCHEMA_VERSION,
  SEED_SOURCE_POLICY_VERSION,
  type CatalogSeedManifest,
  type ProductSeedRecord,
  type SeedNutrition,
} from './seed.types';

const DS = 'catalog-core-v2';

function usda(n: Omit<SeedNutrition, 'source' | 'sourceRef' | 'confidenceLabel' | 'basis'>): SeedNutrition {
  return {
    ...n,
    fiber: n.fiber ?? null,
    sodium: n.sodium ?? null,
    basis: 'per_100g',
    source: 'IMPORT',
    sourceRef: 'USDA_FDC',
    confidenceLabel: 'source-provided',
  };
}

function rf(n: Omit<SeedNutrition, 'source' | 'sourceRef' | 'confidenceLabel' | 'basis'>): SeedNutrition {
  return {
    ...n,
    fiber: n.fiber ?? null,
    sodium: n.sodium ?? null,
    basis: 'per_100g',
    source: 'IMPORT',
    sourceRef: 'RF_FOOD_COMPOSITION_REF',
    confidenceLabel: 'needs-review',
  };
}

type Compact = {
  n: number;
  key: string;
  name: string;
  cat: string;
  form: string;
  unit?: string;
  cal: number;
  p: number;
  f: number;
  c: number;
  src?: 'usda' | 'rf';
  role?: string;
  allergen?: string;
  vegan?: boolean;
  veg?: boolean;
  fatPct?: number;
  review?: boolean;
  aliases?: string[];
  note?: string;
};

function toRecord(row: Compact): ProductSeedRecord {
  const nutrition = (row.src === 'rf' ? rf : usda)({
    calories: row.cal,
    protein: row.p,
    fat: row.f,
    carbohydrate: row.c,
  });
  const hex = row.n.toString(16).padStart(3, '0');
  return {
    stableId: `c2010002-0000-4000-8000-000000000${hex}`,
    productKey: row.key,
    canonicalName: row.name,
    categoryCode: row.cat,
    form: row.form,
    defaultUnit: row.unit ?? 'g',
    status: 'ACTIVE',
    nutrition,
    aliases: [
      { alias: row.name, source: 'SYSTEM' },
      ...(row.aliases ?? []).map((a) => ({ alias: a, source: 'IMPORT' as const })),
    ],
    allergens: row.allergen
      ? [
          {
            code: row.allergen,
            presence: 'CONTAINS',
            source: 'IMPORT',
            confidenceLabel: 'source-provided',
          },
        ]
      : undefined,
    dietaryTags: [
      ...(row.vegan
        ? [
            {
              code: 'vegan' as const,
              source: 'DETERMINISTIC' as const,
              confidenceLabel: 'deterministic-derived' as const,
            },
          ]
        : []),
      ...(row.veg || row.vegan
        ? [
            {
              code: 'vegetarian' as const,
              source: 'DETERMINISTIC' as const,
              confidenceLabel: 'deterministic-derived' as const,
            },
          ]
        : []),
    ],
    culinaryRoles: row.role
      ? [
          {
            code: row.role,
            isPrimary: true,
            source: 'IMPORT',
            confidenceLabel: row.review ? 'needs-review' : 'source-provided',
          },
        ]
      : undefined,
    coefficients: row.fatPct != null ? { fatPercent: row.fatPct } : undefined,
    reviewStatus: row.review || row.src === 'rf' ? 'NEEDS_REVIEW' : 'NONE',
    reviewSeverity: 'NON_BLOCKING',
    reviewNote: row.note ?? null,
    seedProvenance: {
      datasetVersion: DS,
      sources: [row.src === 'rf' ? 'S2' : 'S1', 'S4'],
      notes: row.note,
    },
  };
}

/** New products for catalog-core-v2 (pilot rows remapped separately). */
const EXPANSION: Compact[] = [
  // meat
  { n: 1, key: 'pork_lean_raw', name: 'Свинина постная', cat: 'meat_poultry', form: 'RAW', cal: 143, p: 21, f: 6, c: 0, role: 'MAIN_PROTEIN', review: true },
  { n: 2, key: 'beef_mince_raw', name: 'Фарш говяжий', cat: 'meat_poultry', form: 'RAW', cal: 254, p: 17, f: 20, c: 0, role: 'MAIN_PROTEIN', review: true, aliases: ['говяжий фарш'] },
  { n: 3, key: 'chicken_mince_raw', name: 'Фарш куриный', cat: 'meat_poultry', form: 'RAW', cal: 143, p: 17, f: 8, c: 0, role: 'MAIN_PROTEIN', review: true },
  { n: 4, key: 'turkey_breast_raw', name: 'Индейка грудка', cat: 'meat_poultry', form: 'RAW', cal: 104, p: 23, f: 1, c: 0, role: 'MAIN_PROTEIN' },
  { n: 5, key: 'chicken_breast_baked', name: 'Куриная грудка запечённая', cat: 'meat_poultry', form: 'BAKED', cal: 165, p: 31, f: 3.6, c: 0, role: 'MAIN_PROTEIN', review: true },
  { n: 6, key: 'beef_stewed', name: 'Говядина тушёная', cat: 'meat_poultry', form: 'STEWED', cal: 232, p: 26, f: 14, c: 0, role: 'MAIN_PROTEIN', review: true },
  // fish
  { n: 7, key: 'cod_raw', name: 'Треска', cat: 'fish_seafood', form: 'RAW', cal: 82, p: 18, f: 0.7, c: 0, allergen: 'fish', role: 'MAIN_PROTEIN', src: 'rf', review: true },
  { n: 8, key: 'hake_raw', name: 'Хек', cat: 'fish_seafood', form: 'RAW', cal: 86, p: 16.6, f: 1.8, c: 0, allergen: 'fish', role: 'MAIN_PROTEIN', src: 'rf', review: true },
  { n: 9, key: 'pink_salmon_raw', name: 'Горбуша', cat: 'fish_seafood', form: 'RAW', cal: 142, p: 20.5, f: 6.5, c: 0, allergen: 'fish', role: 'MAIN_PROTEIN', src: 'rf', review: true },
  { n: 10, key: 'mackerel_raw', name: 'Скумбрия', cat: 'fish_seafood', form: 'RAW', cal: 205, p: 19, f: 14, c: 0, allergen: 'fish', role: 'MAIN_PROTEIN', review: true },
  { n: 11, key: 'tuna_canned_drained', name: 'Тунец консервированный (откинутый)', cat: 'fish_seafood', form: 'DRAINED', cal: 116, p: 25, f: 1, c: 0, allergen: 'fish', role: 'MAIN_PROTEIN', review: true },
  { n: 12, key: 'tuna_raw', name: 'Тунец', cat: 'fish_seafood', form: 'RAW', cal: 144, p: 23, f: 5, c: 0, allergen: 'fish', role: 'MAIN_PROTEIN', review: true },
  { n: 13, key: 'shrimp_raw', name: 'Креветки', cat: 'fish_seafood', form: 'RAW', cal: 99, p: 24, f: 0.3, c: 0.2, allergen: 'shellfish', role: 'MAIN_PROTEIN', review: true },
  // dairy
  { n: 14, key: 'milk_1pct', name: 'Молоко 1%', cat: 'dairy', form: 'READY_TO_EAT', unit: 'ml', cal: 42, p: 3.4, f: 1, c: 5, fatPct: 1, allergen: 'milk', role: 'MOISTURE_SOURCE', veg: true },
  { n: 15, key: 'milk_3_2pct', name: 'Молоко 3.2%', cat: 'dairy', form: 'READY_TO_EAT', unit: 'ml', cal: 60, p: 3.2, f: 3.2, c: 4.7, fatPct: 3.2, allergen: 'milk', role: 'MOISTURE_SOURCE', veg: true, src: 'rf', review: true },
  { n: 16, key: 'kefir_2_5pct', name: 'Кефир 2.5%', cat: 'dairy', form: 'READY_TO_EAT', unit: 'ml', cal: 53, p: 3, f: 2.5, c: 4, fatPct: 2.5, allergen: 'milk', role: 'MOISTURE_SOURCE', veg: true, src: 'rf', review: true },
  { n: 17, key: 'yogurt_natural', name: 'Йогурт натуральный', cat: 'dairy', form: 'READY_TO_EAT', cal: 61, p: 3.5, f: 3.3, c: 4.7, allergen: 'milk', role: 'MAIN_PROTEIN', veg: true, review: true },
  { n: 18, key: 'cottage_cheese_0pct', name: 'Творог 0%', cat: 'dairy', form: 'READY_TO_EAT', cal: 71, p: 16.5, f: 0.1, c: 1.3, fatPct: 0, allergen: 'milk', role: 'MAIN_PROTEIN', veg: true, src: 'rf', review: true },
  { n: 19, key: 'cottage_cheese_9pct', name: 'Творог 9%', cat: 'dairy', form: 'READY_TO_EAT', cal: 159, p: 16.7, f: 9, c: 2, fatPct: 9, allergen: 'milk', role: 'MAIN_PROTEIN', veg: true, src: 'rf', review: true },
  { n: 20, key: 'sour_cream_20pct', name: 'Сметана 20%', cat: 'dairy', form: 'READY_TO_EAT', cal: 206, p: 2.8, f: 20, c: 3.2, fatPct: 20, allergen: 'milk', role: 'FAT', veg: true, src: 'rf', review: true },
  { n: 21, key: 'hard_cheese_45pct', name: 'Сыр твёрдый 45%', cat: 'dairy', form: 'READY_TO_EAT', cal: 363, p: 23, f: 30, c: 0.5, fatPct: 45, allergen: 'milk', role: 'MAIN_PROTEIN', veg: true, review: true },
  { n: 22, key: 'cream_cheese', name: 'Сливочный сыр', cat: 'dairy', form: 'READY_TO_EAT', cal: 342, p: 6, f: 34, c: 4, allergen: 'milk', role: 'FAT', veg: true, review: true },
  // eggs
  { n: 23, key: 'egg_white_raw', name: 'Яичный белок', cat: 'eggs', form: 'RAW', cal: 52, p: 11, f: 0.2, c: 0.7, allergen: 'eggs', role: 'MAIN_PROTEIN', veg: true, review: true },
  { n: 24, key: 'egg_yolk_raw', name: 'Яичный желток', cat: 'eggs', form: 'RAW', cal: 322, p: 16, f: 27, c: 3.6, allergen: 'eggs', role: 'FAT', veg: true, review: true },
  { n: 25, key: 'egg_fried', name: 'Яйцо жареное', cat: 'eggs', form: 'FRIED', cal: 196, p: 14, f: 15, c: 0.8, allergen: 'eggs', role: 'MAIN_PROTEIN', veg: true, review: true },
  // grains
  { n: 26, key: 'bulgur_dry', name: 'Булгур сухой', cat: 'grains', form: 'DRY', cal: 342, p: 12, f: 1.3, c: 76, role: 'STARCH', vegan: true, review: true },
  { n: 27, key: 'barley_pearl_dry', name: 'Перловка сухая', cat: 'grains', form: 'DRY', cal: 352, p: 9.9, f: 1.2, c: 77.5, role: 'STARCH', vegan: true, src: 'rf', review: true },
  { n: 28, key: 'millet_dry', name: 'Пшено сухое', cat: 'grains', form: 'DRY', cal: 378, p: 11.5, f: 3.3, c: 73, role: 'STARCH', vegan: true, src: 'rf', review: true },
  { n: 29, key: 'buckwheat_flakes_dry', name: 'Гречневые хлопья', cat: 'grains', form: 'DRY', cal: 340, p: 12, f: 3, c: 65, role: 'STARCH', vegan: true, review: true },
  { n: 30, key: 'barley_boiled', name: 'Перловка варёная', cat: 'grains', form: 'BOILED', cal: 123, p: 2.3, f: 0.4, c: 28, role: 'STARCH', vegan: true, review: true },
  { n: 31, key: 'bulgur_boiled', name: 'Булгур варёный', cat: 'grains', form: 'BOILED', cal: 83, p: 3, f: 0.2, c: 19, role: 'STARCH', vegan: true, review: true },
  { n: 32, key: 'millet_boiled', name: 'Пшено варёное', cat: 'grains', form: 'BOILED', cal: 119, p: 3.5, f: 1, c: 23, role: 'STARCH', vegan: true, review: true },
  { n: 33, key: 'brown_rice_dry', name: 'Рис коричневый сухой', cat: 'grains', form: 'DRY', cal: 370, p: 7.5, f: 2.7, c: 77, role: 'STARCH', vegan: true },
  { n: 34, key: 'brown_rice_boiled', name: 'Рис коричневый варёный', cat: 'grains', form: 'BOILED', cal: 123, p: 2.7, f: 1, c: 25.6, role: 'STARCH', vegan: true, review: true },
  // pasta
  { n: 35, key: 'pasta_boiled', name: 'Паста варёная', cat: 'pasta', form: 'BOILED', cal: 131, p: 5, f: 1.1, c: 25, allergen: 'gluten', role: 'STARCH', veg: true, review: true },
  { n: 36, key: 'egg_noodles_dry', name: 'Яичная лапша сухая', cat: 'pasta', form: 'DRY', cal: 384, p: 14, f: 4.4, c: 71, allergen: 'gluten', role: 'STARCH', veg: true, review: true },
  // vegetables
  { n: 37, key: 'cabbage_white_raw', name: 'Капуста белокочанная', cat: 'vegetables', form: 'RAW', cal: 25, p: 1.3, f: 0.1, c: 5.8, role: 'VEGETABLE_BASE', vegan: true, src: 'rf', review: true },
  { n: 38, key: 'beet_raw', name: 'Свёкла', cat: 'vegetables', form: 'RAW', cal: 43, p: 1.6, f: 0.2, c: 9.6, role: 'VEGETABLE_BASE', vegan: true, src: 'rf', review: true },
  { n: 39, key: 'zucchini_raw', name: 'Кабачок', cat: 'vegetables', form: 'RAW', cal: 17, p: 1.2, f: 0.3, c: 3.1, role: 'VEGETABLE_BASE', vegan: true },
  { n: 40, key: 'eggplant_raw', name: 'Баклажан', cat: 'vegetables', form: 'RAW', cal: 25, p: 1, f: 0.2, c: 6, role: 'VEGETABLE_BASE', vegan: true },
  { n: 41, key: 'bell_pepper_raw', name: 'Перец болгарский', cat: 'vegetables', form: 'RAW', cal: 27, p: 1, f: 0.3, c: 6.3, role: 'VEGETABLE_BASE', vegan: true },
  { n: 42, key: 'garlic_raw', name: 'Чеснок', cat: 'vegetables', form: 'RAW', cal: 149, p: 6.4, f: 0.5, c: 33, role: 'AROMATIC', vegan: true },
  { n: 43, key: 'potato_boiled', name: 'Картофель варёный', cat: 'vegetables', form: 'BOILED', cal: 87, p: 1.9, f: 0.1, c: 20, role: 'STARCH', vegan: true, review: true },
  { n: 44, key: 'broccoli_boiled', name: 'Брокколи варёная', cat: 'vegetables', form: 'BOILED', cal: 35, p: 2.4, f: 0.4, c: 7, role: 'VEGETABLE_BASE', vegan: true, review: true },
  { n: 45, key: 'carrot_boiled', name: 'Морковь варёная', cat: 'vegetables', form: 'BOILED', cal: 35, p: 0.8, f: 0.2, c: 8.2, role: 'VEGETABLE_BASE', vegan: true, review: true },
  { n: 46, key: 'spinach_raw', name: 'Шпинат', cat: 'vegetables', form: 'RAW', cal: 23, p: 2.9, f: 0.4, c: 3.6, role: 'VEGETABLE_BASE', vegan: true },
  { n: 47, key: 'mushroom_champignon_raw', name: 'Шампиньоны', cat: 'vegetables', form: 'RAW', cal: 22, p: 3.1, f: 0.3, c: 3.3, role: 'VEGETABLE_BASE', vegan: true, review: true },
  { n: 48, key: 'green_beans_raw', name: 'Стручковая фасоль', cat: 'vegetables', form: 'RAW', cal: 31, p: 1.8, f: 0.2, c: 7, role: 'VEGETABLE_BASE', vegan: true },
  // fruits
  { n: 49, key: 'orange_raw', name: 'Апельсин', cat: 'fruits', form: 'RAW', cal: 47, p: 0.9, f: 0.1, c: 12, role: 'ACID', vegan: true },
  { n: 50, key: 'pear_raw', name: 'Груша', cat: 'fruits', form: 'RAW', cal: 57, p: 0.4, f: 0.1, c: 15, vegan: true, review: true },
  { n: 51, key: 'strawberry_raw', name: 'Клубника', cat: 'fruits', form: 'RAW', cal: 32, p: 0.7, f: 0.3, c: 7.7, vegan: true },
  { n: 52, key: 'blueberry_raw', name: 'Черника', cat: 'fruits', form: 'RAW', cal: 57, p: 0.7, f: 0.3, c: 14.5, vegan: true },
  { n: 53, key: 'grape_raw', name: 'Виноград', cat: 'fruits', form: 'RAW', cal: 69, p: 0.7, f: 0.2, c: 18, vegan: true },
  { n: 54, key: 'watermelon_raw', name: 'Арбуз', cat: 'fruits', form: 'RAW', cal: 30, p: 0.6, f: 0.2, c: 7.6, vegan: true },
  { n: 55, key: 'plum_raw', name: 'Слива', cat: 'fruits', form: 'RAW', cal: 46, p: 0.7, f: 0.3, c: 11, vegan: true },
  // legumes
  { n: 56, key: 'beans_white_dry', name: 'Фасоль белая сухая', cat: 'legumes', form: 'DRY', cal: 333, p: 21, f: 1.5, c: 60, role: 'MAIN_PROTEIN', vegan: true, review: true },
  { n: 57, key: 'beans_boiled', name: 'Фасоль варёная', cat: 'legumes', form: 'BOILED', cal: 127, p: 8.7, f: 0.5, c: 22.8, role: 'MAIN_PROTEIN', vegan: true, review: true },
  { n: 58, key: 'peas_dry', name: 'Горох сухой', cat: 'legumes', form: 'DRY', cal: 341, p: 23, f: 1.6, c: 57, role: 'MAIN_PROTEIN', vegan: true, src: 'rf', review: true },
  { n: 59, key: 'peas_boiled', name: 'Горох варёный', cat: 'legumes', form: 'BOILED', cal: 118, p: 8.3, f: 0.4, c: 21, role: 'MAIN_PROTEIN', vegan: true, review: true },
  { n: 60, key: 'lentils_boiled', name: 'Чечевица варёная', cat: 'legumes', form: 'BOILED', cal: 116, p: 9, f: 0.4, c: 20, role: 'MAIN_PROTEIN', vegan: true, review: true },
  { n: 61, key: 'chickpeas_dry', name: 'Нут сухой', cat: 'legumes', form: 'DRY', cal: 378, p: 20, f: 6, c: 63, role: 'MAIN_PROTEIN', vegan: true, review: true },
  { n: 62, key: 'chickpeas_boiled', name: 'Нут варёный', cat: 'legumes', form: 'BOILED', cal: 164, p: 8.9, f: 2.6, c: 27, role: 'MAIN_PROTEIN', vegan: true, review: true },
  // oils
  { n: 63, key: 'rapeseed_oil', name: 'Рапсовое масло', cat: 'oils_fats', form: 'READY_TO_EAT', unit: 'ml', cal: 884, p: 0, f: 100, c: 0, role: 'FAT', vegan: true },
  { n: 64, key: 'ghee', name: 'Топлёное масло', cat: 'oils_fats', form: 'READY_TO_EAT', cal: 876, p: 0.2, f: 99.5, c: 0, allergen: 'milk', role: 'FAT', review: true },
  // sauces
  { n: 65, key: 'mayonnaise', name: 'Майонез', cat: 'sauces', form: 'READY_TO_EAT', cal: 680, p: 1, f: 75, c: 2.5, allergen: 'eggs', role: 'FAT', review: true },
  { n: 66, key: 'ketchup', name: 'Кетчуп', cat: 'sauces', form: 'READY_TO_EAT', cal: 112, p: 1.7, f: 0.4, c: 26, role: 'SAUCE_BASE', vegan: true, review: true },
  { n: 67, key: 'tomato_paste', name: 'Томатная паста', cat: 'sauces', form: 'READY_TO_EAT', cal: 82, p: 4.3, f: 0.5, c: 18.9, role: 'SAUCE_BASE', vegan: true, src: 'rf', review: true },
  // spices
  { n: 68, key: 'cinnamon', name: 'Корица', cat: 'spices', form: 'DRY', cal: 247, p: 4, f: 1.2, c: 81, role: 'SEASONING', vegan: true },
  { n: 69, key: 'cumin', name: 'Зира', cat: 'spices', form: 'DRY', cal: 375, p: 18, f: 22, c: 44, role: 'SEASONING', vegan: true, review: true },
  { n: 70, key: 'oregano_dried', name: 'Орегано сушёный', cat: 'spices', form: 'DRY', cal: 265, p: 9, f: 4.3, c: 69, role: 'SEASONING', vegan: true },
  { n: 71, key: 'bay_leaf', name: 'Лавровый лист', cat: 'spices', form: 'DRY', cal: 313, p: 7.6, f: 8.4, c: 75, role: 'AROMATIC', vegan: true, review: true },
  { n: 72, key: 'dill_dried', name: 'Укроп сушёный', cat: 'spices', form: 'DRY', cal: 253, p: 20, f: 4.4, c: 55, role: 'SEASONING', vegan: true },
  // technological
  { n: 73, key: 'wheat_flour', name: 'Мука пшеничная', cat: 'technological_ingredients', form: 'DRY', cal: 364, p: 10, f: 1, c: 76, allergen: 'gluten', role: 'BINDER', veg: true },
  { n: 74, key: 'sugar_white', name: 'Сахар', cat: 'technological_ingredients', form: 'DRY', cal: 387, p: 0, f: 0, c: 100, role: 'SEASONING', vegan: true },
  { n: 75, key: 'baking_soda', name: 'Сода пищевая', cat: 'technological_ingredients', form: 'DRY', cal: 0, p: 0, f: 0, c: 0, role: 'BINDER', vegan: true, review: true },
  { n: 76, key: 'yeast_dry', name: 'Дрожжи сухие', cat: 'technological_ingredients', form: 'DRY', cal: 325, p: 40, f: 7.6, c: 41, role: 'BINDER', vegan: true, review: true },
  { n: 77, key: 'cocoa_powder', name: 'Какао-порошок', cat: 'technological_ingredients', form: 'DRY', cal: 228, p: 20, f: 14, c: 12, role: 'SEASONING', vegan: true },
  { n: 78, key: 'ginger_dried', name: 'Имбирь сушёный', cat: 'spices', form: 'DRY', cal: 335, p: 9, f: 4.2, c: 72, role: 'SEASONING', vegan: true, review: true },
  // more staples matching RU diet
  { n: 79, key: 'onion_green_raw', name: 'Зелёный лук', cat: 'vegetables', form: 'RAW', cal: 32, p: 1.8, f: 0.2, c: 7.3, role: 'AROMATIC', vegan: true },
  { n: 80, key: 'radish_raw', name: 'Редис', cat: 'vegetables', form: 'RAW', cal: 16, p: 0.7, f: 0.1, c: 3.4, role: 'VEGETABLE_BASE', vegan: true },
  { n: 81, key: 'celery_stalk_raw', name: 'Сельдерей стебель', cat: 'vegetables', form: 'RAW', cal: 16, p: 0.7, f: 0.2, c: 3, allergen: 'celery', role: 'AROMATIC', vegan: true, review: true },
  { n: 82, key: 'parsley_raw', name: 'Петрушка', cat: 'vegetables', form: 'RAW', cal: 36, p: 3, f: 0.8, c: 6.3, role: 'AROMATIC', vegan: true },
  { n: 83, key: 'dill_fresh', name: 'Укроп свежий', cat: 'vegetables', form: 'RAW', cal: 43, p: 3.5, f: 1.1, c: 7, role: 'AROMATIC', vegan: true },
  { n: 84, key: 'pumpkin_raw', name: 'Тыква', cat: 'vegetables', form: 'RAW', cal: 26, p: 1, f: 0.1, c: 6.5, role: 'VEGETABLE_BASE', vegan: true, src: 'rf', review: true },
  { n: 85, key: 'corn_kernels_boiled', name: 'Кукуруза варёная', cat: 'vegetables', form: 'BOILED', cal: 96, p: 3.4, f: 1.5, c: 21, role: 'STARCH', vegan: true, review: true },
  { n: 86, key: 'kiwi_raw', name: 'Киви', cat: 'fruits', form: 'RAW', cal: 61, p: 1.1, f: 0.5, c: 15, vegan: true },
  { n: 87, key: 'pineapple_raw', name: 'Ананас', cat: 'fruits', form: 'RAW', cal: 50, p: 0.5, f: 0.1, c: 13, vegan: true },
  { n: 88, key: 'cherry_raw', name: 'Вишня', cat: 'fruits', form: 'RAW', cal: 50, p: 1, f: 0.3, c: 12, vegan: true },
  { n: 89, key: 'rye_bread', name: 'Хлеб ржаной', cat: 'grains', form: 'BAKED', cal: 259, p: 6.6, f: 1.2, c: 48, allergen: 'gluten', role: 'STARCH', veg: true, src: 'rf', review: true },
  { n: 90, key: 'wheat_bread', name: 'Хлеб пшеничный', cat: 'grains', form: 'BAKED', cal: 265, p: 9, f: 3.2, c: 49, allergen: 'gluten', role: 'STARCH', veg: true, review: true },
  { n: 91, key: 'oatmeal_dry', name: 'Овсяная крупа', cat: 'grains', form: 'DRY', cal: 389, p: 17, f: 7, c: 66, role: 'STARCH', vegan: true, review: true },
  { n: 92, key: 'semolina_dry', name: 'Манная крупа', cat: 'grains', form: 'DRY', cal: 360, p: 10, f: 1, c: 73, allergen: 'gluten', role: 'STARCH', veg: true, src: 'rf', review: true },
  { n: 93, key: 'couscous_dry', name: 'Кускус сухой', cat: 'grains', form: 'DRY', cal: 376, p: 13, f: 0.6, c: 77, allergen: 'gluten', role: 'STARCH', veg: true, review: true },
  { n: 94, key: 'potato_baked', name: 'Картофель запечённый', cat: 'vegetables', form: 'BAKED', cal: 93, p: 2.5, f: 0.1, c: 21, role: 'STARCH', vegan: true, review: true },
  { n: 95, key: 'pollock_boiled', name: 'Минтай варёный', cat: 'fish_seafood', form: 'BOILED', cal: 79, p: 17.3, f: 0.9, c: 0, allergen: 'fish', role: 'MAIN_PROTEIN', src: 'rf', review: true },
  { n: 96, key: 'chicken_boiled', name: 'Курица варёная', cat: 'meat_poultry', form: 'BOILED', cal: 170, p: 25, f: 7.4, c: 0, role: 'MAIN_PROTEIN', review: true },
  { n: 97, key: 'beef_liver_raw', name: 'Печень говяжья', cat: 'meat_poultry', form: 'RAW', cal: 135, p: 20, f: 3.9, c: 4, role: 'MAIN_PROTEIN', review: true },
  { n: 98, key: 'rabbit_raw', name: 'Кролик', cat: 'meat_poultry', form: 'RAW', cal: 173, p: 21, f: 9, c: 0, role: 'MAIN_PROTEIN', src: 'rf', review: true },
  { n: 99, key: 'herring_salted', name: 'Сельдь солёная', cat: 'fish_seafood', form: 'READY_TO_EAT', cal: 217, p: 19.8, f: 15, c: 0, allergen: 'fish', role: 'MAIN_PROTEIN', src: 'rf', review: true },
  { n: 100, key: 'squid_raw', name: 'Кальмар', cat: 'fish_seafood', form: 'RAW', cal: 92, p: 18, f: 1.4, c: 3.1, allergen: 'shellfish', role: 'MAIN_PROTEIN', review: true },
  { n: 101, key: 'ryazhenka_4pct', name: 'Ряженка 4%', cat: 'dairy', form: 'READY_TO_EAT', unit: 'ml', cal: 67, p: 3, f: 4, c: 4.2, fatPct: 4, allergen: 'milk', role: 'MOISTURE_SOURCE', veg: true, src: 'rf', review: true },
  { n: 102, key: 'curd_snack', name: 'Творожная масса', cat: 'dairy', form: 'READY_TO_EAT', cal: 232, p: 7.1, f: 11, c: 27, allergen: 'milk', role: 'MAIN_PROTEIN', veg: true, review: true, note: 'Generic curd snack; brand-free' },
  { n: 103, key: 'sesame_seeds', name: 'Кунжут', cat: 'oils_fats', form: 'DRY', cal: 573, p: 18, f: 50, c: 23, allergen: 'sesame', role: 'FAT', vegan: true },
  { n: 104, key: 'sunflower_seeds', name: 'Семечки подсолнечника', cat: 'oils_fats', form: 'DRY', cal: 584, p: 21, f: 51, c: 20, role: 'FAT', vegan: true },
  { n: 105, key: 'walnut', name: 'Грецкий орех', cat: 'oils_fats', form: 'RAW', cal: 654, p: 15, f: 65, c: 14, allergen: 'tree_nuts', role: 'FAT', vegan: true },
  { n: 106, key: 'almond', name: 'Миндаль', cat: 'oils_fats', form: 'RAW', cal: 579, p: 21, f: 50, c: 22, allergen: 'tree_nuts', role: 'FAT', vegan: true },
  { n: 107, key: 'honey_flower', name: 'Мёд цветочный', cat: 'technological_ingredients', form: 'READY_TO_EAT', cal: 304, p: 0.8, f: 0, c: 82, role: 'SEASONING', review: true, note: 'Distinct from fixture honey key if present' },
  { n: 108, key: 'potato_starch', name: 'Крахмал картофельный', cat: 'technological_ingredients', form: 'DRY', cal: 357, p: 0.1, f: 0, c: 86, role: 'THICKENER', vegan: true, src: 'rf', review: true },
  { n: 109, key: 'agar_agar', name: 'Агар-агар', cat: 'technological_ingredients', form: 'DRY', cal: 26, p: 0.5, f: 0, c: 0, role: 'THICKENER', vegan: true, review: true },
  { n: 110, key: 'lemon_juice', name: 'Сок лимонный', cat: 'fruits', form: 'READY_TO_EAT', unit: 'ml', cal: 22, p: 0.4, f: 0.2, c: 6.9, role: 'ACID', vegan: true },
];

function toExpansionRecords(): ProductSeedRecord[] {
  return EXPANSION.map(toRecord);
}

function remapPilot(product: ProductSeedRecord): ProductSeedRecord {
  return {
    ...product,
    nutrition: product.nutrition
      ? { ...product.nutrition, basis: product.nutrition.basis ?? 'per_100g' }
      : product.nutrition,
    reviewSeverity: product.reviewStatus === 'NEEDS_REVIEW' ? 'NON_BLOCKING' : product.reviewSeverity,
    seedProvenance: {
      ...product.seedProvenance,
      datasetVersion: DS,
      notes: [product.seedProvenance.notes, 'carried-from:pilot-v1'].filter(Boolean).join('; '),
    },
  };
}

export const CATALOG_CORE_V2_PRODUCTS: ProductSeedRecord[] = [
  ...PILOT_PRODUCTS.map(remapPilot),
  ...toExpansionRecords(),
];

export function buildCatalogCoreV2Manifest(): CatalogSeedManifest {
  const products = CATALOG_CORE_V2_PRODUCTS;
  const categoryCoverage: Record<string, number> = {};
  const formCoverage: Record<string, number> = {};
  let nonBlocking = 0;
  for (const p of products) {
    categoryCoverage[p.categoryCode] = (categoryCoverage[p.categoryCode] ?? 0) + 1;
    formCoverage[p.form] = (formCoverage[p.form] ?? 0) + 1;
    if (p.reviewStatus === 'NEEDS_REVIEW') nonBlocking += 1;
  }
  const pilotKeys = new Set(PILOT_PRODUCTS.map((p) => p.productKey));
  const added = products.filter((p) => !pilotKeys.has(p.productKey)).length;
  return withComputedChecksum({
    datasetVersion: DS,
    previousDatasetVersion: 'pilot-v1',
    schemaVersion: SEED_SCHEMA_VERSION,
    sourcePolicyVersion: SEED_SOURCE_POLICY_VERSION,
    releaseDate: '2026-07-24',
    products,
    addedProductCount: added,
    matchedProductCount: products.length - added,
    reviewSummary: { blocking: 0, nonBlocking },
    categoryCoverage,
    formCoverage,
  });
}
