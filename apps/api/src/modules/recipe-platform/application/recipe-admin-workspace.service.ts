import { Inject, Injectable } from '@nestjs/common';
import { hasAdminAuthority } from '../../auth/domain/account-role.policy';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import {
  DEFAULT_RECIPE_CATALOG_DATA_CLASSES,
  parseRecipeDataClassFilter,
  recipeDataClassLabelRu,
  resolveRecipeDataClass,
  RECIPE_TEST_KEY_SQL,
  type RecipeDataClass,
} from '../domain/recipe-data-class.policy';
import {
  listAllowedLifecycleActions,
  lifecycleActionLabelRu,
  lifecycleStatusLabelRu,
  versionPublicationDisplay,
  type RecipeLifecycleAction,
} from '../domain/recipe-lifecycle-actions.policy';
import { searchRecommendationLabelRu, coverageBoardColumnLabelRu, formatCoverageSlotDisplayTitleRu } from '../domain/recipe-admin-labels.policy';
import { diffRecipeVersions } from '../domain/recipe-version-diff.policy';
import { isUsableForNewPlans, SUSPEND_FALLBACK_POLICY } from '../domain/recipe-lifecycle.policy';
import { COVERAGE_MATRIX_VERSION_V1 } from '../domain/recipe-coverage.policy';

export type RecipeCatalogFilters = {
  q?: string;
  dataClass?: string;
  lifecycle?: string;
  validation?: string;
  familyAssigned?: 'yes' | 'no' | '';
  currentPublished?: 'yes' | 'no' | '';
  duplicateBlocker?: 'yes' | '';
  revalidationOpen?: 'yes' | '';
  mediaMissing?: 'yes' | '';
  coverageAssigned?: 'yes' | 'no' | '';
  fingerprintMissing?: 'yes' | '';
  dependencyUnresolved?: 'yes' | '';
  page?: number;
  pageSize?: number;
  sort?: string;
  order?: 'asc' | 'desc';
};

