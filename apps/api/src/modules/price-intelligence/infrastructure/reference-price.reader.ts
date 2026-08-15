import type { SqlQuery } from '../../../infrastructure/database/prisma.service';
import {
  freshnessStatus,
  type PriceCondition,
  type ReferencePriceEvidence,
} from '../domain/reference-price.core';

type ReferenceRow = {
  productId: string;
  price: string;
  currency: string;
  observedAt: string;
  freshUntil: string | null;
  normalizedPackageQuantity: string | null;
  normalizedPackageUnit: string | null;
  unitPrice: string | null;
  unitPriceUnit: string | null;
  priceCondition: PriceCondition;
  retailerId: string | null;
  retailerName: string | null;
  retailerCode: string | null;
  storeId: string | null;
  locationScope: string | null;
  sourceType: string | null;
  sourceName: string | null;
  evidenceObservationId: string | null;
  retailProductId: string | null;
  observedPackageWeight: string | null;
  observedPackageUnit: string | null;
  availability: string | null;
  confidence: string | null;
  dataClass: string | null;
  sourceUrl: string | null;
  evidenceSha256: string | null;
  acquiredAt: string | null;
  acquisitionTimeQuality: string | null;
};

export type ReferencePriceReadOptions = {
  storeId?: string;
  regionId?: string;
  regionCode?: string;
  retailerId?: string;
  now?: Date;
  locationScope?: 'STORE' | 'DELIVERY_ADDRESS' | 'CITY' | 'REGION' | 'UNKNOWN';
};

function unknown(productId: string): ReferencePriceEvidence {
  return {
    status: 'UNKNOWN', price: null, currency: 'RUB', normalizedUnitPrice: null,
    normalizedUnit: null, priceCondition: 'UNKNOWN_CONDITION', observedAt: null,
    freshUntil: null, productId,
  };
}

