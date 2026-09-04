import type { LogicalRef, RowSpec } from "../domain/types";

export function scopedRow(
  scope: string,
  operatorIds: readonly (string | null)[],
  gapBefore = false,
): RowSpec {
  const slots = operatorIds.map((operatorId) =>
    operatorId === null ? null : `${scope}/${operatorId}`,
  );
  return gapBefore ? { gapBefore: true, slots } : { slots };
}

export function serialRows(
  scope: string,
  operatorIds: readonly string[],
  gapBefore = false,
): RowSpec[] {
  return operatorIds.map((operatorId, index) =>
    scopedRow(scope, [operatorId], gapBefore && index === 0),
  );
}

export function transformerAttentionRows(
  scope: string,
  options: {
    includeNorm?: boolean;
    entry?: readonly string[];
    rope?: boolean;
    cacheOutput?: boolean;
    prefixKvViews?: boolean;
  } = {},
): RowSpec[] {
  const includeNorm = options.includeNorm ?? true;
  const entry = options.entry ?? ["attention-norm"];
  const rows: RowSpec[] = [];
  if (includeNorm) rows.push(scopedRow(scope, entry, true));
  rows.push(scopedRow(scope, ["query-projection", "key-projection", "value-projection"]));
  if (options.rope) rows.push(scopedRow(scope, ["query-rope", "key-rope", null]));
  if (options.prefixKvViews) rows.push(scopedRow(scope, ["key-concat", "value-concat"]));
  rows.push(
    options.cacheOutput
      ? scopedRow(scope, [null, "attention", "cache-output"])
      : scopedRow(scope, ["attention"]),
    scopedRow(scope, ["output-projection"]),
    scopedRow(scope, ["attention-residual"]),
  );
  return rows;
}

export function vitGeluMlpRows(scope: string): RowSpec[] {
  return serialRows(
    scope,
    ["mlp-norm", "mlp-up-projection", "mlp-gelu", "mlp-down-projection", "mlp-residual"],
    true,
  );
}

export function gatedMlpRows(scope: string, activation = "gate-gelu"): RowSpec[] {
  return [
    scopedRow(scope, ["mlp-norm"], true),
    scopedRow(scope, ["gate-projection", "up-projection"]),
    scopedRow(scope, [activation, null]),
    scopedRow(scope, ["gate-product"]),
    scopedRow(scope, ["down-projection"]),
    scopedRow(scope, ["mlp-residual"]),
  ];
}

export function actionHeadRows(scope: string): RowSpec[] {
  return serialRows(
    scope,
    ["final-norm", "select-action-rows", "velocity-projection", "euler-update"],
    true,
  );
}

export function centeredMergeRow(sourceRefs: readonly LogicalRef[], targetRef: LogicalRef): RowSpec {
  return { slots: [targetRef], centerBetween: sourceRefs };
}

export function alignedRow(sourceRef: LogicalRef, targetRef: LogicalRef): RowSpec {
  return { slots: [targetRef], alignTo: sourceRef };
}

export function offsetRows(rows: readonly RowSpec[], offsetY: number): RowSpec[] {
  return rows.map((row) => ({ ...row, offsetY }));
}
