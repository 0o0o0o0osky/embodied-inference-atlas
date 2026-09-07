import type { LogicalDag, RoutedPath } from "./types";

type EdgeSemantics = "data" | "control-iteration";

/** Route names describe geometry. Only declared dependencies determine line style. */
export function routedEdgeSemantics(dag: LogicalDag) {
  const pairs = new Map<string, EdgeSemantics>();
  for (const edge of dag.edges) {
    const key = `${edge.source}\0${edge.target}`;
    const semantics = edge.kind === "tensor" ? "data" : "control-iteration";
    // A shared route carrying any ordinary tensor stays a data route.
    if (pairs.get(key) !== "data") pairs.set(key, semantics);
  }
  return (path: Pick<RoutedPath, "sourceRefs" | "targetRefs">): EdgeSemantics => {
    const matched: EdgeSemantics[] = [];
    for (const source of path.sourceRefs) for (const target of path.targetRefs) {
      const semantics = pairs.get(`${source}\0${target}`);
      if (semantics) matched.push(semantics);
    }
    return matched.length && matched.every(value => value === "control-iteration")
      ? "control-iteration" : "data";
  };
}
