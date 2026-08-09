/**
 * CATALOG-V3-01B-PUBLISH — unit checks for publish bridge constants / guards.
 */
import { describe, expect, it } from 'vitest';
import {
  CATALOG_V3_01B_PUBLISH_MANIFEST_VERSION,
  CATALOG_V3_01B_PUBLISH_PIN_COUNT,
  CATALOG_V3_01B_PUBLISH_RELEASE_CODE,
  CATALOG_V3_01B_PUBLISH_VERSION,
} from '../catalog-v3-01b-publish';
import { confirmV301bPublishApplyDatabase } from '../catalog-v3-01b-publish-loader';
import { DISPOSABLE_DB_NAME_PATTERN } from '../catalog-v3-01b-classification-loader';
import { CATALOG_V3_01B_CLASSIFICATION } from '../catalog-v3-01b-classification';
import { CANONICAL_RELEASE_CODE } from '../catalog-enums';

describe('CATALOG-V3-01B-PUBLISH constants', () => {
  it('targets a distinct release from canonical with exact 84 pins', () => {
    expect(CATALOG_V3_01B_PUBLISH_RELEASE_CODE).toBe('workout-catalog-v3-01b-publish');
    expect(CATALOG_V3_01B_PUBLISH_RELEASE_CODE).not.toBe(CANONICAL_RELEASE_CODE);
    expect(CATALOG_V3_01B_PUBLISH_PIN_COUNT).toBe(84);
    expect(CATALOG_V3_01B_CLASSIFICATION).toHaveLength(84);
    expect(CATALOG_V3_01B_PUBLISH_MANIFEST_VERSION).toBe('workout-catalog-manifest-v3-01b.1');
    expect(CATALOG_V3_01B_PUBLISH_VERSION).toBe('workout-catalog-v3-01b-publish.1');
  });

  it('requires disposable DB marker and wt_cat_* loopback name on apply', () => {
    const env = {
      WEIGHT_APP_DISPOSABLE_TEST_DB: '1',
    } as NodeJS.ProcessEnv;
    expect(
      confirmV301bPublishApplyDatabase(
        'postgresql://postgres:postgres@127.0.0.1:5432/wt_cat_publish_unit',
        env,
      ),
    ).toBe('wt_cat_publish_unit');
    expect(() =>
      confirmV301bPublishApplyDatabase(
        'postgresql://postgres:postgres@127.0.0.1:5432/wt_cat_publish_unit',
        { WEIGHT_APP_DISPOSABLE_TEST_DB: '0' } as NodeJS.ProcessEnv,
      ),
    ).toThrow(/DISPOSABLE_MARKER_REQUIRED/);
    expect(() =>
      confirmV301bPublishApplyDatabase(
        'postgresql://postgres:postgres@127.0.0.1:5432/weight_app',
        env,
      ),
    ).toThrow(/SHARED_WEIGHT_APP_DATABASE_FORBIDDEN/);
    expect(DISPOSABLE_DB_NAME_PATTERN.test('wt_cat_ok')).toBe(true);
    expect(DISPOSABLE_DB_NAME_PATTERN.test('weight_app')).toBe(false);
  });
});
