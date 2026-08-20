import { describe, expect, it } from 'vitest';
import { parseIamCookHtml, extractIamCookListingUrls } from '../application/iamcook/iamcook.parser';
import { parseRussianFoodHtml, extractRussianFoodListingUrls, extractRussianFoodDetailLinks } from '../application/russianfood/russianfood.parser';
import { canonicalizeIamCookUrl, canonicalizeRussianFoodUrl } from '../domain/recipe-source-network.policy';
import { mapIngredients } from '../domain/recipe-research.policy';
import { extractEdaSitemapUrls, parseEdaHtml } from '../application/eda/eda.parser';
import { extract1000MenuListingUrls, parse1000MenuHtml } from '../application/menu1000/menu1000.parser';

describe('STEP-339C live source HTML adapters', () => {
  it('parses IamCook HTML without JSON-LD ingredients and preserves step order', () => {
    const html = '<html><h1>Курица с гречкой</h1><div class="ilist"><li>Курица — 200 г</li><li>Гречка — 80 г</li></div><ul class="ilparams"><li>Порции: 2</li><li>Время: 30 минут</li></ul><div class="instructions"><p>Отварить гречку</p><p><img src="step.jpg"></p><p>Смешать с курицей</p></div></html>';
    const candidate = parseIamCookHtml({ bodyText: html, sourceUrl: 'https://www.iamcook.ru/recipe/chicken-buckwheat', statusCode: 200 });
    expect(candidate.ingredients).toHaveLength(2);
    expect(candidate.steps.map((s) => s.text)).toEqual(['Отварить гречку', 'Смешать с курицей']);
    expect(candidate.servings).toBe(2);
  });

  it('decodes cp1251 and ignores scripts/ads in RussianFood HTML', () => {
    const html = '<html><head><meta charset="windows-1251"><script>ad()</script></head><h1>Борщ</h1><table class="ingr_block"><tr><td>Свёкла — 300 г</td></tr><tr><td>Вода — 1 л</td></tr></table><span class="portion">4 порции</span><div class="step_images_n"><div class="step_n">Нарезать овощи</div><div class="step_n"><script>bad</script>Варить до готовности</div></div><div class="ad">Реклама</div></html>';
    const bytes = Uint8Array.from([...html].map((char) => { const code = char.charCodeAt(0); if (code === 0x401) return 0xa8; if (code === 0x451) return 0xb8; if (code >= 0x410 && code <= 0x44f) return code - 0x350; return code < 0x100 ? code : 0x3f; }));
    const candidate = parseRussianFoodHtml({ bodyText: bytes, sourceUrl: 'https://www.russianfood.com/recipes/recipe.php?rid=borsch', statusCode: 200 });
    expect(candidate.title).toContain('Борщ');
    expect(candidate.ingredients).toHaveLength(2);
    expect(candidate.steps.map((s) => s.text)).toEqual(['Нарезать овощи', 'Варить до готовности']);
    expect(candidate.servings).toBe(4);
  });

  it('extracts only allowlisted detail URLs from listings', () => {
    expect(extractIamCookListingUrls('<a href="/recipe/one">one</a><a href="https://evil.example/recipe/x">x</a>')).toEqual(['https://www.iamcook.ru/recipe/one']);
    expect(extractRussianFoodListingUrls('<a href="/recipes/recipe.php?rid=one">one</a><a href="/x">x</a>')).toEqual(['https://www.russianfood.com/recipes/recipe.php?rid=one']);
    expect(canonicalizeIamCookUrl('https://www.iamcook.ru/recipes').kind).toBe('listing');
    expect(canonicalizeRussianFoodUrl('https://www.russianfood.com/recipes').kind).toBe('listing');
  });

  it('fails closed with an explicit unknown-product flag when the disposable catalog is empty', () => {
    const mapped = mapIngredients([{ name: 'Куриная грудка', amountText: '200', unitText: 'г' }], []);
    expect(mapped.mappings[0]?.productId).toBeNull();
    expect(mapped.flags).toEqual(expect.arrayContaining([{ type: 'UNKNOWN_PRODUCT', severity: 'BLOCKER', ingredientIndex: 0, sourceValue: 'Куриная грудка' }]));
  });

  it('maps a real-source-normalized name only through an accepted canonical alias', () => {
    const mapped = mapIngredients([{ name: 'Куриная грудка', amountText: '200', unitText: 'г' }, { name: 'Неподтверждённый продукт', amountText: '1', unitText: 'шт' }], [{ productId: 'product-chicken', canonicalName: 'Куриная грудка', name: 'Куриная грудка', alias: 'куриная грудка', normalizedAlias: 'куриная грудка', confidence: 1 }]);
    expect(mapped.mappings[0]?.productId).toBe('product-chicken');
    expect(mapped.mappings[1]?.productId).toBeNull();
    expect(mapped.flags.some((flag) => flag.type === 'UNKNOWN_PRODUCT' && flag.ingredientIndex === 1)).toBe(true);
  });

  it('bounds RussianFood detail-graph traversal and never enumerates ids', () => {
    const html = '<a href="/recipes/recipe.php?rid=1">one</a><a href="/recipes/recipe.php?rid=2">two</a><a href="/recipes/recipe.php?rid=3">three</a><a href="/other?id=4">other</a>';
    expect(extractRussianFoodDetailLinks(html, 'https://www.russianfood.com/recipes/recipe.php?rid=63199', 2)).toEqual([
      'https://www.russianfood.com/recipes/recipe.php?rid=1',
      'https://www.russianfood.com/recipes/recipe.php?rid=2',
    ]);
    expect(extractRussianFoodDetailLinks(html, 'https://www.russianfood.com/recipes', 10)).toEqual([]);
  });

  it('parses EDA Recipe JSON-LD and bounded sitemap URLs', () => {
    expect(extractEdaSitemapUrls('<url><loc>https://eda.rambler.ru/recepty/soup-123</loc></url>')).toEqual(['https://eda.rambler.ru/recepty/soup-123']);
    const candidate = parseEdaHtml({ statusCode: 200, sourceUrl: 'https://eda.rambler.ru/recepty/soup-123', bodyText: '<script type="application/ld+json">{"@type":"Recipe","name":"Суп","recipeIngredient":["Морковь — 1 шт"],"recipeInstructions":[{"@type":"HowToStep","text":"Варить"}],"recipeYield":"2 порции","totalTime":"PT30M"}</script>' });
    expect(candidate.title).toBe('Суп');
    expect(candidate.ingredients).toHaveLength(1);
    expect(candidate.steps[0]?.text).toBe('Варить');
    expect(candidate.totalTime).toBe(30);
  });

  it('parses 1000.menu microdata and bounds listing discovery', () => {
    expect(extract1000MenuListingUrls('<a href="/cooking/123-soup">x</a><a href="/nope">x</a>')).toEqual(['https://1000.menu/cooking/123-soup']);
    const candidate = parse1000MenuHtml({ statusCode: 200, sourceUrl: 'https://1000.menu/cooking/123-soup', bodyText: '<h1 itemprop="name">Суп</h1><span itemprop="recipeIngredient">Морковь — 1 шт</span><div itemprop="recipeInstructions">Варить</div>' });
    expect(candidate.title).toBe('Суп');
    expect(candidate.ingredients).toHaveLength(1);
    expect(candidate.steps).toHaveLength(1);
  });
});
