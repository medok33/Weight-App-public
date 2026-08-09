/**
 * CATALOG-V3-01C-PUBLISH-BRIDGE — unit checks for candidate constants / guards.
 */
import { describe, expect, it } from 'vitest';
import { CANONICAL_RELEASE_CODE } from '../catalog-enums';
import { CATALOG_V3_01B_PUBLISH_RELEASE_CODE } from '../catalog-v3-01b-publish';
import { DISPOSABLE_DB_NAME_PATTERN } from '../catalog-v3-01b-classification-loader';
import {
  CATALOG_V3_01C_PUBLISH_FORBIDDEN_KEYS,
  CATALOG_V3_01C_PUBLISH_MANIFEST_VERSION,
  CATALOG_V3_01C_PUBLISH_PIN_COUNT,
  CATALOG_V3_01C_PUBLISH_RELEASE_CODE,
  CATALOG_V3_01C_PUBLISH_SOURCE_PIN_COUNT,
  CATALOG_V3_01C_PUBLISH_VERSION,
} from '../catalog-v3-01c-publish';
import { confirmV301cPublishApplyDatabase } from '../catalog-v3-01c-publish-loader';

describe('CATALOG-V3-01C-PUBLISH-BRIDGE constants', () => {
  it('targets a distinct DRAFT candidate with exact 156 pins', () => {
    expect(CATALOG_V3_01C_PUBLISH_RELEASE_CODE).toBe('workout-catalog-v3-01c-candidate');
    expect(CATALOG_V3_01C_PUBLISH_RELEASE_CODE).not.toBe(CANONICAL_RELEASE_CODE);
    expect(CATALOG_V3_01C_PUBLISH_RELEASE_CODE).not.toBe(CATALOG_V3_01B_PUBLISH_RELEASE_CODE);
    expect(CATALOG_V3_01C_PUBLISH_PIN_COUNT).toBe(156);
    expect(CATALOG_V3_01C_PUBLISH_SOURCE_PIN_COUNT).toBe(84);
    expect(CATALOG_V3_01C_PUBLISH_MANIFEST_VERSION).toBe('workout-catalog-manifest-v3-01c.1');
    expect(CATALOG_V3_01C_PUBLISH_VERSION).toBe('workout-catalog-v3-01c-publish-bridge.1');
    expect(CATALOG_V3_01C_PUBLISH_FORBIDDEN_KEYS).toEqual(
      expect.arrayContaining([
        'machine_chest_fly',
        'glute_bridge_march_hold',
        'ankle_mobility_knee_over_toe',
        'tibialis_raise',
        'lat_pulldown_wide',
      ]),
    );
  });

  it('requires disposable DB marker and wt_cat_* loopback name on apply', () => {
    const env = {
      WEIGHT_APP_DISPOSABLE_TEST_DB: '1',
    } as NodeJS.ProcessEnv;
    expect(
      confirmV301cPublishApplyDatabase(
        'postgresql://postgres:postgres@127.0.0.1:5432/wt_cat_01c_publish_unit',
        env,
      ),
    ).toBe('wt_cat_01c_publish_unit');
    expect(() =>
      confirmV301cPublishApplyDatabase(
        'postgresql://postgres:postgres@127.0.0.1:5432/wt_cat_01c_publish_unit',
        { WEIGHT_APP_DISPOSABLE_TEST_DB: '0' } as NodeJS.ProcessEnv,
      ),
    ).toThrow(/DISPOSABLE_MARKER_REQUIRED/);
    expect(() =>
      confirmV301cPublishApplyDatabase(
        'postgresql://postgres:postgres@127.0.0.1:5432/weight_app',
        env,
      ),
    ).toThrow(/SHARED_WEIGHT_APP_DATABASE_FORBIDDEN/);
    expect(DISPOSABLE_DB_NAME_PATTERN.test('wt_cat_ok')).toBe(true);
    expect(DISPOSABLE_DB_NAME_PATTERN.test('wt_local_dev')).toBe(false);
  });
});
