import type {
  ConnectorHint,
  LogicalDag,
  LogicalEdge,
  LogicalRef,
} from "../domain/types";

type Pair = readonly [LogicalRef, LogicalRef];

function groupBy(
  edges: readonly LogicalEdge[],
  keyFor: (edge: LogicalEdge) => string,
): Map<string, LogicalEdge[]> {
  const groups = new Map<string, LogicalEdge[]>();
  edges.forEach((edge) => groups.set(keyFor(edge), [...(groups.get(keyFor(edge)) ?? []), edge]));
  return groups;
}

/**
 * Produce a conservative presentation route for every declared non-repeat edge.
 * The canonical DAG remains the source of truth; these hints only choose how its
 * edges share buses and residual rails on paper.
 */
export function deriveConnectorHints(
  dag: LogicalDag,
  authored: readonly ConnectorHint[] = [],
  stageColumns: readonly (readonly string[])[] = [],
): readonly ConnectorHint[] {
  const uniqueEdges = new Map<string, LogicalEdge>();
  dag.edges
    .filter((edge) => edge.kind !== "repeat")
    .forEach((edge) => uniqueEdges.set(`${edge.source}|${edge.target}`, edge));
  const remaining = new Map(uniqueEdges);
  const hints: ConnectorHint[] = [...authored];
  authored.forEach((hint) => hint.pairs.forEach(([source, target]) => {
    remaining.delete(`${source}|${target}`);
  }));
  let hintIndex = 0;

  const take = (
    kind: ConnectorHint["kind"],
    groups: readonly (readonly LogicalEdge[])[],
  ) => {
    groups.forEach((group) => {
      const pairs = group
        .filter((edge) => remaining.delete(`${edge.source}|${edge.target}`))
        .map((edge): Pair => [edge.source, edge.target]);
      if (pairs.length) hints.push({ id: `derived-${kind}-${++hintIndex}`, kind, pairs });
    });
  };

  take("feedback", [[...remaining.values()].filter((edge) => edge.kind === "feedback")]);

  const columnFor = (ref: LogicalRef) => {
    const stage = dag.nodes.get(ref)?.stageId;
    return stageColumns.find(ids => stage !== undefined && ids.includes(stage))?.[0] ?? stage;
  };
  const crossStage = [...remaining.values()].filter(
    (edge) => columnFor(edge.source) !== columnFor(edge.target),
  );
  take("cross", [...groupBy(crossStage, (edge) => edge.source).values()]);

  const residual = [...remaining.values()].filter((edge) => {
    const source = dag.nodes.get(edge.source)?.operatorId;
    const target = dag.nodes.get(edge.target)?.operatorId;
    return (
      ["attention-residual", "mlp-residual", "residual-add"].includes(target ?? "") &&
      !["output-projection", "down-projection", "residual-gate"].includes(source ?? "")
    );
  });
  take("residual", residual.map((edge) => [edge]));

  const byTarget = [...groupBy([...remaining.values()], (edge) => edge.target).values()]
    .filter((group) => group.length > 1);
  take("branch-in", byTarget);

  const bySource = [...groupBy([...remaining.values()], (edge) => edge.source).values()]
    .filter((group) => group.length > 1);
  take("branch-out", bySource);

  take("chain", [[...remaining.values()]]);
  return hints;
}
