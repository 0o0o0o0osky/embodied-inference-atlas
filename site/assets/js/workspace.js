(function () {
  "use strict";

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
    stages: document.getElementById("stage-flow"),
    modules: document.getElementById("module-flow"),
    componentSection: document.getElementById("component-section"),
    components: document.getElementById("component-flow"),
    operators: document.getElementById("operator-flow"),
    detail: document.getElementById("operator-detail"),
  };
  const state = {
    overrides: {},
    materialized: null,
    selection: { stage: null, module: null, component: null, operator: null },
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

  function safelyEvaluate(expression, bindings, unresolved) {
    try {
      return evaluateExpression(expression, bindings);
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
        if (typeof value !== "number" || !Number.isFinite(value) || value < item.minimum || value > item.maximum) {
          unresolved.add(symbol);
          value = null;
        }
      } else {
        const references = expressionSymbols(item.expression);
        const localBindings = Object.fromEntries(references.map((name) => [name, resolve(name)]));
        value = safelyEvaluate(item.expression, localBindings, unresolved);
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
      return [symbol, safelyEvaluate(actual[symbol].expression, environment, unresolved)];
    }));
  }

  function materializeTensors(tensors, environment, unresolved) {
    return (tensors || []).map((tensor) => {
      const tensorUnresolved = new Set();
      const shape = tensor.axes.map((axis) => safelyEvaluate(axis.expression, environment, tensorUnresolved));
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
      const multiplicity = safelyEvaluate(operator.multiplicity, environment, operatorUnresolved);
      const bindings = evaluateBindings(
        operator.bindings,
        definition ? definition.parameters : [],
        environment,
        operatorUnresolved,
      );
      const analysis = (definition ? definition.analysis : []).map((metric) => ({
        ...metric,
        value: safelyEvaluate(metric.expression, bindings, operatorUnresolved),
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
      const stageRepeatValue = safelyEvaluate(stage.repeat, globals, unresolved);
      const stageRepeat = stageRepeatValue === null ? null : Math.trunc(stageRepeatValue);
      const modules = stage.modules.map((module) => {
        const template = blocksById[module.template_id];
        const moduleRepeatValue = safelyEvaluate(module.repeat, globals, unresolved);
        const moduleRepeat = moduleRepeatValue === null ? null : Math.trunc(moduleRepeatValue);
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
    state.selection = normalizedSelection(candidate);
    renderWorkspace();
    syncHash();
  }

  function repeatChip(label, value) {
    return Atlas.element("span", {
      className: "repeat-chip",
      text: `${label} ×${value === null ? "?" : Atlas.format(value, 0)}`,
    });
  }

  function nodeButton(kind, label, selected, onSelect) {
    const button = Atlas.element("button", {
      className: `workspace-node ${kind}-node${selected ? " is-selected" : ""}`,
    });
    button.type = "button";
    button.appendChild(Atlas.element("strong", { text: label }));
    button.addEventListener("click", onSelect);
    return button;
  }

  function appendPipeline(target, values, buildNode) {
    Atlas.clear(target);
    values.forEach((value, index) => {
      if (index) target.appendChild(Atlas.element("span", { className: "pipeline-arrow", text: "→" }));
      target.appendChild(buildNode(value));
    });
  }

  function renderSummary() {
    Atlas.clear(targets.summary);
    const model = pageData.model;
    const facts = Atlas.element("dl", { className: "model-summary-grid" });
    [
      ["Workspace", "Structured logical graph"],
      ["Model type", model.model_type],
      ["Inputs", model.input_modalities.join(", ")],
      ["Outputs", model.output_modalities.join(", ")],
      ["Graph", `${graph.label} (${graph.model_graph_id}, ${graph.version})`],
    ].forEach(([label, value]) => facts.appendChild(modelSummaryFact(label, value)));
    targets.summary.append(
      Atlas.element("h2", { text: "Model summary" }),
      facts,
    );
  }

  function modelSummaryFact(label, value) {
    const fact = Atlas.element("div", { className: "model-summary-fact" });
    fact.append(Atlas.element("dt", { text: label }), Atlas.element("dd", { text: value }));
    return fact;
  }

  function clampControlValue(item, value) {
    if (!Number.isFinite(value)) return state.overrides[item.symbol];
    const bounded = Math.min(item.maximum, Math.max(item.minimum, value));
    return Number.isInteger(item.minimum) && Number.isInteger(item.maximum) ? Math.round(bounded) : bounded;
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
      input.max = String(item.maximum);
      input.step = "1";
      input.value = String(state.overrides[item.symbol]);
      input.addEventListener("change", () => {
        const nextValue = clampControlValue(item, Number(input.value));
        state.overrides[item.symbol] = nextValue;
        input.value = String(nextValue);
        recompute();
      });
      label.append(title, input, Atlas.element("small", { text: `${item.symbol} · ${item.minimum}–${item.maximum}` }));
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

  function renderStages() {
    appendPipeline(targets.stages, state.materialized.stages, (stage) => {
      const button = nodeButton(
        "stage",
        stage.label,
        stage.stage_id === state.selection.stage,
        () => select({ stage: stage.stage_id }),
      );
      button.dataset.stageId = stage.stage_id;
      button.appendChild(repeatChip("stage", stage.stage_repeat));
      if (stage.loop_carried) {
        button.appendChild(Atlas.element("span", {
          className: "loop-carried",
          text: `↻ ${stage.loop_carried.loop_id}: updated action state returns each step`,
        }));
      }
      return button;
    });
  }

  function renderModules() {
    const stage = selectedStage();
    appendPipeline(targets.modules, stage.modules, (module) => {
      const button = nodeButton(
        "module",
        module.label,
        module.module_id === state.selection.module,
        () => select({ stage: stage.stage_id, module: module.module_id }),
      );
      button.dataset.moduleId = module.module_id;
      button.appendChild(repeatChip("block", module.module_repeat));
      if (module.effective_repeat !== module.module_repeat) {
        button.appendChild(repeatChip("effective", module.effective_repeat));
      }
      return button;
    });
  }

  function renderComponents() {
    const stage = selectedStage();
    const module = selectedModule();
    const components = module.template.components || [];
    targets.componentSection.hidden = !components.length;
    if (!components.length) {
      Atlas.clear(targets.components);
      return;
    }
    appendPipeline(targets.components, components, (component) => {
      const button = nodeButton(
        "component",
        component.label,
        component.component_id === state.selection.component,
        () => select({
          stage: stage.stage_id,
          module: module.module_id,
          component: component.component_id,
        }),
      );
      button.dataset.componentId = component.component_id;
      button.appendChild(Atlas.element("span", { className: "node-id", text: component.component_id }));
      return button;
    });
  }

  function renderOperators() {
    const stage = selectedStage();
    const module = selectedModule();
    const component = selectedComponent();
    appendPipeline(targets.operators, operatorsFor(module, component), (operator) => {
      const button = nodeButton(
        "operator",
        operator.label,
        operator.operator_id === state.selection.operator,
        () => select({
          stage: stage.stage_id,
          module: module.module_id,
          component: component ? component.component_id : null,
          operator: operator.operator_id,
        }),
      );
      button.dataset.operatorId = operator.operator_id;
      button.dataset.definitionId = operator.definition_id;
      button.append(
        Atlas.element("span", { className: "node-id", text: operator.definition_id }),
        repeatChip("effective", operator.effective_repeat),
      );
      return button;
    });
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

  function multiplicityFact(label, value) {
    const fact = Atlas.element("div", { className: "multiplicity-fact" });
    fact.append(
      Atlas.element("dt", { text: label }),
      Atlas.element("dd", { text: typeof value === "number" ? `×${Atlas.format(value, 0)}` : value }),
    );
    return fact;
  }

  function renderAnalysis(operator) {
    const section = Atlas.element("section", { className: "operator-analysis" });
    section.appendChild(Atlas.element("h3", { text: "Analytical counts" }));
    if (!operator.analysis.length) {
      section.appendChild(Atlas.element("p", { className: "empty-state", text: "No analytical count is declared for this atomic operator." }));
      return section;
    }
    const list = Atlas.element("dl", { className: "analysis-grid" });
    operator.analysis.forEach((metric) => {
      const fact = Atlas.element("div", { className: "analysis-fact" });
      const value = metric.value === null ? "unresolved" : `${Atlas.format(metric.value, 2)} ${metric.unit}`;
      fact.append(
        Atlas.element("dt", { text: metric.metric.replaceAll("_", " ") }),
        Atlas.element("dd", { text: `${value} per invocation` }),
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

  function matrixDemo(label, activeClass) {
    const wrapper = Atlas.element("div", { className: `matrix-demo ${activeClass}` });
    wrapper.appendChild(Atlas.element("strong", { text: label }));
    const grid = Atlas.element("span", { className: "matrix-grid" });
    for (let index = 0; index < 9; index += 1) {
      const cell = Atlas.element("span", { className: "matrix-cell" });
      cell.setAttribute("aria-hidden", "true");
      grid.appendChild(cell);
    }
    wrapper.appendChild(grid);
    return wrapper;
  }

  function renderGemmVisualizer(operator) {
    const dimensions = gemmDimensions(operator);
    const visualizer = Atlas.element("section", { className: "operator-visualizer gemm-visualizer" });
    visualizer.append(
      Atlas.element("h3", { text: "GEMM semantics" }),
      Atlas.element("p", { className: "visualizer-formula", text: "D = A B + C" }),
    );
    const labels = Atlas.element("div", { className: "gemm-dimensions" });
    labels.append(
      Atlas.element("span", { text: `A: ${dimensions.M ?? "?"} × ${dimensions.K ?? "?"}` }),
      Atlas.element("span", { text: `B: ${dimensions.K ?? "?"} × ${dimensions.N ?? "?"}` }),
      Atlas.element("span", { text: `D: ${dimensions.M ?? "?"} × ${dimensions.N ?? "?"}` }),
    );
    const sequence = Atlas.element("div", { className: "gemm-mac-sequence" });
    sequence.append(
      matrixDemo("A row", "matrix-a"),
      Atlas.element("span", { className: "visualizer-arrow", text: "×" }),
      matrixDemo("B column", "matrix-b"),
      Atlas.element("span", { className: "visualizer-arrow", text: "→" }),
      matrixDemo("D cell", "matrix-d"),
    );
    visualizer.append(
      labels,
      sequence,
      Atlas.element("p", {
        className: "visualizer-caption",
        text: "The highlighted A row and B column multiply element by element; their products accumulate into the highlighted D output cell.",
      }),
    );
    return visualizer;
  }

  function firstNumber(values) {
    return values.find((value) => typeof value === "number") ?? null;
  }

  function renderAttentionVisualizer(operator) {
    const bindings = operator.scope_bindings;
    const queryLength = firstNumber([bindings.SQ, bindings.S, bindings.T]);
    const keyValueLength = firstNumber([bindings.SKV, bindings.S, bindings.T]);
    const visualizer = Atlas.element("section", { className: "operator-visualizer attention-visualizer" });
    visualizer.appendChild(Atlas.element("h3", { text: "Attention semantics" }));
    const sequence = Atlas.element("div", { className: "attention-sequence" });
    ["QKᵀ", "scale / mask", "softmax", "P V"].forEach((label, index) => {
      if (index) sequence.appendChild(Atlas.element("span", { className: "visualizer-arrow", text: "→" }));
      sequence.appendChild(Atlas.element("span", { className: "attention-step", text: label }));
    });
    const dimensions = Atlas.element("dl", { className: "attention-dimensions" });
    [
      ["Query length", queryLength],
      ["Key/value length", keyValueLength],
      ["Head count", bindings.H],
      ["Head dimension", bindings.HD],
    ].forEach(([label, value]) => dimensions.appendChild(modelSummaryFact(label, value ?? "unresolved")));
    visualizer.append(sequence, dimensions);
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
      case "basic": return renderBasicVisualizer(operator);
      default: return renderBasicVisualizer(operator);
    }
  }

  function renderOperatorDetail() {
    Atlas.clear(targets.detail);
    const operator = selectedOperator();
    const stage = selectedStage();
    const module = selectedModule();
    const component = selectedComponent();
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
    const multiplicities = Atlas.element("dl", { className: "multiplicity-grid" });
    multiplicities.append(
      multiplicityFact("Stage multiplicity", stage.stage_repeat),
      multiplicityFact("Block/module multiplicity", module.module_repeat),
      multiplicityFact("Component multiplicity", component ? 1 : "direct atomic path"),
      multiplicityFact("Atomic multiplicity", operator.multiplicity),
      multiplicityFact("Effective multiplicity", operator.effective_repeat),
    );
    targets.detail.append(multiplicities, renderAnalysis(operator), renderVisualizer(operator));
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
    state.selection = normalizedSelection(selectionFromHash());
    renderWorkspace();
    syncHash();
  });
}());
