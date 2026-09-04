export interface LowerBoundNode {
  id: string;
  roofSecond: number;
  computeSecond: number;
  memorySecond: number;
}

export interface DependencyEdge {
  source: string;
  target: string;
}

export interface StageLowerBound {
  dependencySecond: number;
  resourceComputeSecond: number;
  resourceMemorySecond: number;
  roofSecond: number;
  limiter: "compute" | "memory" | "dependency" | "tie";
  criticalPath: readonly string[];
}

const EPSILON = 1e-9;

function same(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPSILON * Math.max(a, b, Number.MIN_VALUE);
}

export function stageLowerBound(
  nodes: readonly LowerBoundNode[],
  edges: readonly DependencyEdge[],
): StageLowerBound {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (byId.size !== nodes.length) throw new Error("lower-bound node IDs must be unique");
  nodes.forEach((node) => {
    if (!node.id || [node.roofSecond, node.computeSecond, node.memorySecond]
      .some((value) => !Number.isFinite(value) || value < 0)) {
      throw new Error("lower-bound nodes require an ID and finite nonnegative times");
    }
  });
  const predecessors = new Map(nodes.map((node) => [node.id, [] as string[]]));
  const successors = new Map(nodes.map((node) => [node.id, [] as string[]]));
  edges.forEach((edge) => {
    if (!byId.has(edge.source) || !byId.has(edge.target)) throw new Error("dependency edge does not resolve");
    predecessors.get(edge.target)!.push(edge.source);
    successors.get(edge.source)!.push(edge.target);
  });
  const indegree = new Map([...predecessors].map(([id, values]) => [id, values.length]));
  const ready = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id).sort();
  const order: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const target of successors.get(id)!.slice().sort()) {
      const next = indegree.get(target)! - 1;
      indegree.set(target, next);
      if (next === 0) {
        ready.push(target);
        ready.sort();
      }
    }
  }
  if (order.length !== nodes.length) throw new Error("dependency graph must be acyclic");

  const finish = new Map<string, number>();
  const paths = new Map<string, string[]>();
  for (const id of order) {
    const choices = predecessors.get(id)!
      .map((source) => ({ source, finish: finish.get(source)!, path: paths.get(source)! }))
      .sort((a, b) => b.finish - a.finish || a.source.localeCompare(b.source));
    const winner = choices[0];
    finish.set(id, (winner?.finish ?? 0) + byId.get(id)!.roofSecond);
    paths.set(id, [...(winner?.path ?? []), id]);
  }
  const sinks = nodes.filter((node) => successors.get(node.id)!.length === 0)
    .sort((a, b) => finish.get(b.id)! - finish.get(a.id)! || a.id.localeCompare(b.id));
  const sink = sinks[0];
  const dependencySecond = sink ? finish.get(sink.id)! : 0;
  const resourceComputeSecond = nodes.reduce((sum, node) => sum + node.computeSecond, 0);
  const resourceMemorySecond = nodes.reduce((sum, node) => sum + node.memorySecond, 0);
  const roofSecond = Math.max(dependencySecond, resourceComputeSecond, resourceMemorySecond);
  const winners = [
    ["dependency", dependencySecond],
    ["compute", resourceComputeSecond],
    ["memory", resourceMemorySecond],
  ] as const;
  const tied = winners.filter(([, value]) => same(value, roofSecond));
  return {
    dependencySecond,
    resourceComputeSecond,
    resourceMemorySecond,
    roofSecond,
    limiter: tied.length > 1 ? "tie" : tied[0]![0],
    criticalPath: sink ? paths.get(sink.id)! : [],
  };
}
