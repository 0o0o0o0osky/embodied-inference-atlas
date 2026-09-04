import type {
  Endpoint,
  LogicalDag,
  LogicalEdge,
  LogicalNode,
  LogicalRef,
  LogicalScope,
  MaterializedGraph,
  MaterializedGraphTensor,
  MaterializedModule,
  MaterializedTemplate,
  MaterializedTemplateTensor,
  NodeVisualKind,
} from "./types";

function genericVisual(definitionId: string): NodeVisualKind {
  if (definitionId === "residual-add" || definitionId === "elementwise-multiply") {
    return "inline";
  }
  if (
    definitionId === "concat" ||
    definitionId === "reshape" ||
    definitionId === "permute-rearrange"
  ) return "line-op";
  return "box";
}

function findTensor(
  template: MaterializedTemplate,
  tensorId: string,
): MaterializedTemplateTensor | null {
  return template.tensors.find((tensor) => tensor.tensorId === tensorId) ?? null;
}

function resolveProducer(
  template: MaterializedTemplate,
  endpoint: Endpoint | null,
  prefix: string,
): LogicalRef[] {
  if (!endpoint) return [];
  if (endpoint.nodeKind === "operator") return [`${prefix}/${endpoint.nodeId}`];
  if (endpoint.nodeKind !== "component") return [];
  const component = template.components.find((item) => item.componentId === endpoint.nodeId);
  const port = component?.template.outputPorts.find((item) => item.port === endpoint.port);
  return component && port
    ? resolveTensorProducers(
        component.template,
        port.tensorId,
        `${prefix}/${component.componentId}`,
      )
    : [];
}

function resolveConsumer(
  template: MaterializedTemplate,
  endpoint: Endpoint,
  prefix: string,
): LogicalRef[] {
  if (endpoint.nodeKind === "operator") return [`${prefix}/${endpoint.nodeId}`];
  if (endpoint.nodeKind !== "component") return [];
  const component = template.components.find((item) => item.componentId === endpoint.nodeId);
  const port = component?.template.inputPorts.find((item) => item.port === endpoint.port);
  return component && port
    ? resolveTensorConsumers(
        component.template,
        port.tensorId,
        `${prefix}/${component.componentId}`,
      )
    : [];
}

function resolveTensorProducers(
  template: MaterializedTemplate,
  tensorId: string,
  prefix: string,
): LogicalRef[] {
  const tensor = findTensor(template, tensorId);
  return tensor ? resolveProducer(template, tensor.producer, prefix) : [];
}

function resolveTensorConsumers(
  template: MaterializedTemplate,
  tensorId: string,
  prefix: string,
): LogicalRef[] {
  const tensor = findTensor(template, tensorId);
  return tensor
    ? tensor.consumers.flatMap((consumer) => resolveConsumer(template, consumer, prefix))
    : [];
}