export async function readReferencePriceWithQuery(
  query: SqlQuery,
  productId: string,
  options: ReferencePriceReadOptions = {},
): Promise<ReferencePriceEvidence> {
  const effectiveNow = (options.now ?? new Date()).toISOString();
  const result = await query<ReferenceRow>(
    `SELECT ps."productId", ps.price::text, po.currency,
            to_char(ps."observedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "observedAt",
            CASE WHEN ps."freshUntil" IS NULL THEN NULL ELSE to_char(ps."freshUntil", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS "freshUntil",
            ps."normalizedPackageQuantity"::text,
            ps."normalizedPackageUnit", ps."unitPrice"::text, ps."unitPriceUnit",
            ps."priceCondition", ps."retailerId", r.name AS "retailerName", r.code AS "retailerCode",
            ps."storeId", rs."locationScope", ps."sourceType", ps."sourceName",
            ps."evidenceObservationId", po."retailProductId", po."observedPackageWeight"::text,
            po."observedPackageUnit", po.availability, po.confidence::text, po."dataClass",
            po."sourceUrl", po."evidenceSha256", po."acquiredAt"::text, po."acquisitionTimeQuality"
       FROM "PriceSnapshot" ps
       JOIN "PriceObservation" po ON po.id = ps."evidenceObservationId"
       JOIN "RetailProduct" rp ON rp.id = po."retailProductId"
       LEFT JOIN "RetailStore" rs ON rs.id = ps."storeId"
       LEFT JOIN "Region" reg ON reg.id = ps."regionId"
       LEFT JOIN "Retailer" r ON r.id = ps."retailerId"
      WHERE ps."productId" = $1
        AND upper(trim(po.currency)) = 'RUB'
        AND COALESCE(po."dataClass", 'PRODUCTION') = 'PRODUCTION'
        AND rp.status = 'ACTIVE' AND rp."mappingStatus" = 'MAPPED'
        AND rp."canonicalProductId" = ps."productId"
        AND ($2::uuid IS NULL OR ps."storeId" = $2)
        AND ($2::uuid IS NOT NULL OR rs."locationScope" = 'REGION')
        AND ($3::uuid IS NULL OR ps."regionId" = $3)
        AND ($4::text IS NULL OR reg.code = $4)
        AND ($5::uuid IS NULL OR ps."retailerId" = $5)
        AND ($7::text IS NULL OR rs."locationScope" = $7)
        AND (po."validFrom" IS NULL OR po."validFrom" <= $6::timestamptz)
        AND (po."validTo" IS NULL OR po."validTo" >= $6::timestamptz)
      ORDER BY CASE rs."locationScope" WHEN 'STORE' THEN 4 WHEN 'DELIVERY_ADDRESS' THEN 3 WHEN 'CITY' THEN 2 WHEN 'REGION' THEN 1 ELSE 0 END DESC,
               ps."observedAt" DESC, ps.id ASC
      LIMIT 1`,
    [productId, options.storeId ?? null, options.regionId ?? null, options.regionCode ?? null, options.retailerId ?? null, effectiveNow, options.locationScope ?? null],
  );
  const row = result.rows[0];
  if (row) {
    return {
      status: freshnessStatus({ observedAt: row.observedAt, dataClass: row.dataClass, now: options.now, condition: row.priceCondition }),
      price: Number(row.price), currency: row.currency, normalizedUnitPrice: row.unitPrice == null ? null : Number(row.unitPrice),
      normalizedUnit: row.unitPriceUnit, priceCondition: row.priceCondition, observedAt: row.observedAt,
      freshUntil: row.freshUntil, productId: row.productId, retailerId: row.retailerId,
      storeId: row.storeId, locationScope: row.locationScope, sourceType: row.sourceType,
      sourceName: row.sourceName, observationId: row.evidenceObservationId,
      retailProductId: row.retailProductId, retailerName: row.retailerName,
      retailerCode: row.retailerCode, packageQuantity: row.observedPackageWeight == null ? null : Number(row.observedPackageWeight),
      packageUnit: row.observedPackageUnit, availability: row.availability,
      confidence: row.confidence == null ? null : Number(row.confidence), dataClass: row.dataClass,
      sourceUrl: row.sourceUrl, evidenceSha256: row.evidenceSha256, acquiredAt: row.acquiredAt,
      acquisitionTimeQuality: row.acquisitionTimeQuality,
    };
  }

  // Snapshot is a projection/cache. Canonical source evidence remains readable when
  // a legacy writer has not materialized the projection yet, with the same guards.
  const eligible = await query<ReferenceRow>(
    `SELECT po."productId", po.price::text, po.currency,
            to_char(po."observedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "observedAt",
            NULL::text AS "freshUntil", po."normalizedPackageQuantity"::text,
            po."normalizedPackageUnit", po."unitPrice"::text, po."unitPriceUnit",
            po."priceCondition", po."retailerId", r.name AS "retailerName", r.code AS "retailerCode",
            po."storeId", rs."locationScope", po."sourceType", po."sourceName",
            po.id AS "evidenceObservationId", po."retailProductId", po."observedPackageWeight"::text,
            po."observedPackageUnit", po.availability, po.confidence::text, po."dataClass",
            po."sourceUrl", po."evidenceSha256", po."acquiredAt"::text, po."acquisitionTimeQuality"
       FROM "PriceObservation" po
       JOIN "RetailProduct" rp ON rp.id = po."retailProductId"
       JOIN "RetailStore" rs ON rs.id = po."storeId"
       JOIN "Region" reg ON reg.id = rs."regionId"
       LEFT JOIN "Retailer" r ON r.id = po."retailerId"
      WHERE po."productId" = $1
        AND po."priceCondition" IN ('REGULAR','PROMOTIONAL')
        AND upper(trim(po.currency)) = 'RUB'
        AND COALESCE(po."dataClass", 'PRODUCTION') = 'PRODUCTION'
        AND rp.status = 'ACTIVE' AND rp."mappingStatus" = 'MAPPED'
        AND rp."canonicalProductId" = po."productId"
        AND ($2::uuid IS NULL OR po."storeId" = $2)
        AND ($2::uuid IS NOT NULL OR rs."locationScope" = 'REGION')
        AND ($3::uuid IS NULL OR rs."regionId" = $3)
        AND ($4::text IS NULL OR reg.code = $4)
        AND ($5::uuid IS NULL OR po."retailerId" = $5)
        AND ($7::text IS NULL OR rs."locationScope" = $7)
        AND (po."validFrom" IS NULL OR po."validFrom" <= $6::timestamptz)
        AND (po."validTo" IS NULL OR po."validTo" >= $6::timestamptz)
      ORDER BY po."observedAt" DESC, po.id ASC LIMIT 1`,
    [productId, options.storeId ?? null, options.regionId ?? null, options.regionCode ?? null, options.retailerId ?? null, effectiveNow, options.locationScope ?? null],
  );
  const eligibleRow = eligible.rows[0];
  if (eligibleRow) {
    return {
      status: freshnessStatus({ observedAt: eligibleRow.observedAt, dataClass: eligibleRow.dataClass, now: options.now, condition: eligibleRow.priceCondition }),
      price: Number(eligibleRow.price), currency: eligibleRow.currency,
      normalizedUnitPrice: eligibleRow.unitPrice == null ? null : Number(eligibleRow.unitPrice),
      normalizedUnit: eligibleRow.unitPriceUnit, priceCondition: eligibleRow.priceCondition,
      observedAt: eligibleRow.observedAt, freshUntil: null, productId,
      retailerId: eligibleRow.retailerId, retailerName: eligibleRow.retailerName,
      retailerCode: eligibleRow.retailerCode, storeId: eligibleRow.storeId,
      locationScope: eligibleRow.locationScope, sourceType: eligibleRow.sourceType,
      sourceName: eligibleRow.sourceName, observationId: eligibleRow.evidenceObservationId,
      retailProductId: eligibleRow.retailProductId,
      packageQuantity: eligibleRow.observedPackageWeight == null ? null : Number(eligibleRow.observedPackageWeight),
      packageUnit: eligibleRow.observedPackageUnit, availability: eligibleRow.availability,
      confidence: eligibleRow.confidence == null ? null : Number(eligibleRow.confidence),
      dataClass: eligibleRow.dataClass,
      sourceUrl: eligibleRow.sourceUrl, evidenceSha256: eligibleRow.evidenceSha256, acquiredAt: eligibleRow.acquiredAt,
      acquisitionTimeQuality: eligibleRow.acquisitionTimeQuality,
    };
  }

  const conditional = await query<ReferenceRow>(
    `SELECT po."productId", po.price::text, po.currency,
            to_char(po."observedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "observedAt",
            NULL::text AS "freshUntil", po."normalizedPackageQuantity"::text,
            po."normalizedPackageUnit", po."unitPrice"::text, po."unitPriceUnit",
            po."priceCondition", po."retailerId", r.name AS "retailerName", r.code AS "retailerCode",
            po."storeId", rs."locationScope", po."sourceType", po."sourceName",
            po.id AS "evidenceObservationId", po."retailProductId", po."observedPackageWeight"::text,
            po."observedPackageUnit", po.availability, po.confidence::text, po."dataClass",
            po."sourceUrl", po."evidenceSha256", po."acquiredAt"::text, po."acquisitionTimeQuality"
       FROM "PriceObservation" po
       JOIN "RetailProduct" rp ON rp.id = po."retailProductId"
       JOIN "RetailStore" rs ON rs.id = po."storeId"
       JOIN "Region" reg ON reg.id = rs."regionId"
       LEFT JOIN "Retailer" r ON r.id = po."retailerId"
      WHERE po."productId" = $1
        AND po."priceCondition" IN ('LOYALTY_ONLY','CONDITIONAL','UNKNOWN_CONDITION')
        AND upper(trim(po.currency)) = 'RUB'
        AND COALESCE(po."dataClass", 'PRODUCTION') = 'PRODUCTION'
        AND rp.status = 'ACTIVE' AND rp."mappingStatus" = 'MAPPED'
        AND rp."canonicalProductId" = po."productId"
        AND ($2::uuid IS NULL OR po."storeId" = $2)
        AND ($2::uuid IS NOT NULL OR rs."locationScope" = 'REGION')
        AND ($3::uuid IS NULL OR rs."regionId" = $3)
        AND ($4::text IS NULL OR reg.code = $4)
        AND ($5::uuid IS NULL OR po."retailerId" = $5)
        AND ($7::text IS NULL OR rs."locationScope" = $7)
        AND (po."validFrom" IS NULL OR po."validFrom" <= $6::timestamptz)
        AND (po."validTo" IS NULL OR po."validTo" >= $6::timestamptz)
      ORDER BY po."observedAt" DESC, po.id ASC LIMIT 1`,
    [productId, options.storeId ?? null, options.regionId ?? null, options.regionCode ?? null, options.retailerId ?? null, effectiveNow, options.locationScope ?? null],
  );
  const conditionalRow = conditional.rows[0];
  if (!conditionalRow) return unknown(productId);
  return {
    status: 'APPROXIMATE', price: Number(conditionalRow.price), currency: conditionalRow.currency,
    normalizedUnitPrice: conditionalRow.unitPrice == null ? null : Number(conditionalRow.unitPrice),
    normalizedUnit: conditionalRow.unitPriceUnit, priceCondition: conditionalRow.priceCondition,
    observedAt: conditionalRow.observedAt, freshUntil: null, productId,
    retailerId: conditionalRow.retailerId, storeId: conditionalRow.storeId,
    locationScope: conditionalRow.locationScope, sourceType: conditionalRow.sourceType,
    sourceName: conditionalRow.sourceName, observationId: conditionalRow.evidenceObservationId,
    retailProductId: conditionalRow.retailProductId, retailerName: conditionalRow.retailerName,
    retailerCode: conditionalRow.retailerCode,
    packageQuantity: conditionalRow.observedPackageWeight == null ? null : Number(conditionalRow.observedPackageWeight),
    packageUnit: conditionalRow.observedPackageUnit, availability: conditionalRow.availability,
    confidence: conditionalRow.confidence == null ? null : Number(conditionalRow.confidence),
    dataClass: conditionalRow.dataClass,
    sourceUrl: conditionalRow.sourceUrl, evidenceSha256: conditionalRow.evidenceSha256, acquiredAt: conditionalRow.acquiredAt,
    acquisitionTimeQuality: conditionalRow.acquisitionTimeQuality,
  };
}
