import type {
  ConnectorHint,
  ConnectorResolution,
  GraphPresentation,
  LogicalDag,
  LogicalLayout,
  LogicalRef,
  NodeBox,
  RoutedConnector,
  RoutedPath,
} from "../domain/types";

interface Anchor {
  left: number;
  right: number;
  top: number;
  bottom: number;
  x: number;
  y: number;
}

function anchor(box: NodeBox): Anchor {
  return {
    left: box.x,
    right: box.x + box.width,
    top: box.y,
    bottom: box.y + box.height,
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function routeBuilder(connectorId: string) {
  const paths: RoutedPath[] = [];
  const add = (
    path: string,
    arrow: boolean,
    sourceRefs: readonly LogicalRef[],
    targetRefs: readonly LogicalRef[],
    shared = false,
  ) => {
    paths.push({
      id: `${connectorId}-${paths.length + 1}`,
      path,
      arrow,
      sourceRefs,
      targetRefs,
      shared,
    });
  };
  return { paths, add };
}

function stageForNode(layout: LogicalLayout, dag: LogicalDag, ref: LogicalRef) {
  const stageId = dag.nodes.get(ref)?.stageId;
  return layout.stageBoxes.find((stage) => stage.stageId === stageId);
}

function pairPath(
  sourceRef: LogicalRef,
  targetRef: LogicalRef,
  layout: LogicalLayout,
): string | null {
  const sourceBox = layout.nodeBoxes.get(sourceRef);
  const targetBox = layout.nodeBoxes.get(targetRef);
  if (!sourceBox || !targetBox) return null;
  const source = anchor(sourceBox);
  const target = anchor(targetBox);
  if (Math.abs(source.y - target.y) < 3) {
    return source.x < target.x
      ? `M ${source.right} ${source.y} H ${target.left}`
      : `M ${source.left} ${source.y} H ${target.right}`;
  }
  if (target.top >= source.bottom) {
    if (Math.abs(source.x - target.x) < 1) {
      return `M ${source.x} ${source.bottom} V ${target.top}`;
    }
    const bendY = (source.bottom + target.top) / 2;
    return `M ${source.x} ${source.bottom} V ${bendY} H ${target.x} V ${target.top}`;
  }
  const railX = Math.max(source.right, target.right) + 10;
  return `M ${source.right} ${source.y} H ${railX} V ${target.y} H ${target.right}`;
}

function routePairs(
  hint: ConnectorHint,
  layout: LogicalLayout,
  add: ReturnType<typeof routeBuilder>["add"],
) {
  hint.pairs.forEach(([source, target]) => {
    const path = pairPath(source, target, layout);
    if (path) add(path, true, [source], [target]);
  });
}

function routeBranchOut(
  hint: ConnectorHint,
  layout: LogicalLayout,
  add: ReturnType<typeof routeBuilder>["add"],
) {
  const sources = new Map<LogicalRef, LogicalRef[]>();
  hint.pairs.forEach(([source, target]) => {
    const targets = sources.get(source) ?? [];
    targets.push(target);
    sources.set(source, targets);
  });
  sources.forEach((targetRefs, sourceRef) => {
    const sourceBox = layout.nodeBoxes.get(sourceRef);
    const targetBoxes = targetRefs.map((ref) => layout.nodeBoxes.get(ref));
    if (!sourceBox || targetBoxes.some((box) => box === undefined)) return;
    if (targetRefs.length === 1) {
      const path = pairPath(sourceRef, targetRefs[0]!, layout);
      if (path) add(path, true, [sourceRef], targetRefs);
      return;
    }
    const source = anchor(sourceBox);
    const targets = targetBoxes.map((box) => anchor(box!));
    const busY = (source.bottom + Math.min(...targets.map((target) => target.top))) / 2;
    add(
      `M ${source.x} ${source.bottom} V ${busY} M ${Math.min(...targets.map((target) => target.x))} ${busY} H ${Math.max(...targets.map((target) => target.x))}`,
      false,
      [sourceRef],
      targetRefs,
      true,
    );
    targets.forEach((target, index) =>
      add(`M ${target.x} ${busY} V ${target.top}`, true, [sourceRef], [targetRefs[index]!]),
    );
  });
}

function routeBranchIn(
  hint: ConnectorHint,
  layout: LogicalLayout,
  dag: LogicalDag,
  add: ReturnType<typeof routeBuilder>["add"],
) {
  const targets = new Map<LogicalRef, LogicalRef[]>();
  hint.pairs.forEach(([source, target]) => {
    const sources = targets.get(target) ?? [];
    sources.push(source);
    targets.set(target, sources);
  });
  targets.forEach((sourceRefs, targetRef) => {
    const targetBox = layout.nodeBoxes.get(targetRef);
    const sourceBoxes = sourceRefs.map((ref) => layout.nodeBoxes.get(ref));
    if (!targetBox || sourceBoxes.some((box) => box === undefined)) return;
    if (sourceRefs.length === 1) {
      const path = pairPath(sourceRefs[0]!, targetRef, layout);
      if (path) add(path, true, sourceRefs, [targetRef]);
      return;
    }
    const target = anchor(targetBox);
    const sources = sourceBoxes.map((box) => anchor(box!));
    if (hint.route === "right-to-top") {
      const stage = stageForNode(layout, dag, targetRef);
      if (!stage) return;
      const railX = stage.x + stage.width - 13;
      const busY = target.top - 7;
      sources.forEach((source, index) =>
        add(`M ${source.right} ${source.y} H ${railX}`, false, [sourceRefs[index]!], [targetRef]),
      );
      add(
        `M ${railX} ${Math.min(...sources.map((source) => source.y))} V ${busY} H ${target.x} V ${target.top}`,
        true,
        sourceRefs,
        [targetRef],
        true,
      );
      return;
    }
    const busY = (target.top + Math.max(...sources.map((source) => source.bottom))) / 2;
    sources.forEach((source, index) =>
      add(`M ${source.x} ${source.bottom} V ${busY}`, false, [sourceRefs[index]!], [targetRef]),
    );
    add(
      `M ${Math.min(...sources.map((source) => source.x), target.x)} ${busY} H ${Math.max(...sources.map((source) => source.x), target.x)} M ${target.x} ${busY} V ${target.top}`,
      true,
      sourceRefs,
      [targetRef],
      true,
    );
  });
}

function routeResidual(
  hint: ConnectorHint,
  layout: LogicalLayout,
  dag: LogicalDag,
  add: ReturnType<typeof routeBuilder>["add"],
) {
  hint.pairs.forEach(([sourceRef, targetRef]) => {
    const sourceBox = layout.nodeBoxes.get(sourceRef);
    const targetBox = layout.nodeBoxes.get(targetRef);
    const stage = stageForNode(layout, dag, sourceRef);
    if (!sourceBox || !targetBox || !stage) return;
    const source = anchor(sourceBox);
    const target = anchor(targetBox);
    const sourceX = source.x - Math.min(12, sourceBox.width / 4);
    const turnY = source.bottom + 6;
    add(
      `M ${sourceX} ${source.bottom} V ${turnY} H ${stage.x + 13} V ${target.y} H ${target.left}`,
      true,
      [sourceRef],
      [targetRef],
    );
  });
}

function routeCross(
  hint: ConnectorHint,
  layout: LogicalLayout,
  dag: LogicalDag,
  add: ReturnType<typeof routeBuilder>["add"],
) {
  const sourceRefs = unique(hint.pairs.map(([source]) => source));
  if (sourceRefs.length !== 1) {
    routePairs(hint, layout, add);
    return;
  }
  const sourceRef = sourceRefs[0]!;
  const targetRefs = hint.pairs.map(([, target]) => target);
  const sourceBox = layout.nodeBoxes.get(sourceRef);
  const targetBoxes = targetRefs.map((ref) => layout.nodeBoxes.get(ref));
  const sourceStage = stageForNode(layout, dag, sourceRef);
  const targetStage = stageForNode(layout, dag, targetRefs[0]!);
  if (!sourceBox || !sourceStage || !targetStage || targetBoxes.some((box) => box === undefined)) return;
  const source = anchor(sourceBox);
  const targets = targetBoxes.map((box) => anchor(box!));
  const gapX = (sourceStage.x + sourceStage.width + targetStage.x) / 2;
  if (targets.length === 1) {
    add(
      `M ${source.right} ${source.y} H ${gapX} V ${targets[0]!.y} H ${targets[0]!.left}`,
      true,
      [sourceRef],
      targetRefs,
    );
    return;
  }
  const busY = Math.min(...targets.map((target) => target.top)) - 7;
  add(
    `M ${source.right} ${source.y} H ${gapX} V ${busY} H ${Math.max(...targets.map((target) => target.x))}`,
    false,
    [sourceRef],
    targetRefs,
    true,
  );
  targets.forEach((target, index) =>
    add(`M ${target.x} ${busY} V ${target.top}`, true, [sourceRef], [targetRefs[index]!]),
  );
}

function routeRail(
  hint: ConnectorHint,
  layout: LogicalLayout,
  dag: LogicalDag,
  add: ReturnType<typeof routeBuilder>["add"],
) {
  hint.pairs.forEach(([sourceRef, targetRef]) => {
    const sourceBox = layout.nodeBoxes.get(sourceRef);
    const targetBox = layout.nodeBoxes.get(targetRef);
    const stage = stageForNode(layout, dag, sourceRef);
    if (!sourceBox || !targetBox || !stage) return;
    const source = anchor(sourceBox);
    const target = anchor(targetBox);
    const inset = hint.railInset ?? 18;
    const railX = hint.side === "left" ? stage.x + inset : stage.x + stage.width - inset;
    const sourceX = hint.side === "left" ? source.left : source.right;
    const targetX = hint.side === "left" ? target.left : target.right;
    add(
      `M ${sourceX} ${source.y + (hint.sourceOffset ?? 0)} H ${railX} V ${target.y + (hint.targetOffset ?? 0)} H ${targetX}`,
      true,
      [sourceRef],
      [targetRef],
    );
  });
}

function routeFeedback(
  hint: ConnectorHint,
  layout: LogicalLayout,
  dag: LogicalDag,
  add: ReturnType<typeof routeBuilder>["add"],
) {
  hint.pairs.forEach(([sourceRef, targetRef]) => {
    const sourceBox = layout.nodeBoxes.get(sourceRef);
    const targetBox = layout.nodeBoxes.get(targetRef);
    const stage = stageForNode(layout, dag, sourceRef);
    if (!sourceBox || !targetBox || !stage) return;
    const source = anchor(sourceBox);
    const target = anchor(targetBox);
    const railX = stage.x + stage.width + (hint.railOffset ?? 6);
    add(
      `M ${source.right} ${source.y + (hint.sourceOffset ?? 0)} H ${railX} V ${target.y} H ${target.right}`,
      true,
      [sourceRef],
      [targetRef],
    );
  });
}

export function resolveConnectorHints(
  dag: LogicalDag,
  presentation: GraphPresentation,
  layout: LogicalLayout,
): ConnectorResolution {
  const truth = new Set(dag.edges.map((edge) => `${edge.source}|${edge.target}`));
  const invalidHints: ConnectorResolution["invalidHints"] extends readonly (infer T)[] ? T[] : never = [];
  const connectors: RoutedConnector[] = [];

  presentation.connectorHints.forEach((hint) => {
    const missingPairs = hint.pairs.filter(
      ([source, target]) =>
        !dag.nodes.has(source) || !dag.nodes.has(target) || !truth.has(`${source}|${target}`),
    );
    if (missingPairs.length) {
      invalidHints.push({ id: hint.id, missingPairs });
      return;
    }
    const builder = routeBuilder(hint.id);
    if (hint.kind === "branch-out") routeBranchOut(hint, layout, builder.add);
    else if (hint.kind === "branch-in" || hint.kind === "cache") {
      routeBranchIn(hint, layout, dag, builder.add);
    } else if (hint.kind === "residual") routeResidual(hint, layout, dag, builder.add);
    else if (hint.kind === "cross") routeCross(hint, layout, dag, builder.add);
    else if (hint.kind === "rail") routeRail(hint, layout, dag, builder.add);
    else if (hint.kind === "feedback") routeFeedback(hint, layout, dag, builder.add);
    else routePairs(hint, layout, builder.add);
    connectors.push({
      id: hint.id,
      kind: hint.kind,
      sourceRefs: unique(hint.pairs.map(([source]) => source)),
      targetRefs: unique(hint.pairs.map(([, target]) => target)),
      paths: builder.paths,
    });
  });

  return { connectors, invalidHints };
}