export function adaptLogicalDag(graph: MaterializedGraph): LogicalDag {
  const nodes = new Map<LogicalRef, LogicalNode>();
  const edges: LogicalEdge[] = [];
  const edgeKeys = new Set<string>();
  const scopes: LogicalScope[] = [];
  const diagnostics = [...graph.diagnostics];

  const addNode = (node: LogicalNode) => {
    if (!nodes.has(node.ref)) nodes.set(node.ref, node);
  };

  const addEdge = (
    source: string,
    target: string,
    tensor: MaterializedTemplateTensor | MaterializedGraphTensor | null,
    kind: LogicalEdge["kind"] = "tensor",
    label = "next layer hidden",
  ) => {
    if (!source || !target || source === target) return;
    const tensorId = tensor?.tensorId ?? label;
    const key = `${source}|${target}|${tensorId}|${kind}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({
      id: `edge-${edges.length + 1}`,
      tensorId,
      tensorLabel: tensor?.label ?? label,
      source,
      target,
      kind,
    });
  };

  const moduleContexts = new Map<
    string,
    { stageId: string; module: MaterializedModule }
  >();

  graph.stages.forEach((stage) => {
    stage.modules.forEach((module) => {
      moduleContexts.set(module.moduleId, { stageId: stage.stageId, module });
      const prefix = `${stage.stageId}/${module.moduleId}`;
      const moduleRefs: LogicalRef[] = [];
      if (module.template.operators.length) {
        module.template.operators.forEach((detail) => {
          addNode({
            ref: detail.ref,
            kind: "operator",
            stageId: stage.stageId,
            moduleId: module.moduleId,
            componentId: null,
            operatorId: detail.operatorId,
            definitionId: detail.definitionId,
            label: detail.label,
            visual: genericVisual(detail.definitionId),
            detail,
          });
          moduleRefs.push(detail.ref);
        });
      } else {
        module.template.components.forEach((component) => {
          const componentRefs: LogicalRef[] = [];
          component.template.operators.forEach((detail) => {
            addNode({
              ref: detail.ref,
              kind: "operator",
              stageId: stage.stageId,
              moduleId: module.moduleId,
              componentId: component.componentId,
              operatorId: detail.operatorId,
              definitionId: detail.definitionId,
              label: detail.label,
              visual: genericVisual(detail.definitionId),
              detail,
            });
            componentRefs.push(detail.ref);
            moduleRefs.push(detail.ref);
          });
          scopes.push({
            id: `${prefix}/${component.componentId}`,
            kind: "component",
            label: component.label,
            stageId: stage.stageId,
            moduleId: module.moduleId,
            nodeRefs: componentRefs,
            repeat: module.moduleRepeat ?? 1,
          });
        });
      }

      if ((module.moduleRepeat ?? 1) > 1) {
        const fullLabel = module.requiredOutputTail
          ? `${module.label} ×${module.moduleRepeat ?? "?"} full`
          : `${module.label} ×${module.moduleRepeat ?? "?"}`;
        const baseScope: LogicalScope = {
          id: prefix,
          kind: "transformer",
          label: fullLabel,
          stageId: stage.stageId,
          moduleId: module.moduleId,
          nodeRefs: moduleRefs,
          repeat: module.moduleRepeat ?? 1,
        };
        scopes.push(
          module.requiredOutputTail
            ? {
                ...baseScope,
                note: `${module.requiredOutputTail.label}: ${module.requiredOutputTail.description}`,
              }
            : baseScope,
        );
      } else if (moduleRefs.length > 1) {
        scopes.push({
          id: prefix,
          kind: "module",
          label: module.label,
          stageId: stage.stageId,
          moduleId: module.moduleId,
          nodeRefs: moduleRefs,
          repeat: 1,
        });
      }

      const addTemplateEdges = (template: MaterializedTemplate, localPrefix: string) => {
        template.tensors.forEach((tensor) => {
          const sources = resolveProducer(template, tensor.producer, localPrefix);
          const consumers = tensor.consumers.flatMap((consumer) =>
            resolveConsumer(template, consumer, localPrefix),
          );
          sources.forEach((source) =>
            consumers.forEach((target) => addEdge(source, target, tensor)),
          );
        });
        template.components.forEach((component) =>
          addTemplateEdges(component.template, `${localPrefix}/${component.componentId}`),
        );
      };
      addTemplateEdges(module.template, prefix);
    });
  });

  const moduleProducer = (endpoint: Endpoint): LogicalRef[] => {
    const context = moduleContexts.get(endpoint.nodeId);
    const port = context?.module.template.outputPorts.find(
      (item) => item.port === endpoint.port,
    );
    return context && port
      ? resolveTensorProducers(
          context.module.template,
          port.tensorId,
          `${context.stageId}/${context.module.moduleId}`,
        )
      : [];
  };

  const moduleConsumers = (endpoint: Endpoint): LogicalRef[] => {
    const context = moduleContexts.get(endpoint.nodeId);
    const port = context?.module.template.inputPorts.find(
      (item) => item.port === endpoint.port,
    );
    return context && port
      ? resolveTensorConsumers(
          context.module.template,
          port.tensorId,
          `${context.stageId}/${context.module.moduleId}`,
        )
      : [];
  };

  const ensureLoopNode = (endpoint: Endpoint): LogicalRef[] => {
    const stage = graph.stages.find((item) => item.loop?.loopId === endpoint.nodeId);
    const control = stage?.loop?.controls.find((item) => item.port === endpoint.port);
    const ref = control
      ? `control/${endpoint.nodeId}/${endpoint.port}`
      : `loop/${endpoint.nodeId}`;
    addNode({
      ref,
      kind: control ? "control" : "loop",
      stageId: stage?.stageId ?? graph.stages.at(-1)?.stageId ?? "unknown",
      moduleId: null,
      componentId: null,
      operatorId: null,
      definitionId: control ? "loop-control" : "loop-state",
      label: control ? control.formula : "Loop-carried action state",
      visual: control ? "control" : "box",
      detail: null,
    });
    return [ref];
  };

  const graphProducers = (endpoint: Endpoint | null): LogicalRef[] => {
    if (!endpoint) return [];
    if (endpoint.nodeKind === "module") return moduleProducer(endpoint);
    if (endpoint.nodeKind === "loop") return ensureLoopNode(endpoint);
    return [];
  };
  const graphConsumers = (endpoint: Endpoint): LogicalRef[] => {
    if (endpoint.nodeKind === "module") return moduleConsumers(endpoint);
    if (endpoint.nodeKind === "loop") return ensureLoopNode(endpoint);
    return [];
  };

  graph.graphTensors.forEach((tensor) => {
    let sources = graphProducers(tensor.producer);
    let consumers = tensor.consumers.flatMap(graphConsumers);
    if (!sources.length) {
      const firstConsumer = consumers.map((ref) => nodes.get(ref)).find(Boolean);
      const ref = `input/${tensor.tensorId}`;
      addNode({
        ref,
        kind: "input",
        stageId: firstConsumer?.stageId ?? graph.stages[0]?.stageId ?? "unknown",
        moduleId: null,
        componentId: null,
        operatorId: null,
        definitionId: "model-input",
        label: tensor.label,
        visual: "box",
        detail: null,
      });
      sources = [ref];
    }
    if (!consumers.length) {
      const firstSource = sources.map((ref) => nodes.get(ref)).find(Boolean);
      const ref = `output/${tensor.tensorId}`;
      addNode({
        ref,
        kind: "output",
        stageId: firstSource?.stageId ?? graph.stages.at(-1)?.stageId ?? "unknown",
        moduleId: null,
        componentId: null,
        operatorId: null,
        definitionId: "model-output",
        label: tensor.label,
        visual: "box",
        detail: null,
      });
      consumers = [ref];
    }
    const feedback = tensor.consumers.some(
      (consumer) => consumer.nodeKind === "loop" && consumer.port === "iteration_output",
    );
    sources.forEach((source) =>
      consumers.forEach((target) =>
        addEdge(source, target, tensor, feedback ? "feedback" : "tensor"),
      ),
    );
  });

  graph.stages.forEach((stage) => {
    stage.modules.forEach((module) => {
      if (!module.repeatCarried || (module.moduleRepeat ?? 0) <= 1) return;
      const prefix = `${stage.stageId}/${module.moduleId}`;
      const input = module.template.inputPorts.find(
        (port) => port.port === module.repeatCarried?.inputPort,
      );
      const output = module.template.outputPorts.find(
        (port) => port.port === module.repeatCarried?.outputPort,
      );
      if (!input || !output) return;
      const sources = resolveTensorProducers(module.template, output.tensorId, prefix);
      const consumers = resolveTensorConsumers(module.template, input.tensorId, prefix);
      const tensor = findTensor(module.template, output.tensorId);
      sources.forEach((source) =>
        consumers.forEach((target) => addEdge(source, target, tensor, "repeat")),
      );
    });
    if (stage.loop && (stage.stageRepeat ?? 0) > 1) {
      scopes.push({
        id: `${stage.stageId}/${stage.loop.loopId}`,
        kind: "denoise",
        label: `Denoise ×${stage.stageRepeat ?? "?"}`,
        stageId: stage.stageId,
        moduleId: null,
        nodeRefs: [...nodes.values()]
          .filter((node) => node.stageId === stage.stageId)
          .map((node) => node.ref),
        repeat: stage.stageRepeat ?? 1,
      });
    }
  });

  return {
    nodes,
    edges,
    scopes,
    stages: graph.stages.map((stage) => ({
      id: stage.stageId,
      label: stage.label,
      description: stage.description,
    })),
    stageOrder: graph.stages.map((stage) => stage.stageId),
    diagnostics: [...new Set(diagnostics)],
  };
}

export function incidentNodeRefs(
  dag: LogicalDag,
  selectedRef: LogicalRef | null,
): ReadonlySet<LogicalRef> {
  if (!selectedRef) return new Set();
  const incident = new Set<LogicalRef>();
  dag.edges.forEach((edge) => {
    if (edge.source === selectedRef) incident.add(edge.target);
    if (edge.target === selectedRef) incident.add(edge.source);
  });
  return incident;
}
