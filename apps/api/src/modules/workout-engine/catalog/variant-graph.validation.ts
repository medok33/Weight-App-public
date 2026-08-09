import { VARIANT_RELATION_TYPES, type VariantRelationType } from "./catalog-enums";

export type VariantEdge = {
  fromExerciseId: string;
  toExerciseId: string;
  relationType: string;
  levelDelta: number;
  active: boolean;
  equipmentContext?: string;
  placeContext?: string;
};

export type VariantGraphIssue = { code: string; message: string };

export function validateVariantGraph(edges: readonly VariantEdge[]): VariantGraphIssue[] {
  const issues: VariantGraphIssue[] = [];
  const seen = new Set<string>();

  for (const edge of edges) {
    if (edge.fromExerciseId === edge.toExerciseId) {
      issues.push({
        code: "SELF_EDGE",
        message: `Self-relation forbidden for ${edge.fromExerciseId}`,
      });
    }
    if (!(VARIANT_RELATION_TYPES as readonly string[]).includes(edge.relationType)) {
      issues.push({
        code: "RELATION_TYPE",
        message: `Invalid relationType ${edge.relationType}`,
      });
    }
    const key = [
      edge.fromExerciseId,
      edge.toExerciseId,
      edge.relationType,
      edge.equipmentContext ?? "",
      edge.placeContext ?? "",
    ].join("|");
    if (seen.has(key)) {
      issues.push({ code: "DUP_EDGE", message: `Duplicate edge ${key}` });
    }
    seen.add(key);

    if (edge.relationType === "EASIER" && edge.levelDelta > 0) {
      issues.push({
        code: "LEVEL_DELTA",
        message: `EASIER edge should not have positive levelDelta (${edge.fromExerciseId})`,
      });
    }
    if (edge.relationType === "HARDER" && edge.levelDelta < 0) {
      issues.push({
        code: "LEVEL_DELTA",
        message: `HARDER edge should not have negative levelDelta (${edge.fromExerciseId})`,
      });
    }
  }

  // Detect EASIER↔HARDER contradiction on the same unordered pair with conflicting semantics.
  for (const a of edges) {
    if (!a.active || a.relationType !== "EASIER") continue;
    const harderBack = edges.find(
      (b) =>
        b.active &&
        b.relationType === "EASIER" &&
        b.fromExerciseId === a.toExerciseId &&
        b.toExerciseId === a.fromExerciseId,
    );
    if (harderBack) {
      issues.push({
        code: "EASIER_CONTRADICTION",
        message: `Mutual EASIER contradiction between ${a.fromExerciseId} and ${a.toExerciseId}`,
      });
    }
  }

  return issues;
}

export function assertVariantGraphValid(edges: readonly VariantEdge[]): void {
  const issues = validateVariantGraph(edges);
  if (issues.length) {
    throw new Error(
      `VARIANT_GRAPH_INVALID: ${issues.map((i) => `${i.code}:${i.message}`).join("; ")}`,
    );
  }
}

export function isVariantRelationType(value: string): value is VariantRelationType {
  return (VARIANT_RELATION_TYPES as readonly string[]).includes(value);
}