@Injectable()
export class RecipeAdminWorkspaceService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async contentOverview() {
    const matrixVersion = COVERAGE_MATRIX_VERSION_V1;
    const [recipes, coverage, revalidation, duplicates, media, deps, search, dirty, lastRun, eligible] =
      await Promise.all([
        this.db.query<{ dataClass: string; cnt: string }>(
          `SELECT
             CASE
               WHEN COALESCE("dataClass", 'PRODUCTION') = 'PRODUCTION'
                    AND NOT ${RECIPE_TEST_KEY_SQL}
               THEN 'PRODUCTION'
               WHEN COALESCE("dataClass", 'PRODUCTION') = 'PRODUCTION'
                    AND ${RECIPE_TEST_KEY_SQL}
               THEN 'TEST_ONLY'
               ELSE COALESCE("dataClass", 'PRODUCTION')
             END AS "dataClass",
             COUNT(*)::text AS cnt
           FROM "Recipe"
           GROUP BY 1`,
        ),
        this.db.query<{ status: string; cnt: string }>(
          `SELECT status, COUNT(*)::text AS cnt FROM "RecipeCoverageSlot"
           WHERE "matrixVersion" = $1 AND active = true GROUP BY 1`,
          [matrixVersion],
        ),
        this.db.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM "RecipeRevalidationTask" WHERE status = 'OPEN'`,
        ),
        this.db.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt
           FROM "RecipeDuplicateCandidate" d
           JOIN "RecipeVersion" lv ON lv.id = d."leftRecipeVersionId"
           JOIN "RecipeVersion" rv ON rv.id = d."rightRecipeVersionId"
           JOIN "Recipe" lr ON lr.id = lv."recipeId"
           JOIN "Recipe" rr ON rr.id = rv."recipeId"
           WHERE d.status = 'OPEN'
             AND d.classification IN ('EXACT', 'EXACT_DUPLICATE')
             AND COALESCE(lr."dataClass", 'PRODUCTION') = 'PRODUCTION'
             AND COALESCE(rr."dataClass", 'PRODUCTION') = 'PRODUCTION'
             AND NOT ${RECIPE_TEST_KEY_SQL.replaceAll('"recipeKey"', 'lr."recipeKey"')}
             AND NOT ${RECIPE_TEST_KEY_SQL.replaceAll('"recipeKey"', 'rr."recipeKey"')}`,
        ),
        this.db.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM "MediaAsset"
           WHERE "rightsStatus" IN ('BLOCKED', 'TAKEDOWN', 'REJECTED')
              OR "moderationStatus" IN ('REJECTED', 'BLOCKED')`,
        ),
        this.db.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM "RecipeProductDependency"
           WHERE "resolutionStatus" = 'LEGACY_UNRESOLVED'`,
        ),
        this.db.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM "RecipeSearchDecision"
           WHERE ("expiresAt" < NOW() AND "usedAt" IS NULL)
              OR "invalidatedAt" IS NOT NULL`,
        ),
        this.db.query<{ cnt: string; reasonSetJson: unknown }>(
          `SELECT 1::text AS cnt, "reasonSetJson" FROM "RecipeCoverageDirtyState" WHERE "matrixVersion" = $1`,
          [matrixVersion],
        ),
        this.db.query<{ id: string; completedAt: Date | null; mode: string; status: string }>(
          `SELECT id, "completedAt", mode, status FROM "RecipeCoverageAnalysisRun"
           WHERE "matrixVersion" = $1
           ORDER BY "startedAt" DESC NULLS LAST LIMIT 1`,
          [matrixVersion],
        ),
        this.db.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt
           FROM "Recipe" r
           JOIN "RecipeVersion" v ON v.id = r."currentVersionId"
           JOIN "RecipeVersionLifecycle" l ON l."recipeVersionId" = v.id
           WHERE COALESCE(r."dataClass", 'PRODUCTION') = 'PRODUCTION'
             AND NOT ${RECIPE_TEST_KEY_SQL.replaceAll('"recipeKey"', 'r."recipeKey"')}
             AND l."lifecycleStatus" = 'PUBLISHED'
             AND l."validationStatus" = 'VALID'`,
        ),
      ]);

    const byClass: Record<string, number> = {};
    for (const row of recipes.rows) byClass[row.dataClass] = Number(row.cnt);
    const byStatus: Record<string, number> = {};
    for (const row of coverage.rows) byStatus[row.status] = Number(row.cnt);

    return {
      productionRecipes: byClass.PRODUCTION ?? 0,
      testOnlyRecipes: byClass.TEST_ONLY ?? 0,
      fixtureRecipes: byClass.FIXTURE ?? 0,
      historicalRecipes: byClass.HISTORICAL_ONLY ?? 0,
      legacyRecipes: byClass.LEGACY ?? 0,
      archivedDataRecipes: byClass.ARCHIVED_DATA ?? 0,
      eligibleCurrentVersions: Number(eligible.rows[0]?.cnt ?? 0),
      coverageEmpty: byStatus.EMPTY ?? 0,
      coverageUnderfilled: byStatus.UNDERFILLED ?? 0,
      coverageCovered: byStatus.COVERED ?? 0,
      coverageOverfilled: byStatus.OVERFILLED ?? 0,
      coverageNeedsRefresh: byStatus.NEEDS_REFRESH ?? 0,
      openRevalidation: Number(revalidation.rows[0]?.cnt ?? 0),
      duplicateBlockers: Number(duplicates.rows[0]?.cnt ?? 0),
      mediaRightsBlockers: Number(media.rows[0]?.cnt ?? 0),
      unresolvedDependencies: Number(deps.rows[0]?.cnt ?? 0),
      staleSearchDecisions: Number(search.rows[0]?.cnt ?? 0),
      dirtyCoverage: dirty.rows.length > 0 ? 1 : 0,
      dirtyReasons: dirty.rows[0]?.reasonSetJson ?? [],
      lastCoverageAnalyzerRun: lastRun.rows[0] ?? null,
      matrixVersion,
      links: {
        recipesProduction: '/admin/recipes?dataClass=PRODUCTION',
        recipesTest: '/admin/recipes?dataClass=TEST_ONLY,HISTORICAL_ONLY,FIXTURE,LEGACY',
        coverageEmpty: '/admin/recipe-coverage?status=EMPTY',
        coverageUnderfilled: '/admin/recipe-coverage?status=UNDERFILLED',
        revalidation: '/admin/recipe-revalidation?status=OPEN',
        duplicates: '/admin/recipe-duplicates?status=OPEN&classification=EXACT_DUPLICATE',
        media: '/admin/media?rightsBlocker=1',
        staleSearch: '/admin/recipe-coverage?staleSearch=1',
        dirtyCoverage: '/admin/recipe-coverage?dirty=1',
        unresolvedDependencies: '/admin/recipes?dataClass=PRODUCTION&unresolvedDeps=1',
      },
    };
  }

  async listCatalog(filters: RecipeCatalogFilters) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
    const offset = (page - 1) * pageSize;
    let dataClasses: RecipeDataClass[] | null;
    try {
      dataClasses = parseRecipeDataClassFilter(filters.dataClass, { defaultProductionOnly: true });
    } catch {
      throw new Error('RECIPE_DATA_CLASS_FILTER_INVALID');
    }

    const where: string[] = [];
    const params: unknown[] = [];
    if (dataClasses) {
      params.push(dataClasses);
      where.push(`COALESCE(r."dataClass", 'PRODUCTION') = ANY($${params.length}::text[])`);
      if (dataClasses.length === 1 && dataClasses[0] === 'PRODUCTION') {
        where.push(`NOT ${RECIPE_TEST_KEY_SQL.replaceAll('"recipeKey"', 'r."recipeKey"')}`);
      }
    }
    if (filters.q?.trim()) {
      params.push(filters.q.trim());
      const p = `$${params.length}`;
      where.push(`(r.name ILIKE '%' || ${p} || '%' OR COALESCE(r."recipeKey", '') ILIKE '%' || ${p} || '%')`);
    }
    if (filters.lifecycle?.trim()) {
      params.push(filters.lifecycle.trim().toUpperCase());
      where.push(`l."lifecycleStatus" = $${params.length}`);
    }
    if (filters.validation?.trim()) {
      params.push(filters.validation.trim().toUpperCase());
      where.push(`l."validationStatus" = $${params.length}`);
    }
    if (filters.familyAssigned === 'yes') where.push(`r."recipeFamilyId" IS NOT NULL`);
    if (filters.familyAssigned === 'no') where.push(`r."recipeFamilyId" IS NULL`);
    if (filters.currentPublished === 'yes') {
      where.push(`l."lifecycleStatus" = 'PUBLISHED' AND r."currentVersionId" IS NOT NULL`);
    }
    if (filters.currentPublished === 'no') {
      where.push(`(l."lifecycleStatus" IS DISTINCT FROM 'PUBLISHED' OR r."currentVersionId" IS NULL)`);
    }
    if (filters.duplicateBlocker === 'yes') {
      where.push(`EXISTS (
        SELECT 1 FROM "RecipeDuplicateCandidate" d
        WHERE d.status = 'OPEN' AND d.classification IN ('EXACT', 'EXACT_DUPLICATE')
          AND (d."leftRecipeVersionId" = r."currentVersionId" OR d."rightRecipeVersionId" = r."currentVersionId")
      )`);
    }
    if (filters.revalidationOpen === 'yes') {
      where.push(`EXISTS (
        SELECT 1 FROM "RecipeRevalidationTask" t
        WHERE t."recipeVersionId" = r."currentVersionId" AND t.status = 'OPEN'
      )`);
    }
    if (filters.mediaMissing === 'yes') {
      where.push(`NOT EXISTS (
        SELECT 1 FROM "RecipeVersionMedia" m WHERE m."recipeVersionId" = r."currentVersionId"
      )`);
    }
    if (filters.coverageAssigned === 'yes') {
      where.push(`EXISTS (
        SELECT 1 FROM "RecipeCoverageAssignment" a
        WHERE a."recipeVersionId" = r."currentVersionId" AND a.active = true
      )`);
    }
    if (filters.coverageAssigned === 'no') {
      where.push(`NOT EXISTS (
        SELECT 1 FROM "RecipeCoverageAssignment" a
        WHERE a."recipeVersionId" = r."currentVersionId" AND a.active = true
      )`);
    }
    if (filters.fingerprintMissing === 'yes') {
      where.push(`r."currentVersionId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "RecipeFingerprint" f WHERE f."recipeVersionId" = r."currentVersionId"
      )`);
    }
    if (filters.dependencyUnresolved === 'yes') {
      where.push(`EXISTS (
        SELECT 1 FROM "RecipeProductDependency" d
        WHERE d."recipeVersionId" = r."currentVersionId" AND d."resolutionStatus" = 'LEGACY_UNRESOLVED'
      )`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sortMap: Record<string, string> = {
      name: 'r.name',
      updatedAt: 'r."createdAt"',
      lifecycle: 'l."lifecycleStatus"',
      dataClass: 'COALESCE(r."dataClass", \'PRODUCTION\')',
    };
    const sortCol = sortMap[filters.sort ?? 'name'] ?? 'r.name';
    const order = filters.order === 'desc' ? 'DESC' : 'ASC';

    const count = await this.db.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt
       FROM "Recipe" r
       LEFT JOIN "RecipeVersion" v ON v.id = r."currentVersionId"
       LEFT JOIN "RecipeVersionLifecycle" l ON l."recipeVersionId" = v.id
       ${whereSql}`,
      params,
    );

    const listParams = [...params, pageSize, offset];
    const rows = await this.db.query<{
      id: string;
      name: string;
      recipeKey: string | null;
      dataClass: string;
      recipeFamilyId: string | null;
      familyName: string | null;
      currentVersionId: string | null;
      currentVersionNumber: number | null;
      lifecycleStatus: string | null;
      validationStatus: string | null;
      publishedAt: Date | null;
      updatedAt: Date;
      duplicateOpen: boolean;
      revalidationOpen: boolean;
      mediaCount: string;
      coverageCount: string;
      unresolvedDeps: string;
      fingerprintMissing: boolean;
    }>(
      `SELECT r.id, r.name, r."recipeKey", COALESCE(r."dataClass", 'PRODUCTION') AS "dataClass",
              r."recipeFamilyId", f."canonicalName" AS "familyName",
              r."currentVersionId", v."versionNumber" AS "currentVersionNumber",
              l."lifecycleStatus", l."validationStatus", v."publishedAt",
              r."createdAt" AS "updatedAt",
              EXISTS (
                SELECT 1 FROM "RecipeDuplicateCandidate" d
                WHERE d.status = 'OPEN' AND d.classification IN ('EXACT', 'EXACT_DUPLICATE')
                  AND (d."leftRecipeVersionId" = r."currentVersionId" OR d."rightRecipeVersionId" = r."currentVersionId")
              ) AS "duplicateOpen",
              EXISTS (
                SELECT 1 FROM "RecipeRevalidationTask" t
                WHERE t."recipeVersionId" = r."currentVersionId" AND t.status = 'OPEN'
              ) AS "revalidationOpen",
              (SELECT COUNT(*)::text FROM "RecipeVersionMedia" m WHERE m."recipeVersionId" = r."currentVersionId") AS "mediaCount",
              (SELECT COUNT(*)::text FROM "RecipeCoverageAssignment" a
                WHERE a."recipeVersionId" = r."currentVersionId" AND a.active = true) AS "coverageCount",
              (SELECT COUNT(*)::text FROM "RecipeProductDependency" d
                WHERE d."recipeVersionId" = r."currentVersionId" AND d."resolutionStatus" = 'LEGACY_UNRESOLVED') AS "unresolvedDeps",
              (r."currentVersionId" IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM "RecipeFingerprint" fp WHERE fp."recipeVersionId" = r."currentVersionId"
              )) AS "fingerprintMissing"
       FROM "Recipe" r
       LEFT JOIN "RecipeVersion" v ON v.id = r."currentVersionId"
       LEFT JOIN "RecipeVersionLifecycle" l ON l."recipeVersionId" = v.id
       LEFT JOIN "RecipeFamily" f ON f.id = r."recipeFamilyId"
       ${whereSql}
       ORDER BY ${sortCol} ${order}, r.id ASC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams,
    );

    const items = rows.rows.map((row) => {
      const dataClass = resolveRecipeDataClass({ dataClass: row.dataClass, recipeKey: row.recipeKey });
      return {
        id: row.id,
        name: row.name,
        recipeKey: row.recipeKey,
        dataClass,
        dataClassLabelRu: recipeDataClassLabelRu(dataClass),
        familyName: row.familyName,
        recipeFamilyId: row.recipeFamilyId,
        currentVersionId: row.currentVersionId,
        currentVersionNumber: row.currentVersionNumber,
        lifecycleStatus: row.lifecycleStatus,
        lifecycleLabelRu: lifecycleStatusLabelRu(row.lifecycleStatus),
        validationStatus: row.validationStatus,
        publication: versionPublicationDisplay({
          lifecycleStatus: row.lifecycleStatus,
          publishedAt: row.publishedAt,
        }),
        duplicateStatus: row.duplicateOpen ? 'BLOCKER_OPEN' : 'NONE',
        revalidationOpen: row.revalidationOpen,
        mediaStatus: Number(row.mediaCount) > 0 ? 'PRESENT' : 'MISSING',
        coverageAssignedCount: Number(row.coverageCount),
        unresolvedDependencyCount: Number(row.unresolvedDeps),
        fingerprintMissing: row.fingerprintMissing,
        updatedAt: row.updatedAt,
      };
    });

    return {
      items,
      total: Number(count.rows[0]?.cnt ?? 0),
      page,
      pageSize,
      defaultDataClassFilter: DEFAULT_RECIPE_CATALOG_DATA_CLASSES,
      activeDataClassFilter: dataClasses ?? 'ALL',
    };
  }

  async getRecipeWorkspace(recipeId: string, role?: string) {
    const recipe = await this.db.query<{
      id: string;
      name: string;
      recipeKey: string | null;
      dataClass: string;
      recipeFamilyId: string | null;
      familyName: string | null;
      currentVersionId: string | null;
      contentRevision: number;
    }>(
      `SELECT r.id, r.name, r."recipeKey", COALESCE(r."dataClass", 'PRODUCTION') AS "dataClass",
              r."recipeFamilyId", f."canonicalName" AS "familyName",
              r."currentVersionId", r."contentRevision"
       FROM "Recipe" r
       LEFT JOIN "RecipeFamily" f ON f.id = r."recipeFamilyId"
       WHERE r.id = $1 LIMIT 1`,
      [recipeId],
    );
    const row = recipe.rows[0];
    if (!row) return null;

    const versions = await this.db.query<{
      id: string;
      versionNumber: number;
      changeReason: string | null;
      createdAt: Date;
      createdBy: string | null;
      publishedAt: Date | null;
      checksum: string;
      lifecycleStatus: string | null;
      validationStatus: string | null;
      isCurrent: boolean;
      mealItemUsage: string;
      openIssues: string;
    }>(
      `SELECT v.id, v."versionNumber", v."changeReason", v."createdAt", v."createdBy",
              v."publishedAt", v.checksum,
              l."lifecycleStatus", l."validationStatus",
              (r."currentVersionId" = v.id) AS "isCurrent",
              (SELECT COUNT(*)::text FROM "MealItem" mi WHERE mi."recipeVersionId" = v.id) AS "mealItemUsage",
              (SELECT COUNT(*)::text FROM "RecipeRevalidationTask" t
                WHERE t."recipeVersionId" = v.id AND t.status = 'OPEN') AS "openIssues"
       FROM "RecipeVersion" v
       JOIN "Recipe" r ON r.id = v."recipeId"
       LEFT JOIN "RecipeVersionLifecycle" l ON l."recipeVersionId" = v.id
       WHERE v."recipeId" = $1
       ORDER BY v."versionNumber" ASC`,
      [recipeId],
    );

    const current = versions.rows.find((v) => v.isCurrent) ?? versions.rows[versions.rows.length - 1] ?? null;
    const allowedActions: RecipeLifecycleAction[] = current
      ? listAllowedLifecycleActions({
          lifecycleStatus: current.lifecycleStatus,
          validationStatus: current.validationStatus,
          role,
        })
      : [];

    const dataClass = resolveRecipeDataClass({ dataClass: row.dataClass, recipeKey: row.recipeKey });
    const eligible = current
      ? isUsableForNewPlans({
          lifecycleStatus: current.lifecycleStatus,
          validationStatus: current.validationStatus,
          currentVersionId: row.currentVersionId,
          recipeVersionId: current.id,
        })
      : false;

    const coverage = current
      ? await this.db.query<{
          slotId: string;
          slotKey: string;
          status: string;
          assignmentType: string;
        }>(
          `SELECT s.id AS "slotId", s."slotKey", s.status, a."assignmentType"
           FROM "RecipeCoverageAssignment" a
           JOIN "RecipeCoverageSlot" s ON s.id = a."slotId"
           WHERE a."recipeVersionId" = $1 AND a.active = true
           ORDER BY a."assignedAt" DESC
           LIMIT 20`,
          [current.id],
        )
      : { rows: [] as Array<{ slotId: string; slotKey: string; status: string; assignmentType: string }> };

    const duplicates = current
      ? await this.db.query<{
          id: string;
          classification: string;
          score: string;
          status: string;
          reasonsJson: unknown;
          leftRecipeVersionId: string;
          rightRecipeVersionId: string;
          pairKey: string;
        }>(
          `SELECT d.id, d.classification, d.score::text AS score, d.status, d."reasonsJson",
                  d."leftRecipeVersionId", d."rightRecipeVersionId", d."pairKey"
           FROM "RecipeDuplicateCandidate" d
           WHERE d.status = 'OPEN'
             AND (d."leftRecipeVersionId" = $1 OR d."rightRecipeVersionId" = $1)
           ORDER BY d."detectedAt" DESC
           LIMIT 20`,
          [current.id],
        )
      : { rows: [] };

    return {
      recipe: {
        id: row.id,
        name: row.name,
        recipeKey: row.recipeKey,
        dataClass,
        dataClassLabelRu: recipeDataClassLabelRu(dataClass),
        recipeFamilyId: row.recipeFamilyId,
        familyName: row.familyName,
        currentVersionId: row.currentVersionId,
        contentRevision: row.contentRevision,
      },
      overview: {
        lifecycleStatus: current?.lifecycleStatus ?? null,
        lifecycleLabelRu: lifecycleStatusLabelRu(current?.lifecycleStatus),
        validationStatus: current?.validationStatus ?? null,
        currentVersionNumber: current?.versionNumber ?? null,
        eligibleForNewPlans: eligible,
        ineligibleReasonRu: eligible
          ? null
          : !current
            ? 'Нет текущей версии'
            : current.lifecycleStatus !== 'PUBLISHED'
              ? 'Текущая версия не опубликована'
              : current.validationStatus !== 'VALID'
                ? 'Требуется ревалидация или версия заблокирована'
                : 'Версия не назначена current',
        coverageSlots: coverage.rows,
        duplicateBlockers: duplicates.rows.map((d) => ({
          id: d.id,
          classification: d.classification,
          score: d.score,
          status: d.status,
          reasons: d.reasonsJson,
          contentGroupId: d.pairKey,
          publicationBlocker:
            d.classification === 'EXACT' || d.classification === 'EXACT_DUPLICATE',
          href: `/admin/recipe-duplicates?status=OPEN&candidateId=${d.id}`,
        })),
        suspendFallbackPolicy: SUSPEND_FALLBACK_POLICY,
      },
      versions: versions.rows.map((v) => {
        const pub = versionPublicationDisplay({
          lifecycleStatus: v.lifecycleStatus,
          publishedAt: v.publishedAt,
        });
        return {
          id: v.id,
          versionNumber: v.versionNumber,
          createdAt: v.createdAt,
          createdBy: v.createdBy,
          changeReason: v.changeReason,
          lifecycleStatus: v.lifecycleStatus,
          lifecycleLabelRu: lifecycleStatusLabelRu(v.lifecycleStatus),
          validationStatus: v.validationStatus,
          isCurrent: v.isCurrent,
          publishedAt: v.publishedAt,
          publication: pub,
          checksumShort: v.checksum?.slice(0, 12) ?? null,
          mealItemUsageCount: Number(v.mealItemUsage),
          openIssues: Number(v.openIssues),
          allowedActions: v.isCurrent
            ? listAllowedLifecycleActions({
                lifecycleStatus: v.lifecycleStatus,
                validationStatus: v.validationStatus,
                role,
              }).map((a) => ({ code: a, labelRu: lifecycleActionLabelRu(a) }))
            : [],
        };
      }),
      allowedActions: allowedActions.map((a) => ({ code: a, labelRu: lifecycleActionLabelRu(a) })),
      tabs: [
        'overview',
        'working',
        'versions',
        'ingredients',
        'steps',
        'nutrition',
        'lifecycle',
        'dependencies',
        'revalidation',
        'coverage',
        'search',
        'duplicates',
        'media',
        'audit',
        'technical',
      ],
    };
  }

  async getVersionWorkspace(recipeId: string, versionId: string, role?: string) {
    const version = await this.db.query(
      `SELECT v.*, l."lifecycleStatus", l."validationStatus",
              (r."currentVersionId" = v.id) AS "isCurrent",
              r.name AS "recipeName", r."recipeKey", COALESCE(r."dataClass", 'PRODUCTION') AS "dataClass"
       FROM "RecipeVersion" v
       JOIN "Recipe" r ON r.id = v."recipeId"
       LEFT JOIN "RecipeVersionLifecycle" l ON l."recipeVersionId" = v.id
       WHERE v.id = $1 AND v."recipeId" = $2
       LIMIT 1`,
      [versionId, recipeId],
    );
    const row = version.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;

    const deps = await this.db.query(
      `SELECT d.*, p.name AS "productName"
       FROM "RecipeProductDependency" d
       LEFT JOIN "Product" p ON p.id = d."productId"
       WHERE d."recipeVersionId" = $1
       ORDER BY d."ingredientIndex" ASC, d."createdAt" ASC`,
      [versionId],
    );

    const tasks = await this.db.query(
      `SELECT t.*, p.name AS "productName"
       FROM "RecipeRevalidationTask" t
       LEFT JOIN "Product" p ON p.id = t."productId"
       WHERE t."recipeVersionId" = $1
       ORDER BY CASE t.severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 ELSE 2 END,
                t."lastDetectedAt" DESC`,
      [versionId],
    );

    const media = await this.db.query(
      `SELECT m.id AS "linkId", m.role, m.position AS "sortOrder", m."altText",
              a.id AS "mediaAssetId", a."sourceType" AS source, a."licenseType",
              a."rightsStatus", a."moderationStatus", a."rightsValidUntil" AS "expiresAt"
       FROM "RecipeVersionMedia" m
       JOIN "MediaAsset" a ON a.id = m."mediaAssetId"
       WHERE m."recipeVersionId" = $1
       ORDER BY m.position ASC, m."createdAt" ASC`,
      [versionId],
    );

    const parentId = row.parentVersionId as string | null;
    let diff = null;
    if (parentId) {
      const parent = await this.db.query(`SELECT * FROM "RecipeVersion" WHERE id = $1 LIMIT 1`, [parentId]);
      if (parent.rows[0]) {
        diff = diffRecipeVersions({
          before: parent.rows[0] as never,
          after: row as never,
        });
      }
    }

    const lifecycleStatus = row.lifecycleStatus as string | null;
    const validationStatus = row.validationStatus as string | null;
    const allowedActions = listAllowedLifecycleActions({
      lifecycleStatus,
      validationStatus,
      role,
    });

    const unresolved = deps.rows.filter(
      (d: { resolutionStatus?: string }) => d.resolutionStatus === 'LEGACY_UNRESOLVED',
    );

    return {
      version: {
        id: row.id,
        versionNumber: row.versionNumber,
        recipeId: row.recipeId,
        recipeName: row.recipeName,
        recipeKey: row.recipeKey,
        dataClass: resolveRecipeDataClass({
          dataClass: row.dataClass as string,
          recipeKey: row.recipeKey as string | null,
        }),
        lifecycleStatus,
        lifecycleLabelRu: lifecycleStatusLabelRu(lifecycleStatus),
        validationStatus,
        isCurrent: row.isCurrent,
        publication: versionPublicationDisplay({
          lifecycleStatus,
          publishedAt: row.publishedAt as Date | null,
        }),
        changeReason: row.changeReason,
        checksumShort: String(row.checksum ?? '').slice(0, 12),
      },
      allowedActions: allowedActions.map((a) => ({ code: a, labelRu: lifecycleActionLabelRu(a) })),
      dependencies: deps.rows.map((d: Record<string, unknown>) => ({
        id: d.id,
        productId: d.productId,
        productName: d.productName,
        amount: d.amount,
        unit: d.unit,
        ingredientPosition: d.ingredientIndex,
        productNutritionVersionId: d.productNutritionVersionId,
        resolutionStatus: d.resolutionStatus,
        presentation:
          d.resolutionStatus === 'LEGACY_UNRESOLVED'
            ? {
                labelRu: 'Версия КБЖУ продукта не установлена',
                impactsValidation: true,
                usableInNewPlans: false,
              }
            : {
                labelRu: 'Зависимость разрешена',
                impactsValidation: false,
                usableInNewPlans: true,
              },
      })),
      unresolvedDependencyCount: unresolved.length,
      revalidationTasks: tasks.rows.map((t: Record<string, unknown>) => ({
        id: t.id,
        productId: t.productId,
        productName: t.productName,
        reasonCode: t.reasonCode,
        severity: t.severity,
        status: t.status,
        detectedAt: t.firstDetectedAt,
        lastDetectedAt: t.lastDetectedAt,
        occurrenceCount: t.occurrenceCount,
        isCritical: t.severity === 'CRITICAL',
        severityLabelRu:
          t.severity === 'CRITICAL' ? 'Критично' : t.severity === 'HIGH' ? 'Высокий' : 'Предупреждение',
      })),
      media: media.rows.map((m: Record<string, unknown>) => ({
        linkId: m.linkId,
        mediaAssetId: m.mediaAssetId,
        role: m.role,
        altText: m.altText,
        source: m.source,
        licenseType: m.licenseType,
        rightsStatus: m.rightsStatus,
        moderationStatus: m.moderationStatus,
        expiresAt: m.expiresAt,
        publicationEligible:
          String(m.rightsStatus) === 'APPROVED' && String(m.moderationStatus) === 'APPROVED',
      })),
      diff,
      technical: {
        noteRu: 'Технический snapshot только для OWNER/ADMIN. Read-only.',
        contentSnapshotJson: row.contentSnapshotJson,
        ingredientsSnapshotJson: row.ingredientsSnapshotJson,
        stepsSnapshotJson: row.stepsSnapshotJson,
        nutritionSnapshotJson: row.nutritionSnapshotJson,
        costSnapshotJson: row.costSnapshotJson,
        restrictionSnapshotJson: row.restrictionSnapshotJson,
        checksum: row.checksum,
        provenance: row.provenance,
      },
    };
  }

  async getCoverageBoard(filters: {
    matrixVersion?: string;
    status?: string;
    priority?: string;
    mealType?: string;
    primaryProductId?: string;
    dishType?: string;
    cookingMethod?: string;
    dietaryProfile?: string;
    equipment?: string;
    hasAssignments?: string;
    hasAmbiguous?: string;
    dirty?: string;
    q?: string;
    limit?: number;
    offset?: number;
  }) {
    const matrixVersion = filters.matrixVersion?.trim() || COVERAGE_MATRIX_VERSION_V1;
    const where: string[] = [`s."matrixVersion" = $1`, `s.active = true`];
    const params: unknown[] = [matrixVersion];
    const addEq = (col: string, value: string) => {
      params.push(value.toUpperCase());
      where.push(`${col} = $${params.length}`);
    };
    if (filters.status) addEq('s.status', filters.status);
    if (filters.priority) addEq('s.priority', filters.priority);
    if (filters.mealType) addEq('s."mealType"', filters.mealType);
    if (filters.primaryProductId) {
      params.push(filters.primaryProductId);
      where.push(`s."primaryProductId" = $${params.length}::uuid`);
    }
    if (filters.dishType) addEq('s."dishType"', filters.dishType);
    if (filters.cookingMethod) addEq('s."cookingMethod"', filters.cookingMethod);
    if (filters.dietaryProfile) addEq('s."dietaryProfile"', filters.dietaryProfile);
    if (filters.equipment) addEq('s."equipmentProfile"', filters.equipment);
    if (filters.q?.trim()) {
      params.push(filters.q.trim());
      where.push(
        `(s."slotKey" ILIKE '%' || $${params.length} || '%' OR s.name ILIKE '%' || $${params.length} || '%')`,
      );
    }
    if (filters.hasAssignments === 'yes') {
      where.push(`EXISTS (SELECT 1 FROM "RecipeCoverageAssignment" a WHERE a."slotId" = s.id AND a.active = true)`);
    }
    if (filters.hasAmbiguous === 'yes') {
      where.push(`EXISTS (
        SELECT 1 FROM "RecipeCoverageAssignment" a
        WHERE a."slotId" = s.id AND a.active = true AND a."matchStatus" = 'AMBIGUOUS'
      )`);
    }
    if (filters.dirty === 'yes') {
      where.push(`EXISTS (
        SELECT 1 FROM "RecipeCoverageDirtyState" d
        WHERE d."matrixVersion" = s."matrixVersion"
          AND d."affectedSlotIdsJson" ? s.id::text
      )`);
    }

    const whereSql = `WHERE ${where.join(' AND ')}`;
    const summary = await this.db.query<{ status: string; cnt: string; desired: string; published: string }>(
      `SELECT s.status,
              COUNT(*)::text AS cnt,
              COALESCE(SUM(s."desiredRecipeCount"), 0)::text AS desired,
              COALESCE(SUM(s."publishedRecipeCount"), 0)::text AS published
       FROM "RecipeCoverageSlot" s
       ${whereSql}
       GROUP BY s.status`,
      params,
    );

    const dirtyState = await this.db.query<{ reasonSetJson: unknown; affectedSlotIdsJson: unknown }>(
      `SELECT "reasonSetJson", "affectedSlotIdsJson" FROM "RecipeCoverageDirtyState" WHERE "matrixVersion" = $1`,
      [matrixVersion],
    );
    const dirtySlotIds = new Set<string>(
      Array.isArray(dirtyState.rows[0]?.affectedSlotIdsJson)
        ? (dirtyState.rows[0]!.affectedSlotIdsJson as string[])
        : [],
    );

    const limit = Math.min(200, Math.max(1, filters.limit ?? 60));
    const offset = Math.max(0, filters.offset ?? 0);
    const listParams = [...params, limit, offset];
    const slots = await this.db.query(
      `SELECT s.id, s."slotKey", s.name, s.priority, s."mealType",
              s."primaryProductId", p."productKey" AS "primaryProductKey",
              COALESCE(NULLIF(p.name, ''), NULLIF(p."canonicalName", ''), p."productKey") AS "primaryProductName",
              s."dishType", s."cookingMethod",
              s."dietaryProfile", s."equipmentProfile",
              s."calorieMin", s."calorieMax", s."maximumTimeMinutes",
              s."desiredRecipeCount", s."publishedRecipeCount", s.status, s."lastAnalyzedAt",
              (SELECT COUNT(*)::int FROM "RecipeCoverageAssignment" a
                WHERE a."slotId" = s.id AND a.active = true AND a."matchStatus" = 'AMBIGUOUS') AS "ambiguousCount"
       FROM "RecipeCoverageSlot" s
       LEFT JOIN "Product" p ON p.id = s."primaryProductId"
       ${whereSql}
       ORDER BY
         CASE s.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
         s."sortRank" ASC, s."slotKey" ASC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams,
    );

    const columns: Record<string, unknown[]> = {
      EMPTY: [],
      UNDERFILLED: [],
      COVERED: [],
      OVERFILLED: [],
      NEEDS_REFRESH: [],
    };

    for (const slot of slots.rows as Array<Record<string, unknown>>) {
      const card = {
        id: slot.id,
        slotKey: slot.slotKey,
        displayName: formatCoverageSlotDisplayTitleRu({
          mealType: slot.mealType as string | null,
          primaryProductName: slot.primaryProductName as string | null,
          dishType: slot.dishType as string | null,
          cookingMethod: slot.cookingMethod as string | null,
          dietaryProfile: slot.dietaryProfile as string | null,
        }),
        priority: slot.priority,
        mealType: slot.mealType,
        primaryProductKey: slot.primaryProductKey,
        primaryProductName: slot.primaryProductName,
        dishType: slot.dishType,
        cookingMethod: slot.cookingMethod,
        dietaryProfile: slot.dietaryProfile,
        equipmentProfile: slot.equipmentProfile,
        calorieMin: slot.calorieMin,
        calorieMax: slot.calorieMax,
        maximumTimeMinutes: slot.maximumTimeMinutes,
        desiredCount: slot.desiredRecipeCount,
        currentUniqueCount: slot.publishedRecipeCount,
        ambiguousCandidates: Number(slot.ambiguousCount ?? 0),
        lastAnalyzedAt: slot.lastAnalyzedAt,
        dirty: dirtySlotIds.has(String(slot.id)),
        status: slot.status,
        statusLabelRu: coverageBoardColumnLabelRu(String(slot.status)),
        topBlockingReason: null as string | null,
        detailHref: `/admin/recipe-coverage/slots?selected=${slot.id}`,
      };
      const bucket = String(slot.status);
      if (columns[bucket]) columns[bucket].push(card);
      else columns.NEEDS_REFRESH.push(card);
    }

    const statusCounts: Record<string, number> = {};
    let desiredTotal = 0;
    let uniqueTotal = 0;
    for (const row of summary.rows) {
      statusCounts[row.status] = Number(row.cnt);
      desiredTotal += Number(row.desired);
      uniqueTotal += Number(row.published);
    }

    const lastRun = await this.db.query(
      `SELECT id, mode, "startedAt", "completedAt", status
       FROM "RecipeCoverageAnalysisRun"
       WHERE "matrixVersion" = $1
       ORDER BY "startedAt" DESC NULLS LAST LIMIT 1`,
      [matrixVersion],
    );

    return {
      matrixVersion,
      mode: 'BOARD',
      summary: {
        totalSlots: Object.values(statusCounts).reduce((a, b) => a + b, 0),
        byStatus: statusCounts,
        desiredTotal,
        currentUniqueCoverage: uniqueTotal,
        dirty: dirtyState.rows.length > 0,
        dirtyReasons: dirtyState.rows[0]?.reasonSetJson ?? [],
        lastAnalyzerRun: lastRun.rows[0] ?? null,
      },
      columns,
      columnLabelsRu: {
        EMPTY: coverageBoardColumnLabelRu('EMPTY'),
        UNDERFILLED: coverageBoardColumnLabelRu('UNDERFILLED'),
        COVERED: coverageBoardColumnLabelRu('COVERED'),
        OVERFILLED: coverageBoardColumnLabelRu('OVERFILLED'),
        NEEDS_REFRESH: coverageBoardColumnLabelRu('NEEDS_REFRESH'),
      },
      itemsFlat: Object.values(columns).flat(),
      limit,
      offset,
      recommendationLabelsRu: {
        USE_EXISTING_RECIPE: searchRecommendationLabelRu('USE_EXISTING_RECIPE'),
        ADJUST_PORTION_OF_EXISTING: searchRecommendationLabelRu('ADJUST_PORTION_OF_EXISTING'),
        ADAPT_EXISTING_RECIPE: searchRecommendationLabelRu('ADAPT_EXISTING_RECIPE'),
        CREATE_FAMILY_VARIANT: searchRecommendationLabelRu('CREATE_FAMILY_VARIANT'),
        REVIEW_DUPLICATE_CANDIDATES: searchRecommendationLabelRu('REVIEW_DUPLICATE_CANDIDATES'),
        RESEARCH_REQUIRED: searchRecommendationLabelRu('RESEARCH_REQUIRED'),
        BLOCKED_NO_SAFE_ACTION: searchRecommendationLabelRu('BLOCKED_NO_SAFE_ACTION'),
      },
    };
  }

  async classifyRecipe(input: {
    recipeId: string;
    dataClass: RecipeDataClass;
    actorUserId: string;
    actorRole: string;
    reason?: string;
  }) {
    const role = String(input.actorRole ?? '').toUpperCase();
    if (!hasAdminAuthority(role)) throw new Error('OWNER_ACCESS_FORBIDDEN');
    await this.db.query(`UPDATE "Recipe" SET "dataClass" = $2 WHERE id = $1`, [
      input.recipeId,
      input.dataClass,
    ]);
    return { recipeId: input.recipeId, dataClass: input.dataClass };
  }
}
