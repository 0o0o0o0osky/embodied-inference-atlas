(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
  const pageData = Atlas.readPageData();
  const graph = pageData.model_graph;
  const definitionsById = Object.fromEntries(
    graph.operator_definitions.map((definition) => [definition.definition_id, definition]),
  );
  const blocksById = Object.fromEntries(
    graph.block_templates.map((template) => [template.template_id, template]),
  );
  const componentsById = Object.fromEntries(
    graph.component_templates.map((template) => [template.template_id, template]),
  );
  const targets = {
    summary: document.getElementById("model-summary"),
    controls: document.getElementById("workload-controls"),
    breadcrumb: document.getElementById("graph-breadcrumb"),
    dag: document.getElementById("block-dag"),
    detail: document.getElementById("operator-detail"),
  };
  const state = {
    overrides: {},
    materialized: null,
    selection: { stage: null, module: null, component: null, operator: null },
    animation: null,
  };

  class ExpressionError extends Error {
    constructor(message, symbol) {
      super(message);
      this.name = "ExpressionError";
      this.symbol = symbol || null;
    }
  }

  function finiteNumber(value, label) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new ExpressionError(`${label} must be a finite number`);
    }
    return value;
  }

  function nonNegativeInteger(value, label) {
    const number = finiteNumber(value, label);
    if (!Number.isSafeInteger(number) || number < 0) {
      throw new ExpressionError(`${label} must be a non-negative integer`);
    }
    return number;
  }

  function evaluateExpression(expression, bindings) {
    if (typeof expression === "number") return finiteNumber(expression, "expression");
    if (!expression || typeof expression !== "object" || Array.isArray(expression)) {
      throw new ExpressionError("expression must be a finite number or expression object");
    }
    const keys = Object.keys(expression).sort();
    if (keys.length === 1 && keys[0] === "symbol") {
      const symbol = expression.symbol;
      if (typeof symbol !== "string" || !symbol) throw new ExpressionError("symbol must be a non-empty string");
      if (!Object.prototype.hasOwnProperty.call(bindings, symbol)) {
        throw new ExpressionError(`unknown symbol: ${symbol}`, symbol);
      }
      const value = bindings[symbol];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new ExpressionError(`binding ${symbol} must be a finite number`, symbol);
      }
      return value;
    }
    if (keys.length !== 2 || keys[0] !== "args" || keys[1] !== "op" || !Array.isArray(expression.args)) {
      throw new ExpressionError("expression object must be a symbol or op/args pair");
    }
    const values = expression.args.map((argument) => evaluateExpression(argument, bindings));
    let result;
    switch (expression.op) {
      case "add":
        if (values.length < 2) throw new ExpressionError("add requires at least two arguments");
        result = values.reduce((total, value) => total + value, 0);
        break;
      case "sub":
        if (values.length !== 2) throw new ExpressionError("sub requires exactly two arguments");
        result = values[0] - values[1];
        break;
      case "mul":
        if (values.length < 2) throw new ExpressionError("mul requires at least two arguments");
        result = values.reduce((total, value) => total * value, 1);
        break;
      case "div":
        if (values.length !== 2) throw new ExpressionError("div requires exactly two arguments");
        if (values[1] === 0) throw new ExpressionError("division by zero");
        result = values[0] / values[1];
        break;
      case "ceil_div":
        if (values.length !== 2) throw new ExpressionError("ceil_div requires exactly two arguments");
        if (values[1] === 0) throw new ExpressionError("division by zero");
        result = Math.ceil(values[0] / values[1]);
        break;
      default:
        throw new ExpressionError("unknown expression operation");
    }
    return finiteNumber(result, "expression result");
  }

  function expressionSymbols(expression) {
    if (typeof expression === "number") return [];
    if (!expression || typeof expression !== "object" || Array.isArray(expression)) return [];
    if (Object.keys(expression).length === 1 && typeof expression.symbol === "string") {
      return [expression.symbol];
    }
    if (!Array.isArray(expression.args)) return [];
    return [...new Set(expression.args.flatMap(expressionSymbols))];
  }

  function recordExpressionError(error, unresolved) {
    if (error instanceof ExpressionError && error.symbol) unresolved.add(error.symbol);
    else unresolved.add(error.message || "invalid expression");
  }

  function safelyEvaluateCount(expression, bindings, unresolved, label) {
    try {
      return nonNegativeInteger(evaluateExpression(expression, bindings), label);
    } catch (error) {
      recordExpressionError(error, unresolved);
      return null;
    }
  }

  function resolveGlobalSymbols(symbols, overrides, unresolved) {
    const entries = Object.fromEntries(symbols.map((item) => [item.symbol, item]));
    const resolved = {};
    const resolving = [];

    function resolve(symbol) {
      if (Object.prototype.hasOwnProperty.call(resolved, symbol)) return resolved[symbol];
      const item = entries[symbol];
      if (!item || resolving.includes(symbol)) {
        unresolved.add(symbol);
        return null;
      }
      resolving.push(symbol);
      let value = null;
      if (item.expression === null) {
        value = Object.prototype.hasOwnProperty.call(overrides, symbol) ? overrides[symbol] : item.default;
        try {
          value = nonNegativeInteger(value, `symbol ${symbol}`);
        } catch (error) {
          value = null;
        }
        if (
          value === null
          || value < item.minimum
          || (item.maximum !== null && value > item.maximum)
          || value > MAX_SAFE_INTEGER
        ) {
          unresolved.add(symbol);
          value = null;
        }
      } else {
        const references = expressionSymbols(item.expression);
        const localBindings = Object.fromEntries(references.map((name) => [name, resolve(name)]));
        value = safelyEvaluateCount(item.expression, localBindings, unresolved, `symbol ${symbol}`);
      }
      resolving.pop();
      resolved[symbol] = value;
      return value;
    }

    symbols.forEach((item) => resolve(item.symbol));
    return resolved;
  }

  function evaluateBindings(bindings, parameters, environment, unresolved) {
    const actual = Object.fromEntries((bindings || []).map((item) => [item.symbol, item]));
    return Object.fromEntries((parameters || []).map((symbol) => {
      if (!actual[symbol]) {
        unresolved.add(symbol);
        return [symbol, null];
      }
      return [
        symbol,
        safelyEvaluateCount(actual[symbol].expression, environment, unresolved, `binding ${symbol}`),
      ];
    }));
  }

  function materializeTensors(tensors, environment, unresolved) {
    return (tensors || []).map((tensor) => {
      const tensorUnresolved = new Set();
      const shape = tensor.axes.map((axis) => safelyEvaluateCount(
        axis.expression,
        environment,
        tensorUnresolved,
        `tensor ${tensor.tensor_id} axis ${axis.axis}`,
      ));
      tensorUnresolved.forEach((symbol) => unresolved.add(symbol));
      return { ...tensor, shape, unresolved_symbols: [...tensorUnresolved] };
    });
  }

  function materializePorts(ports, tensorsById) {
    return (ports || []).map((port) => ({
      ...port,
      tensor: tensorsById[port.tensor_id] || null,
      shape: tensorsById[port.tensor_id] ? tensorsById[port.tensor_id].shape : null,
    }));
  }

  function materializeAtomicTemplate(template, environment, effectiveRepeat, keyPrefix, operatorsById, unresolved) {
    const tensors = materializeTensors(template.tensors, environment, unresolved);
    const tensorsById = Object.fromEntries(tensors.map((tensor) => [tensor.tensor_id, tensor]));
    const operators = template.operators.map((operator) => {
      const operatorUnresolved = new Set();
      const definition = definitionsById[operator.definition_id];
      const multiplicity = safelyEvaluateCount(
        operator.multiplicity,
        environment,
        operatorUnresolved,
        `operator ${operator.operator_id} multiplicity`,
      );
      const bindings = evaluateBindings(
        operator.bindings,
        definition ? definition.parameters : [],
        environment,
        operatorUnresolved,
      );
      const analysis = (definition ? definition.analysis : []).map((metric) => ({
        ...metric,
        value: safelyEvaluateCount(
          metric.expression,
          bindings,
          operatorUnresolved,
          `analysis ${metric.metric}`,
        ),
      }));
      const key = `${keyPrefix}/${operator.operator_id}`;
      const operatorCopy = {
        ...operator,
        bindings,
        multiplicity,
        analysis,
        analysis_by_metric: Object.fromEntries(analysis.map((metric) => [metric.metric, metric.value])),
        effective_repeat: multiplicity === null || effectiveRepeat === null ? null : effectiveRepeat * multiplicity,
        definition,
        key,
        input_tensors: materializePorts(operator.inputs, tensorsById),
        output_tensors: materializePorts(operator.outputs, tensorsById),
        scope_bindings: { ...environment },
        unresolved_symbols: [...operatorUnresolved],
      };
      operatorCopy.input_tensors.concat(operatorCopy.output_tensors).forEach((port) => {
        (port.tensor ? port.tensor.unresolved_symbols : []).forEach((symbol) => operatorUnresolved.add(symbol));
      });
      operatorCopy.unresolved_symbols = [...operatorUnresolved];
      operatorUnresolved.forEach((symbol) => unresolved.add(symbol));
      operatorsById[key] = operatorCopy;
      return operatorCopy;
    });
    return { ...template, tensors, operators };
  }

  function materializeGraph(overrides) {
    const unresolved = new Set();
    const globals = resolveGlobalSymbols(graph.shape_symbols, overrides, unresolved);
    const graphTensors = materializeTensors(graph.graph_tensors, globals, unresolved);
    const graphTensorsById = Object.fromEntries(graphTensors.map((tensor) => [tensor.tensor_id, tensor]));
    const operatorsById = {};
    const namedRepeats = {};
    const stages = graph.stages.map((stage) => {
      const stageRepeat = safelyEvaluateCount(
        stage.repeat,
        globals,
        unresolved,
        `stage ${stage.stage_id} repeat`,
      );
      const modules = stage.modules.map((module) => {
        const template = blocksById[module.template_id];
        const moduleRepeat = safelyEvaluateCount(
          module.repeat,
          globals,
          unresolved,
          `module ${module.module_id} repeat`,
        );
        const effectiveRepeat = stageRepeat === null || moduleRepeat === null ? null : stageRepeat * moduleRepeat;
        const moduleBindings = evaluateBindings(module.bindings, template.parameters, globals, unresolved);
        namedRepeats[module.module_id] = effectiveRepeat;
        const blockTensors = materializeTensors(template.tensors, moduleBindings, unresolved);
        const blockTensorsById = Object.fromEntries(blockTensors.map((tensor) => [tensor.tensor_id, tensor]));
        const keyPrefix = `${stage.stage_id}/${module.module_id}`;
        let templateCopy;
        if (template.operators.length) {
          templateCopy = materializeAtomicTemplate(
            template,
            moduleBindings,
            effectiveRepeat,
            keyPrefix,
            operatorsById,
            unresolved,
          );
        } else {
          const components = template.components.map((component) => {
            const componentTemplate = componentsById[component.template_id];
            const componentBindings = evaluateBindings(
              component.bindings,
              componentTemplate.parameters,
              moduleBindings,
              unresolved,
            );
            return {
              ...component,
              bindings: componentBindings,
              inputs: materializePorts(component.inputs, blockTensorsById),
              outputs: materializePorts(component.outputs, blockTensorsById),
              template: materializeAtomicTemplate(
                componentTemplate,
                componentBindings,
                effectiveRepeat,
                `${keyPrefix}/${component.component_id}`,
                operatorsById,
                unresolved,
              ),
            };
          });
          templateCopy = { ...template, tensors: blockTensors, components };
        }
        return {
          ...module,
          bindings: moduleBindings,
          module_repeat: moduleRepeat,
          effective_repeat: effectiveRepeat,
          inputs: materializePorts(module.inputs, graphTensorsById),
          outputs: materializePorts(module.outputs, graphTensorsById),
          template: templateCopy,
        };
      });
      return { ...stage, stage_repeat: stageRepeat, modules };
    });
    return {
      ...graph,
      bindings: globals,
      graph_tensors: graphTensors,
      graph_inputs: graph.graph_inputs.map((tensorId) => graphTensorsById[tensorId]),
      graph_outputs: graph.graph_outputs.map((tensorId) => graphTensorsById[tensorId]),
      stages,
      named_repeats: namedRepeats,
      operators_by_id: operatorsById,
      unresolved_symbols: [...unresolved],
    };
  }

  function selectedStage() {
    return state.materialized.stages.find((stage) => stage.stage_id === state.selection.stage);
  }

  function selectedModule() {
    const stage = selectedStage();
    return stage && stage.modules.find((module) => module.module_id === state.selection.module);
  }

  function selectedComponent() {
    const module = selectedModule();
    return module && (module.template.components || []).find(
      (component) => component.component_id === state.selection.component,
    );
  }

  function operatorKey(selection) {
    return [selection.stage, selection.module, selection.component, selection.operator].filter(Boolean).join("/");
  }

  function selectedOperator() {
    return state.materialized.operators_by_id[operatorKey(state.selection)] || null;
  }

  function operatorsFor(module, component) {
    if (!module) return [];
    return component ? component.template.operators : module.template.operators;
  }

  function normalizedSelection(candidate) {
    const stage = state.materialized.stages.find((item) => item.stage_id === candidate.stage)
      || state.materialized.stages[0];
    const module = stage.modules.find((item) => item.module_id === candidate.module) || stage.modules[0];
    const components = module.template.components || [];
    const component = components.length
      ? components.find((item) => item.component_id === candidate.component) || components[0]
      : null;
    const operators = operatorsFor(module, component);
    const operator = operators.find((item) => item.operator_id === candidate.operator) || operators[0];
    return {
      stage: stage.stage_id,
      module: module.module_id,
      component: component ? component.component_id : null,
      operator: operator ? operator.operator_id : null,
    };
  }

  function selectionFromHash() {
    const parameters = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    return {
      stage: parameters.get("stage"),
      module: parameters.get("module"),
      component: parameters.get("component"),
      operator: parameters.get("operator"),
    };
  }

  function syncHash() {
    const parameters = new URLSearchParams();
    ["stage", "module", "component", "operator"].forEach((key) => {
      if (state.selection[key]) parameters.set(key, state.selection[key]);
    });
    const nextHash = `#${parameters.toString()}`;
    if (window.location.hash !== nextHash) window.history.replaceState(null, "", nextHash);
  }

  function select(candidate) {
    cancelAnimation();
    state.selection = normalizedSelection(candidate);
    updateDagSelection();
    renderBreadcrumb();
    renderOperatorDetail();
    syncHash();
  }

  function updateDagSelection() {
    const selectedKey = operatorKey(state.selection);
    targets.dag.querySelectorAll(".dag-node--operator").forEach((node) => {
      node.classList.toggle("is-selected", node.getAttribute("data-node-id") === selectedKey);
    });
  }

  function renderSummary() {
    Atlas.clear(targets.summary);
    const model = pageData.model;
    const facts = Atlas.element("dl", { className: "model-summary-grid" });
    [
      ["Model type", model.model_type],
      ["Input → output", `${model.input_modalities.join(" + ")} → ${model.output_modalities.join(" + ")}`],
      ["Logical graph", `${graph.model_graph_id} · v${graph.version}`],
    ].forEach(([label, value]) => facts.appendChild(modelSummaryFact(label, value)));
    targets.summary.append(
      Atlas.element("p", { className: "section-kicker", text: "Model identity" }),
      Atlas.element("h2", { text: model.display_name }),
      facts,
    );
  }

  function modelSummaryFact(label, value) {
    const fact = Atlas.element("div", { className: "model-summary-fact" });
    fact.append(Atlas.element("dt", { text: label }), Atlas.element("dd", { text: value }));
    return fact;
  }

  function validatedControlValue(item, value) {
    try {
      const count = nonNegativeInteger(value, `symbol ${item.symbol}`);
      if (count < item.minimum || (item.maximum !== null && count > item.maximum)) {
        return state.overrides[item.symbol];
      }
      return count;
    } catch (error) {
      return state.overrides[item.symbol];
    }
  }

  function renderControls() {
    Atlas.clear(targets.controls);
    const controls = Atlas.element("div", { className: "workload-control-grid" });
    graph.shape_symbols.filter((item) => item.editable).forEach((item) => {
      const label = Atlas.element("label", { className: "workload-control" });
      const title = Atlas.element("span", { className: "workload-control-label", text: item.label });
      const input = Atlas.element("input");
      input.type = "number";
      input.id = `workload-${item.symbol.toLowerCase().replaceAll("_", "-")}`;
      input.dataset.symbol = item.symbol;
      input.min = String(item.minimum);
      if (item.maximum !== null) input.max = String(item.maximum);
      input.step = "1";
      input.value = String(state.overrides[item.symbol]);
      input.addEventListener("change", () => {
        const enteredValue = input.value.trim() ? Number(input.value) : NaN;
        const nextValue = validatedControlValue(item, enteredValue);
        state.overrides[item.symbol] = nextValue;
        input.value = String(nextValue);
        recompute();
      });
      const range = item.maximum === null
        ? `${item.symbol} ≥ ${item.minimum}`
        : `${item.symbol} · ${item.minimum}–${item.maximum}`;
      label.append(title, input, Atlas.element("small", { text: range }));
      controls.appendChild(label);
    });
    const derived = Atlas.element("div", { className: "derived-symbols" });
    derived.id = "derived-symbols";
    targets.controls.append(controls, derived);
    renderDerivedSymbols();
  }

  function renderDerivedSymbols() {
    const target = document.getElementById("derived-symbols");
    if (!target || !state.materialized) return;
    Atlas.clear(target);
    target.appendChild(Atlas.element("h3", { text: "Derived sequence lengths" }));
    graph.shape_symbols.filter((item) => item.expression !== null).forEach((item) => {
      const value = state.materialized.bindings[item.symbol];
      const chip = Atlas.element("span", { className: "derived-symbol" });
      chip.append(
        Atlas.element("strong", { text: item.symbol }),
        Atlas.element("span", { text: value === null ? "unresolved" : Atlas.format(value, 0) }),
      );
      target.appendChild(chip);
    });
  }

  function svgElement(tagName, attributes, text) {
    const element = document.createElementNS(SVG_NS, tagName);
    Object.entries(attributes || {}).forEach(([name, value]) => {
      if (value !== null && value !== undefined) element.setAttribute(name, String(value));
    });
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function findTensor(template, tensorId) {
    return (template.tensors || []).find((tensor) => tensor.tensor_id === tensorId) || null;
  }

  function resolveTemplateProducer(template, endpoint, prefix) {
    if (!endpoint) return [];
    if (endpoint.node_kind === "operator") return [`${prefix}/${endpoint.node_id}`];
    if (endpoint.node_kind !== "component") return [];
    const component = (template.components || []).find(
      (item) => item.component_id === endpoint.node_id,
    );
    if (!component) return [];
    const port = (component.template.output_ports || []).find(
      (item) => item.port === endpoint.port,
    );
    if (!port) return [];
    return resolveTensorProducers(
      component.template,
      port.tensor_id,
      `${prefix}/${component.component_id}`,
    );
  }

  function resolveTemplateConsumer(template, endpoint, prefix) {
    if (!endpoint) return [];
    if (endpoint.node_kind === "operator") return [`${prefix}/${endpoint.node_id}`];
    if (endpoint.node_kind !== "component") return [];
    const component = (template.components || []).find(
      (item) => item.component_id === endpoint.node_id,
    );
    if (!component) return [];
    const port = (component.template.input_ports || []).find(
      (item) => item.port === endpoint.port,
    );
    if (!port) return [];
    return resolveTensorConsumers(
      component.template,
      port.tensor_id,
      `${prefix}/${component.component_id}`,
    );
  }

  function resolveTensorProducers(template, tensorId, prefix) {
    const tensor = findTensor(template, tensorId);
    return tensor ? resolveTemplateProducer(template, tensor.producer, prefix) : [];
  }

  function resolveTensorConsumers(template, tensorId, prefix) {
    const tensor = findTensor(template, tensorId);
    if (!tensor) return [];
    return (tensor.consumers || []).flatMap(
      (endpoint) => resolveTemplateConsumer(template, endpoint, prefix),
    );
  }

  function buildDagModel() {
    const nodes = new Map();
    const edges = [];
    const edgeKeys = new Set();
    const scopes = [];
    let order = 0;

    function addNode(node) {
      if (!nodes.has(node.id)) nodes.set(node.id, { ...node, order: order += 1 });
    }

    function addEdge(source, target, tensor, kind, labelOverride) {
      if (!source || !target || source === target) return;
      const key = `${source}|${target}|${tensor ? tensor.tensor_id : labelOverride}|${kind || "tensor"}`;
      if (edgeKeys.has(key)) return;
      edgeKeys.add(key);
      edges.push({
        id: `dag-edge-${edges.length}`,
        source,
        target,
        tensor: tensor || null,
        kind: kind || "tensor",
        label: labelOverride || (tensor ? tensor.label : "tensor"),
        shape: tensor && Array.isArray(tensor.shape) ? tensor.shape : null,
      });
    }

    function addTemplateNodes(stage, module) {
      const modulePrefix = `${stage.stage_id}/${module.module_id}`;
      const moduleNodeIds = [];
      if ((module.template.operators || []).length) {
        module.template.operators.forEach((operator) => {
          addNode({
            id: operator.key,
            kind: "operator",
            label: operator.label,
            definitionId: operator.definition_id,
            category: operator.definition.category,
            operator,
            stageId: stage.stage_id,
            moduleId: module.module_id,
            componentId: null,
          });
          moduleNodeIds.push(operator.key);
        });
      } else {
        (module.template.components || []).forEach((component) => {
          const componentNodeIds = [];
          component.template.operators.forEach((operator) => {
            addNode({
              id: operator.key,
              kind: "operator",
              label: operator.label,
              definitionId: operator.definition_id,
              category: operator.definition.category,
              operator,
              stageId: stage.stage_id,
              moduleId: module.module_id,
              componentId: component.component_id,
            });
            componentNodeIds.push(operator.key);
            moduleNodeIds.push(operator.key);
          });
          scopes.push({
            kind: "component",
            label: component.label,
            stageId: stage.stage_id,
            moduleId: module.module_id,
            nodeIds: componentNodeIds,
          });
        });
      }
      if (module.module_repeat > 1) {
        scopes.push({
          kind: "transformer",
          label: `Transformer layers ×${Atlas.format(module.module_repeat, 0)}`,
          stageId: stage.stage_id,
          moduleId: module.module_id,
          nodeIds: moduleNodeIds,
        });
      } else if (moduleNodeIds.length > 1) {
        scopes.push({
          kind: "module",
          label: module.label,
          stageId: stage.stage_id,
          moduleId: module.module_id,
          nodeIds: moduleNodeIds,
        });
      }
      return modulePrefix;
    }

    function addTemplateEdges(template, prefix) {
      (template.tensors || []).forEach((tensor) => {
        const sources = resolveTemplateProducer(template, tensor.producer, prefix);
        const consumers = (tensor.consumers || []).flatMap(
          (endpoint) => resolveTemplateConsumer(template, endpoint, prefix),
        );
        sources.forEach((source) => consumers.forEach(
          (target) => addEdge(source, target, tensor, "tensor"),
        ));
      });
      (template.components || []).forEach((component) => {
        addTemplateEdges(component.template, `${prefix}/${component.component_id}`);
      });
    }

    const modulesById = new Map();
    state.materialized.stages.forEach((stage) => {
      stage.modules.forEach((module) => {
        modulesById.set(module.module_id, { stage, module });
        const prefix = addTemplateNodes(stage, module);
        addTemplateEdges(module.template, prefix);
      });
    });

    function moduleProducer(endpoint) {
      const context = modulesById.get(endpoint.node_id);
      if (!context) return [];
      const port = (context.module.template.output_ports || []).find(
        (item) => item.port === endpoint.port,
      );
      return port
        ? resolveTensorProducers(
          context.module.template,
          port.tensor_id,
          `${context.stage.stage_id}/${context.module.module_id}`,
        )
        : [];
    }

    function moduleConsumers(endpoint) {
      const context = modulesById.get(endpoint.node_id);
      if (!context) return [];
      const port = (context.module.template.input_ports || []).find(
        (item) => item.port === endpoint.port,
      );
      return port
        ? resolveTensorConsumers(
          context.module.template,
          port.tensor_id,
          `${context.stage.stage_id}/${context.module.module_id}`,
        )
        : [];
    }

    function ensureLoopNode(endpoint) {
      const stage = state.materialized.stages.find(
        (item) => item.loop_carried && item.loop_carried.loop_id === endpoint.node_id,
      );
      const id = `loop/${endpoint.node_id}`;
      addNode({
        id,
        kind: "loop",
        label: "Denoise state",
        definitionId: "loop state",
        stageId: stage ? stage.stage_id : "action-flow-decoder",
        moduleId: null,
        componentId: null,
      });
      return [id];
    }

    function graphProducers(endpoint) {
      if (!endpoint) return [];
      if (endpoint.node_kind === "module") return moduleProducer(endpoint);
      if (endpoint.node_kind === "loop") return ensureLoopNode(endpoint);
      return [];
    }

    function graphConsumers(endpoint) {
      if (!endpoint) return [];
      if (endpoint.node_kind === "module") return moduleConsumers(endpoint);
      if (endpoint.node_kind === "loop") return ensureLoopNode(endpoint);
      return [];
    }

    state.materialized.graph_tensors.forEach((tensor) => {
      let sources = graphProducers(tensor.producer);
      let consumers = (tensor.consumers || []).flatMap(graphConsumers);
      if (!sources.length) {
        const firstConsumer = consumers.map((id) => nodes.get(id)).find(Boolean);
        const stageId = firstConsumer ? firstConsumer.stageId : state.materialized.stages[0].stage_id;
        const id = `input/${tensor.tensor_id}`;
        addNode({
          id,
          kind: "input",
          label: tensor.label,
          definitionId: "model input",
          stageId,
          moduleId: null,
          componentId: null,
        });
        sources = [id];
      }
      if (!consumers.length) {
        const firstSource = sources.map((id) => nodes.get(id)).find(Boolean);
        const id = `output/${tensor.tensor_id}`;
        addNode({
          id,
          kind: "output",
          label: tensor.label,
          definitionId: "model output",
          stageId: firstSource ? firstSource.stageId : state.materialized.stages.at(-1).stage_id,
          moduleId: null,
          componentId: null,
        });
        consumers = [id];
      }
      const feedback = (tensor.consumers || []).some(
        (endpoint) => endpoint.node_kind === "loop" && endpoint.port === "iteration_output",
      );
      sources.forEach((source) => consumers.forEach(
        (target) => addEdge(source, target, tensor, feedback ? "feedback" : "tensor"),
      ));
    });

    state.materialized.stages.forEach((stage) => {
      stage.modules.forEach((module) => {
        if (!module.repeat_carried || module.module_repeat <= 1) return;
        const prefix = `${stage.stage_id}/${module.module_id}`;
        const inputPort = (module.template.input_ports || []).find(
          (item) => item.port === module.repeat_carried.input_port,
        );
        const outputPort = (module.template.output_ports || []).find(
          (item) => item.port === module.repeat_carried.output_port,
        );
        if (!inputPort || !outputPort) return;
        const sources = resolveTensorProducers(module.template, outputPort.tensor_id, prefix);
        const consumers = resolveTensorConsumers(module.template, inputPort.tensor_id, prefix);
        const tensor = findTensor(module.template, outputPort.tensor_id);
        sources.forEach((source) => consumers.forEach(
          (target) => addEdge(source, target, tensor, "repeat", "next layer hidden"),
        ));
      });
    });

    const actionStage = state.materialized.stages.find(
      (stage) => stage.stage_id === "action-flow-decoder",
    );
    if (actionStage) {
      scopes.push({
        kind: "denoise",
        label: `Denoise loop ×${Atlas.format(actionStage.stage_repeat, 0)}`,
        stageId: actionStage.stage_id,
        moduleId: null,
        nodeIds: [...nodes.values()]
          .filter((node) => node.stageId === actionStage.stage_id)
          .map((node) => node.id),
      });
    }
    return { nodes, edges, scopes };
  }

  function layoutDag(model) {
    const positions = new Map();
    const stageLayouts = [];
    let stageY = 18;
    let canvasWidth = 0;
    const nodeWidth = 164;
    const nodeHeight = 58;
    const xStep = 224;
    const yStep = 92;

    state.materialized.stages.forEach((stage) => {
      const stageNodes = [...model.nodes.values()].filter((node) => node.stageId === stage.stage_id);
      const nodeIds = new Set(stageNodes.map((node) => node.id));
      const regularEdges = model.edges.filter(
        (edge) => edge.kind === "tensor" && nodeIds.has(edge.source) && nodeIds.has(edge.target),
      );
      const indegree = new Map(stageNodes.map((node) => [node.id, 0]));
      const outgoing = new Map(stageNodes.map((node) => [node.id, []]));
      regularEdges.forEach((edge) => {
        indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
        outgoing.get(edge.source).push(edge.target);
      });
      const ranks = new Map(stageNodes.map((node) => [node.id, 0]));
      const queue = stageNodes
        .filter((node) => indegree.get(node.id) === 0)
        .sort((left, right) => left.order - right.order);
      while (queue.length) {
        const source = queue.shift();
        (outgoing.get(source.id) || []).forEach((targetId) => {
          ranks.set(targetId, Math.max(ranks.get(targetId) || 0, (ranks.get(source.id) || 0) + 1));
          indegree.set(targetId, indegree.get(targetId) - 1);
          if (indegree.get(targetId) === 0) {
            queue.push(model.nodes.get(targetId));
            queue.sort((left, right) => left.order - right.order);
          }
        });
      }
      let maxRank = Math.max(0, ...ranks.values());
      stageNodes.filter((node) => node.kind === "output").forEach((node) => {
        ranks.set(node.id, maxRank + 1);
      });
      maxRank = Math.max(0, ...ranks.values());
      const byRank = new Map();
      stageNodes.forEach((node) => {
        const rank = ranks.get(node.id) || 0;
        if (!byRank.has(rank)) byRank.set(rank, []);
        byRank.get(rank).push(node);
      });
      const maxLanes = Math.max(1, ...[...byRank.values()].map((items) => items.length));
      const stageHeight = 126 + maxLanes * yStep;
      const stageWidth = 206 + (maxRank + 1) * xStep;
      byRank.forEach((items, rank) => {
        items.sort((left, right) => left.order - right.order);
        const contentHeight = items.length * yStep;
        const laneStart = stageY + 76 + ((maxLanes * yStep - contentHeight) / 2);
        items.forEach((node, lane) => {
          const compact = node.kind !== "operator";
          positions.set(node.id, {
            x: 66 + rank * xStep,
            y: laneStart + lane * yStep,
            width: compact ? 142 : nodeWidth,
            height: compact ? 48 : nodeHeight,
          });
        });
      });
      stageLayouts.push({
        stage,
        x: 12,
        y: stageY,
        width: stageWidth,
        height: stageHeight,
      });
      canvasWidth = Math.max(canvasWidth, stageWidth + 24);
      stageY += stageHeight + 24;
    });
    return {
      positions,
      stages: stageLayouts,
      width: Math.max(1120, canvasWidth),
      height: stageY,
    };
  }

  function scopeBounds(scope, positions, padding) {
    const values = scope.nodeIds.map((id) => positions.get(id)).filter(Boolean);
    if (!values.length) return null;
    const left = Math.min(...values.map((value) => value.x));
    const top = Math.min(...values.map((value) => value.y));
    const right = Math.max(...values.map((value) => value.x + value.width));
    const bottom = Math.max(...values.map((value) => value.y + value.height));
    return {
      x: left - padding,
      y: top - padding - 20,
      width: right - left + padding * 2,
      height: bottom - top + padding * 2 + 20,
    };
  }

  function edgePath(edge, layout) {
    const source = layout.positions.get(edge.source);
    const target = layout.positions.get(edge.target);
    if (!source || !target) return "";
    const x1 = source.x + source.width;
    const y1 = source.y + source.height / 2;
    const x2 = target.x;
    const y2 = target.y + target.height / 2;
    if (edge.kind === "feedback" || edge.kind === "repeat") {
      const stage = layout.stages.find((item) => item.stage.stage_id === modelNodeStage(edge.source));
      const bendY = stage ? stage.y + stage.height - 18 : Math.max(y1, y2) + 80;
      return `M ${x1} ${y1} C ${x1 + 55} ${bendY}, ${x2 - 55} ${bendY}, ${x2} ${y2}`;
    }
    const bend = Math.max(54, Math.abs(x2 - x1) * 0.46);
    return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
  }

  let activeDagModel = null;

  function modelNodeStage(nodeId) {
    const node = activeDagModel && activeDagModel.nodes.get(nodeId);
    return node ? node.stageId : null;
  }

  function shortEdgeLabel(edge) {
    const shape = edge.shape
      ? `[${edge.shape.map((value) => value === null ? "?" : Atlas.format(value, 0)).join("×")}]`
      : "";
    const label = edge.label.length > 28 ? `${edge.label.slice(0, 26)}…` : edge.label;
    return `${label} ${shape}`.trim();
  }

  function splitNodeLabel(label) {
    if (label.length <= 22) return [label];
    const words = label.split(" ");
    const lines = [""];
    words.forEach((word) => {
      const current = lines.at(-1);
      if (current && `${current} ${word}`.length > 22 && lines.length < 2) lines.push(word);
      else lines[lines.length - 1] = current ? `${current} ${word}` : word;
    });
    return lines;
  }

  function renderDagNode(svg, node, box) {
    const group = svgElement("g", {
      class: `dag-node dag-node--${node.kind}${node.id === operatorKey(state.selection) ? " is-selected" : ""}`,
      transform: `translate(${box.x} ${box.y})`,
      "data-node-id": node.id,
      "data-node-kind": node.kind,
      "data-definition-id": node.definitionId,
    });
    if (node.kind === "operator") {
      group.setAttribute("role", "button");
      group.setAttribute("tabindex", "0");
      group.setAttribute("aria-label", `Inspect ${node.label}`);
    }
    group.appendChild(svgElement("rect", {
      width: box.width,
      height: box.height,
      rx: node.kind === "operator" ? 9 : 24,
    }));
    const lines = splitNodeLabel(node.label);
    lines.forEach((line, index) => {
      group.appendChild(svgElement("text", {
        x: box.width / 2,
        y: 20 + index * 14,
        class: "dag-node-label",
        "text-anchor": "middle",
      }, line));
    });
    group.appendChild(svgElement("text", {
      x: box.width / 2,
      y: box.height - 9,
      class: "dag-node-kind",
      "text-anchor": "middle",
    }, node.definitionId));
    group.appendChild(svgElement("title", {}, `${node.label} · ${node.definitionId}`));
    if (node.kind === "operator") {
      const selectNode = () => select({
        stage: node.stageId,
        module: node.moduleId,
        component: node.componentId,
        operator: node.operator.operator_id,
      });
      group.addEventListener("click", selectNode);
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectNode();
        }
      });
    }
    svg.appendChild(group);
  }

  function renderDag() {
    Atlas.clear(targets.dag);
    const model = buildDagModel();
    activeDagModel = model;
    const layout = layoutDag(model);
    const legend = Atlas.element("div", { className: "dag-legend" });
    [["dag-legend-tensor", "tensor edge"], ["dag-legend-repeat", "repeat / loop carry"]].forEach(([kind, label]) => {
      const item = Atlas.element("span", { className: `dag-legend-item ${kind}` });
      item.append(
        Atlas.element("span", { className: "dag-legend-line" }),
        Atlas.element("span", { text: label }),
      );
      legend.appendChild(item);
    });
    legend.appendChild(Atlas.element("span", {
      className: "dag-legend-note",
      text: "Representative operators; scopes are folded, never unrolled.",
    }));
    const svg = svgElement("svg", {
      class: "dag-svg",
      viewBox: `0 0 ${layout.width} ${layout.height}`,
      width: layout.width,
      height: layout.height,
      role: "img",
      "aria-label": "Pi0 logical tensor dependency graph",
    });
    const definitions = svgElement("defs");
    const marker = svgElement("marker", {
      id: "dag-arrow",
      markerWidth: 8,
      markerHeight: 8,
      refX: 7,
      refY: 4,
      orient: "auto",
      markerUnits: "strokeWidth",
    });
    marker.appendChild(svgElement("path", { d: "M 0 0 L 8 4 L 0 8 z", class: "dag-arrow-head" }));
    definitions.appendChild(marker);
    svg.appendChild(definitions);

    layout.stages.forEach((item, index) => {
      const stageGroup = svgElement("g", { class: `dag-stage dag-stage--${index + 1}` });
      stageGroup.append(
        svgElement("rect", {
          x: item.x,
          y: item.y,
          width: layout.width - 24,
          height: item.height,
          rx: 18,
        }),
        svgElement("text", {
          x: item.x + 22,
          y: item.y + 30,
          class: "dag-stage-index",
        }, `0${index + 1}`),
        svgElement("text", {
          x: item.x + 62,
          y: item.y + 30,
          class: "dag-stage-label",
        }, item.stage.label),
      );
      svg.appendChild(stageGroup);
    });

    const scopeOrder = { denoise: 0, transformer: 1, module: 2, component: 3 };
    [...model.scopes].sort((left, right) => scopeOrder[left.kind] - scopeOrder[right.kind]).forEach((scope) => {
      const padding = scope.kind === "denoise" ? 38 : scope.kind === "transformer" ? 28 : 16;
      const bounds = scopeBounds(scope, layout.positions, padding);
      if (!bounds) return;
      const group = svgElement("g", {
        class: `dag-scope dag-scope--${scope.kind}`,
        "data-scope-kind": scope.kind,
        "data-module-id": scope.moduleId,
      });
      group.append(
        svgElement("rect", { ...bounds, rx: scope.kind === "component" ? 12 : 18 }),
        svgElement("text", {
          x: bounds.x + 14,
          y: bounds.y + 18,
          class: "dag-scope-label",
        }, scope.label),
      );
      svg.appendChild(group);
    });

    model.edges.forEach((edge) => {
      const path = edgePath(edge, layout);
      if (!path) return;
      const group = svgElement("g", {
        class: `dag-edge dag-edge--${edge.kind}`,
        "data-tensor-id": edge.tensor ? edge.tensor.tensor_id : "repeat-carry",
        "data-source": edge.source,
        "data-target": edge.target,
      });
      const edgePathElement = svgElement("path", {
        id: edge.id,
        d: path,
        "marker-end": "url(#dag-arrow)",
      });
      const text = svgElement("text", { class: "dag-edge-label" });
      const textPath = svgElement("textPath", {
        href: `#${edge.id}`,
        startOffset: "50%",
        "text-anchor": "middle",
      }, shortEdgeLabel(edge));
      text.appendChild(textPath);
      group.append(edgePathElement, text);
      svg.appendChild(group);
    });
    [...model.nodes.values()].forEach((node) => {
      const box = layout.positions.get(node.id);
      if (box) renderDagNode(svg, node, box);
    });
    targets.dag.append(legend, svg);
  }

  function renderStages() {
    renderDag();
  }

  function renderModules() {
    // The complete model stays visible; operator selection never changes topology.
  }

  function renderComponents() {
    // Component boundaries are subtle regions inside each Transformer scope.
  }

  function renderOperators() {
    // Atomic operators are rendered as selectable SVG nodes in the complete DAG.
  }

  function renderBreadcrumb() {
    Atlas.clear(targets.breadcrumb);
    const stage = selectedStage();
    const module = selectedModule();
    const component = selectedComponent();
    const operator = selectedOperator();
    const values = [
      ["Model", pageData.model.display_name],
      ["Stage", stage.label],
      ["Block/module", module.label],
    ];
    if (component) values.push(["Component", component.label]);
    if (operator) values.push(["Operator", operator.label]);
    values.forEach(([kind, label], index) => {
      if (index) targets.breadcrumb.appendChild(Atlas.element("span", { className: "breadcrumb-separator", text: "/" }));
      const crumb = Atlas.element("span", { className: "breadcrumb-item" });
      crumb.append(
        Atlas.element("small", { text: kind }),
        Atlas.element("strong", { text: label }),
      );
      targets.breadcrumb.appendChild(crumb);
    });
  }

  function expressionLabel(expression) {
    if (typeof expression === "number") return String(expression);
    if (!expression || typeof expression !== "object") return "?";
    if (typeof expression.symbol === "string") return expression.symbol;
    const args = (expression.args || []).map(expressionLabel);
    switch (expression.op) {
      case "add": return `(${args.join(" + ")})`;
      case "sub": return `(${args[0]} - ${args[1]})`;
      case "mul": return `(${args.join(" × ")})`;
      case "div": return `(${args[0]} / ${args[1]})`;
      case "ceil_div": return `ceil(${args[0]} / ${args[1]})`;
      default: return "?";
    }
  }

  function symbolicShape(tensor) {
    return tensor ? tensor.axes.map((axis) => expressionLabel(axis.expression)).join(" × ") : "unresolved";
  }

  function concreteShape(tensor) {
    if (!tensor || !Array.isArray(tensor.shape)) return "unresolved";
    return tensor.shape.map((value) => value === null ? "?" : Atlas.format(value, 2)).join(" × ");
  }

  function renderTensorShapes(title, ports) {
    const group = Atlas.element("section", { className: "tensor-group" });
    group.appendChild(Atlas.element("h3", { text: title }));
    if (!ports.length) {
      group.appendChild(Atlas.element("p", { className: "empty-state", text: "No declared tensors." }));
      return group;
    }
    ports.forEach((port) => {
      const row = Atlas.element("div", { className: "tensor-shape-row" });
      row.append(
        Atlas.element("strong", { className: "tensor-port", text: port.port }),
        Atlas.element("span", { className: "tensor-shape-chip symbolic-shape", text: `symbolic [${symbolicShape(port.tensor)}]` }),
        Atlas.element("span", { className: "tensor-shape-chip concrete-shape", text: `concrete [${concreteShape(port.tensor)}]` }),
      );
      group.appendChild(row);
    });
    return group;
  }

  function renderAnalysis(operator) {
    const section = Atlas.element("section", { className: "operator-analysis" });
    section.appendChild(Atlas.element("h3", { text: "Logical analysis" }));
    if (!operator.analysis.length) {
      section.appendChild(Atlas.element("p", { className: "empty-state", text: "No analytical count is declared for this atomic operator." }));
      return section;
    }
    const stage = selectedStage();
    const module = selectedModule();
    const factors = {
      stage: stage.stage_repeat,
      layer: module.module_repeat,
      intrinsic: operator.multiplicity,
    };
    const list = Atlas.element("dl", { className: "analysis-grid" });
    operator.analysis.forEach((metric) => {
      const fact = Atlas.element("div", { className: "analysis-fact" });
      const aggregate = metric.value === null
        ? null
        : metric.value * factors.stage * factors.layer * factors.intrinsic;
      fact.append(
        Atlas.element("dt", { text: metric.metric.replaceAll("_", " ") }),
        Atlas.element("dd", {
          className: "analysis-primary",
          text: metric.value === null
            ? "Per atomic invocation · unresolved"
            : `Per atomic invocation · ${Atlas.format(metric.value, 2)} ${metric.unit}`,
        }),
        Atlas.element("dd", {
          className: "analysis-aggregate",
          text: aggregate === null
            ? "Aggregate logical value · unresolved"
            : `Aggregate logical value · ${Atlas.format(aggregate, 2)} ${metric.unit}`,
        }),
        Atlas.element("dd", {
          className: "analysis-factors",
          text: `stage ${Atlas.format(factors.stage, 0)} × layers ${Atlas.format(factors.layer, 0)} × intrinsic ${Atlas.format(factors.intrinsic, 0)}`,
        }),
      );
      list.appendChild(fact);
    });
    section.appendChild(list);
    return section;
  }

  function gemmDimensions(operator) {
    const values = operator.bindings;
    if ([values.M, values.N, values.K].every((value) => typeof value === "number")) {
      return { M: values.M, N: values.N, K: values.K };
    }
    const scope = operator.scope_bindings;
    if (operator.definition_id === "patch-embedding") {
      return {
        M: scope.B * scope.V * scope.T,
        N: scope.D,
        K: scope.P * scope.P * scope.C,
      };
    }
    const inputShape = operator.input_tensors[0] && operator.input_tensors[0].shape;
    const outputShape = operator.output_tensors[0] && operator.output_tensors[0].shape;
    if (!inputShape || !outputShape || inputShape.includes(null) || outputShape.includes(null)) {
      return { M: null, N: null, K: null };
    }
    return {
      M: inputShape.slice(0, -1).reduce((total, value) => total * value, 1),
      N: outputShape[outputShape.length - 1],
      K: inputShape[inputShape.length - 1],
    };
  }

  function cancelAnimation() {
    if (state.animation && state.animation.timer !== null) {
      window.clearTimeout(state.animation.timer);
    }
    state.animation = null;
  }

  function clearSvg(svg) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }

  function microscopeCanvas(label) {
    return svgElement("svg", {
      class: "microscope-canvas",
      viewBox: "0 0 420 210",
      role: "img",
      "aria-label": label,
    });
  }

  function diagramTile(svg, x, y, width, height, label, className, role) {
    const group = svgElement("g", {
      class: `microscope-tile ${className || ""}`,
      "data-tile-role": role,
    });
    group.append(
      svgElement("rect", { x, y, width, height, rx: 7 }),
      svgElement("text", {
        x: x + width / 2,
        y: y + height / 2 + 4,
        "text-anchor": "middle",
      }, label),
    );
    svg.appendChild(group);
    return group;
  }

  function animationControls(visualizer, frameCount, drawFrame) {
    const controls = Atlas.element("div", { className: "animation-controls" });
    const toggle = Atlas.element("button", { text: "Play" });
    const step = Atlas.element("button", { text: "Step" });
    const reset = Atlas.element("button", { text: "Reset" });
    [toggle, step, reset].forEach((button) => { button.type = "button"; });
    const speedLabel = Atlas.element("label", { className: "animation-speed" });
    speedLabel.appendChild(Atlas.element("span", { text: "Speed" }));
    const speed = Atlas.element("select");
    [[0.5, "0.5×"], [1, "1×"], [2, "2×"]].forEach(([value, label]) => {
      const option = Atlas.element("option", { text: label });
      option.value = String(value);
      if (value === 1) option.selected = true;
      speed.appendChild(option);
    });
    speedLabel.appendChild(speed);
    const status = Atlas.element("span", { className: "animation-status" });
    status.setAttribute("aria-live", "polite");
    controls.append(toggle, step, reset, speedLabel, status);
    visualizer.appendChild(controls);

    const animation = {
      frame: 0,
      playing: false,
      speed: 1,
      timer: null,
    };
    state.animation = animation;

    function paint() {
      status.textContent = drawFrame(animation.frame);
      visualizer.dataset.animationFrame = String(animation.frame);
    }

    function schedule() {
      if (!animation.playing || state.animation !== animation) return;
      animation.timer = window.setTimeout(() => {
        animation.frame = (animation.frame + 1) % frameCount;
        paint();
        schedule();
      }, 900 / animation.speed);
    }

    function setPlaying(playing) {
      if (animation.timer !== null) window.clearTimeout(animation.timer);
      animation.timer = null;
      animation.playing = playing;
      toggle.textContent = playing ? "Pause" : "Play";
      toggle.setAttribute("aria-label", playing ? "Pause computation animation" : "Play computation animation");
      schedule();
    }

    toggle.addEventListener("click", () => setPlaying(!animation.playing));
    step.addEventListener("click", () => {
      setPlaying(false);
      animation.frame = (animation.frame + 1) % frameCount;
      paint();
    });
    reset.addEventListener("click", () => {
      setPlaying(false);
      animation.frame = 0;
      paint();
    });
    speed.addEventListener("change", () => {
      animation.speed = Number(speed.value);
      if (animation.playing) setPlaying(true);
    });
    paint();
    const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced) setPlaying(true);
  }

  function renderGemmVisualizer(operator) {
    const dimensions = gemmDimensions(operator);
    const visualizer = Atlas.element("section", { className: "operator-visualizer microscope microscope--gemm" });
    visualizer.dataset.visualizerMode = "gemm";
    visualizer.append(
      Atlas.element("h3", { text: "GEMM tile microscope" }),
      Atlas.element("p", { className: "visualizer-formula", text: "D = A B + C" }),
    );
    const labels = Atlas.element("div", { className: "microscope-dimensions" });
    labels.append(
      Atlas.element("span", { text: `M ${dimensions.M ?? "?"}` }),
      Atlas.element("span", { text: `N ${dimensions.N ?? "?"}` }),
      Atlas.element("span", { text: `K ${dimensions.K ?? "?"}` }),
      Atlas.element("span", { text: "Illustrative tile 2 × 2" }),
    );
    const canvas = microscopeCanvas("Tiled matrix multiplication accumulating one output tile");
    visualizer.append(labels, canvas);
    animationControls(visualizer, 12, (frame) => {
      clearSvg(canvas);
      const outputTile = Math.floor(frame / 4);
      const phase = frame % 4;
      const kTile = Math.min(phase, 2);
      diagramTile(canvas, 18, 58, 76, 70, `A(${outputTile},${kTile})`, phase < 3 ? "is-active" : "is-complete", "a-tile");
      diagramTile(canvas, 120, 58, 76, 70, `B(${kTile},${outputTile})`, phase < 3 ? "is-active" : "is-complete", "b-tile");
      canvas.appendChild(svgElement("text", { x: 106, y: 96, class: "microscope-symbol", "text-anchor": "middle" }, "×"));
      diagramTile(canvas, 224, 58, 76, 70, phase < 3 ? `acc ${kTile + 1}/3` : "acc ready", phase < 3 ? "is-accumulating" : "is-complete", "accumulator-tile");
      canvas.appendChild(svgElement("text", { x: 210, y: 96, class: "microscope-symbol", "text-anchor": "middle" }, "+="));
      diagramTile(canvas, 328, 58, 76, 70, `D tile ${outputTile + 1}`, phase === 3 ? "is-written" : "", "output-tile");
      canvas.appendChild(svgElement("text", { x: 314, y: 96, class: "microscope-symbol", "text-anchor": "middle" }, "→"));
      canvas.appendChild(svgElement("text", { x: 18, y: 26, class: "microscope-phase" }, phase < 3
        ? `Accumulate K tile ${kTile + 1} of 3 for output tile ${outputTile + 1}`
        : `Write completed accumulator into output tile ${outputTile + 1}`));
      return phase < 3
        ? `Output tile ${outputTile + 1}: accumulating K tile ${kTile + 1} of 3`
        : `Output tile ${outputTile + 1}: write D tile`;
    });
    return visualizer;
  }

  function firstNumber(values) {
    return values.find((value) => typeof value === "number") ?? null;
  }

  function renderAttentionVisualizer(operator) {
    const bindings = operator.scope_bindings;
    const queryLength = firstNumber([bindings.SQ, bindings.S, bindings.T]);
    const keyValueLength = firstNumber([bindings.SKV, bindings.S, bindings.T]);
    const visualizer = Atlas.element("section", { className: "operator-visualizer microscope microscope--attention" });
    visualizer.dataset.visualizerMode = "attention";
    visualizer.appendChild(Atlas.element("h3", { text: "Attention tile microscope" }));
    const dimensions = Atlas.element("dl", { className: "attention-dimensions microscope-dimensions" });
    [
      ["Query length", queryLength],
      ["Key/value length", keyValueLength],
      ["Head count", bindings.H],
      ["Head dimension", bindings.HD],
    ].forEach(([label, value]) => dimensions.appendChild(modelSummaryFact(label, value ?? "unresolved")));
    const canvas = microscopeCanvas("Tiled attention from query-key scores through softmax and value projection");
    visualizer.append(dimensions, canvas);
    animationControls(visualizer, 8, (frame) => {
      clearSvg(canvas);
      const scorePhase = frame < 3;
      const scalePhase = frame === 3;
      const softmaxPhase = frame === 4;
      const valuePhase = frame > 4;
      diagramTile(canvas, 12, 64, 56, 62, "Q", scorePhase ? "is-active" : "is-complete", "query-tile");
      diagramTile(canvas, 82, 64, 56, 62, "Kᵀ", scorePhase ? "is-active" : "is-complete", "key-tile");
      diagramTile(canvas, 158, 64, 68, 62, scorePhase ? `QKᵀ ${frame + 1}/3` : "scores", (scorePhase || scalePhase) ? "is-active" : "is-complete", "score-tile");
      diagramTile(canvas, 246, 64, 68, 62, softmaxPhase ? "softmax row" : "P", (scalePhase || softmaxPhase) ? "is-active" : (valuePhase ? "is-complete" : ""), "probability-tile");
      diagramTile(canvas, 328, 64, 38, 62, "V", valuePhase ? "is-active" : "", "value-tile");
      diagramTile(canvas, 378, 64, 38, 62, "O", valuePhase ? "is-written" : "", "attention-output-tile");
      canvas.appendChild(svgElement("text", { x: 12, y: 28, class: "microscope-phase" }, scorePhase
        ? `Tiled QKᵀ · score tile ${frame + 1} of 3`
        : scalePhase
          ? "Scale scores and apply the declared mask"
          : softmaxPhase
            ? "Normalize one score row with softmax"
            : `Tiled P V · output tile ${frame - 4} of 3`));
      if (scorePhase) return `QK transpose score tile ${frame + 1} of 3`;
      if (scalePhase) return "Scale and mask scores";
      if (softmaxPhase) return "Row softmax";
      return `P V output tile ${frame - 4} of 3`;
    });
    return visualizer;
  }

  function renderConvVisualizer(operator) {
    const bindings = operator.scope_bindings;
    const visualizer = Atlas.element("section", { className: "operator-visualizer microscope microscope--conv" });
    visualizer.dataset.visualizerMode = "conv";
    visualizer.append(
      Atlas.element("h3", { text: "Patch convolution microscope" }),
      Atlas.element("p", { className: "visualizer-formula", text: "output tile = receptive field · weight tile" }),
    );
    const dimensions = Atlas.element("div", { className: "microscope-dimensions" });
    [
      `Image ${bindings.H} × ${bindings.W}`,
      `Patch / stride ${bindings.P} × ${bindings.P}`,
      `Channels ${bindings.C}`,
      `Tokens / view ${bindings.T}`,
      `Output width ${bindings.D}`,
    ].forEach((label) => dimensions.appendChild(Atlas.element("span", { text: label })));
    const canvas = microscopeCanvas("Patch embedding convolution maps image receptive fields to output tokens");
    visualizer.append(dimensions, canvas);
    animationControls(visualizer, 4, (frame) => {
      clearSvg(canvas);
      const patchPositions = [[0, 0], [1, 0], [0, 1], [1, 1]];
      const [column, row] = patchPositions[frame];
      canvas.appendChild(svgElement("text", { x: 18, y: 24, class: "microscope-phase" }, `Patch ${frame + 1}: image field → projected token`));
      const cell = 16;
      for (let y = 0; y < 6; y += 1) {
        for (let x = 0; x < 6; x += 1) {
          canvas.appendChild(svgElement("rect", {
            x: 20 + x * cell,
            y: 52 + y * cell,
            width: cell - 2,
            height: cell - 2,
            class: "conv-grid-cell",
          }));
        }
      }
      canvas.appendChild(svgElement("rect", {
        x: 20 + column * 48,
        y: 52 + row * 48,
        width: 46,
        height: 46,
        rx: 4,
        class: "conv-receptive-field is-active",
        "data-tile-role": "input-receptive-field",
      }));
      diagramTile(canvas, 150, 70, 72, 60, "weights", "is-active", "weight-tile");
      canvas.appendChild(svgElement("text", { x: 132, y: 104, class: "microscope-symbol", "text-anchor": "middle" }, "×"));
      canvas.appendChild(svgElement("text", { x: 242, y: 104, class: "microscope-symbol", "text-anchor": "middle" }, "→"));
      for (let y = 0; y < 2; y += 1) {
        for (let x = 0; x < 2; x += 1) {
          canvas.appendChild(svgElement("rect", {
            x: 276 + x * 50,
            y: 62 + y * 50,
            width: 44,
            height: 44,
            rx: 6,
            class: `conv-output-cell${x === column && y === row ? " is-written" : ""}`,
            "data-tile-role": x === column && y === row ? "output-tile" : "output-grid-cell",
          }));
        }
      }
      canvas.appendChild(svgElement("text", { x: 20, y: 172, class: "microscope-caption" }, "Illustrative 3 × 3 field; labels above retain Pi0’s actual patch geometry."));
      return `Patch tile ${frame + 1} of 4 writes output token tile ${frame + 1}`;
    });
    return visualizer;
  }

  function visualizerTensorChip(port) {
    const label = `${port.port} [${concreteShape(port.tensor)}]`;
    return Atlas.element("span", { className: "basic-tensor-chip", text: label });
  }

  function renderBasicVisualizer(operator) {
    const visualizer = Atlas.element("section", { className: "operator-visualizer basic-visualizer" });
    visualizer.appendChild(Atlas.element("h3", { text: "Operator semantics" }));
    const flow = Atlas.element("div", { className: "basic-operator-flow" });
    const inputs = Atlas.element("div", { className: "basic-tensors" });
    operator.input_tensors.forEach((port) => inputs.appendChild(visualizerTensorChip(port)));
    const outputs = Atlas.element("div", { className: "basic-tensors" });
    operator.output_tensors.forEach((port) => outputs.appendChild(visualizerTensorChip(port)));
    flow.append(
      inputs,
      Atlas.element("span", { className: "visualizer-arrow", text: "→" }),
      Atlas.element("span", { className: "basic-formula", text: operator.definition.formula_display }),
      Atlas.element("span", { className: "visualizer-arrow", text: "→" }),
      outputs,
    );
    visualizer.appendChild(flow);
    return visualizer;
  }

  function renderVisualizer(operator) {
    switch (operator.definition.visualizer) {
      case "gemm": return renderGemmVisualizer(operator);
      case "attention": return renderAttentionVisualizer(operator);
      case "conv": return renderConvVisualizer(operator);
      case "basic": return renderBasicVisualizer(operator);
      default: return renderBasicVisualizer(operator);
    }
  }

  function renderOperatorDetail() {
    cancelAnimation();
    Atlas.clear(targets.detail);
    const operator = selectedOperator();
    if (!operator) {
      targets.detail.appendChild(Atlas.element("p", { className: "empty-state", text: "Select an atomic operator." }));
      return;
    }
    targets.detail.append(
      Atlas.element("p", { className: "detail-eyebrow", text: `${operator.definition.category} · ${operator.definition_id}` }),
      Atlas.element("h2", { text: operator.label }),
      Atlas.element("p", { className: "operator-formula", text: operator.definition.formula_display }),
    );
    if (operator.unresolved_symbols.length) {
      targets.detail.appendChild(Atlas.element("p", {
        className: "binding-warning",
        text: `Unresolved symbols: ${[...new Set(operator.unresolved_symbols)].join(", ")}. Symbolic axes are retained below.`,
      }));
    }
    targets.detail.append(
      renderTensorShapes("Input shapes", operator.input_tensors),
      renderTensorShapes("Output shapes", operator.output_tensors),
    );
    targets.detail.append(renderAnalysis(operator), renderVisualizer(operator));
  }

  function renderWorkspace() {
    renderStages();
    renderModules();
    renderComponents();
    renderOperators();
    renderBreadcrumb();
    renderOperatorDetail();
  }

  function recompute() {
    state.materialized = materializeGraph(state.overrides);
    state.selection = normalizedSelection(state.selection);
    renderDerivedSymbols();
    renderWorkspace();
    syncHash();
  }

  const defaultBindings = pageData.default_materialization.bindings || {};
  graph.shape_symbols.filter((item) => item.editable).forEach((item) => {
    state.overrides[item.symbol] = defaultBindings[item.symbol] ?? item.default;
  });
  state.materialized = materializeGraph(state.overrides);
  state.selection = normalizedSelection(selectionFromHash());
  renderSummary();
  renderControls();
  renderWorkspace();
  syncHash();

  window.addEventListener("hashchange", () => {
    cancelAnimation();
    state.selection = normalizedSelection(selectionFromHash());
    updateDagSelection();
    renderBreadcrumb();
    renderOperatorDetail();
    syncHash();
  });
}());
