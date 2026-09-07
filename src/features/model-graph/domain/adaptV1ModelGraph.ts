import type { CanonicalRecord } from "../../../types/atlas";
import {
  evaluateExpression,
  expressionSymbols,
  nonNegativeInteger,
} from "./expression";
import type {
  EditableSymbol,
  Endpoint,
  Expr,
  MaterializedComponent,
  MaterializedGraph,
  MaterializedGraphTensor,
  MaterializedModule,
  MaterializedPort,
  MaterializedRequiredOutputTail,
  MaterializedStage,
  MaterializedTemplate,
  MaterializedTemplateTensor,
  OperatorDetail,
  SliceDeclaration,
} from "./types";

interface RawSymbol {
  symbol: string;
  label: string;
  semantic: string;
  editable: boolean;
  default: number | null;
  minimum: number | null;
  maximum: number | null;
  expression: Expr | null;
}

interface RawBinding {
  symbol: string;
  expression: Expr;
}

interface RawPort {
  port: string;
  tensor_id: string;
}

interface RawEndpoint {
  node_kind: "operator" | "component" | "module" | "loop";
  node_id: string;
  port: string;
}

interface RawTensor {
  tensor_id: string;
  label: string;
  semantic_role: string;
  axes: Array<{ axis: string; expression: Expr }>;
  producer: RawEndpoint | null;
  consumers: RawEndpoint[];
}

interface RawDefinition {
  definition_id: string;
  label: string;
  category: string;
  formula_display: string;
  visualizer: string;
  parameters: string[];
  input_ports: string[];
  output_ports: string[];
  analysis: Array<{ metric: string; unit: string; scope: string; expression: Expr }>;
}

interface RawOperator {
  slice?: SliceDeclaration;
  operator_id: string;
  label: string;
  definition_id: string;
  multiplicity: Expr;
  inputs: RawPort[];
  outputs: RawPort[];
  bindings: RawBinding[];
}

interface RawAtomicTemplate {
  template_id: string;
  label: string;
  parameters: string[];
  input_ports: RawPort[];
  output_ports: RawPort[];
  tensors: RawTensor[];
  operators: RawOperator[];
}

interface RawComponent {
  component_id: string;
  label: string;
  template_id: string;
  bindings: RawBinding[];
  inputs: RawPort[];
  outputs: RawPort[];
}

interface RawBlockTemplate extends RawAtomicTemplate {
  components: RawComponent[];
}

interface RawRequiredOutputTail {
  label: string;
  description: string;
  repeat: Expr;
  operator_refs: string[];
}

interface RawModule {
  module_id: string;
  label: string;
  template_id: string;
  repeat: Expr;
  bindings: RawBinding[];
  inputs: RawPort[];
  outputs: RawPort[];
  indexed_inputs: unknown[];
  repeat_carried?: { input_port: string; output_port: string } | null;
  required_output_tail?: RawRequiredOutputTail | null;
}

interface RawStage {
  stage_id: string;
  label: string;
  description: string;
  repeat: Expr;
  loop_carried: {
    loop_id: string;
    iteration_controls?: Array<{
      tensor_id: string;
      port: string;
      formula_display: string;
    }>;
  } | null;
  modules: RawModule[];
}

interface RawRecord {
  model_graph_id: string;
  model_id: string;
  label: string;
  version: string;
  shape_symbols: RawSymbol[];
  operator_definitions: RawDefinition[];
  component_templates: RawAtomicTemplate[];
  block_templates: RawBlockTemplate[];
  graph_tensors: RawTensor[];
  stages: RawStage[];
}

type Bindings = Record<string, number | null>;

export function isV1ModelGraphRecord(
  record: CanonicalRecord,
  modelId?: string,
): boolean {
  return (
    typeof record.model_graph_id === "string" &&
    typeof record.model_id === "string" &&
    (modelId === undefined || record.model_id === modelId) &&
    Array.isArray(record.shape_symbols) &&
    Array.isArray(record.operator_definitions) &&
    Array.isArray(record.block_templates) &&
    Array.isArray(record.stages)
  );
}

function endpoint(raw: RawEndpoint): Endpoint {
  return { nodeKind: raw.node_kind, nodeId: raw.node_id, port: raw.port };
}

function resolveSymbols(
  symbols: readonly RawSymbol[],
  overrides: Readonly<Record<string, number>>,
  diagnostics: string[],
): Bindings {
  const entries = new Map(symbols.map((item) => [item.symbol, item]));
  const resolved: Bindings = {};
  const resolving = new Set<string>();

  const resolve = (symbol: string): number | null => {
    if (Object.hasOwn(resolved, symbol)) return resolved[symbol] ?? null;
    const item = entries.get(symbol);
    if (!item || resolving.has(symbol)) {
      diagnostics.push(`Unresolved or cyclic symbol: ${symbol}`);
      resolved[symbol] = null;
      return null;
    }
    resolving.add(symbol);
    try {
      if (item.expression !== null) {
        const environment = Object.fromEntries(
          expressionSymbols(item.expression).map((name) => [name, resolve(name)]),
        );
        const value = nonNegativeInteger(
          evaluateExpression(item.expression, environment),
          `symbol ${symbol}`,
        );
        resolved[symbol] = value;
        return value;
      }
      const candidate = Object.hasOwn(overrides, symbol) ? overrides[symbol] : item.default;
      const value = nonNegativeInteger(candidate, `symbol ${symbol}`);
      const minimum = item.minimum ?? 0;
      if (value < minimum || (item.maximum !== null && value > item.maximum)) {
        throw new Error(`symbol ${symbol} is outside its declared contract`);
      }
      resolved[symbol] = value;
      return value;
    } catch (error) {
      diagnostics.push(error instanceof Error ? error.message : String(error));
      resolved[symbol] = null;
      return null;
    } finally {
      resolving.delete(symbol);
    }
  };

  symbols.forEach((item) => resolve(item.symbol));
  return resolved;
}

function safeCount(
  expression: Expr,
  bindings: Readonly<Bindings>,
  label: string,
  diagnostics: string[],
): number | null {
  try {
    return nonNegativeInteger(evaluateExpression(expression, bindings), label);
  } catch (error) {
    diagnostics.push(error instanceof Error ? error.message : String(error));
    return null;
  }
}

function evaluateBindings(
  raw: readonly RawBinding[],
  parameters: readonly string[],
  environment: Readonly<Bindings>,
  diagnostics: string[],
): Bindings {
  const byName = new Map(raw.map((binding) => [binding.symbol, binding.expression]));
  return Object.fromEntries(
    parameters.map((parameter) => {
      const expression = byName.get(parameter);
      return [
        parameter,
        expression === undefined
          ? null
          : safeCount(expression, environment, `binding ${parameter}`, diagnostics),
      ];
    }),
  );
}

function materializeTensors(
  tensors: readonly RawTensor[],
  environment: Readonly<Bindings>,
  diagnostics: string[],
): MaterializedTemplateTensor[] {
  return tensors.map((tensor) => {
    const unresolved = new Set<string>();
    const shape = tensor.axes.map((axis) => {
      try {
        return nonNegativeInteger(
          evaluateExpression(axis.expression, environment),
          `${tensor.tensor_id}.${axis.axis}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        diagnostics.push(message);
        expressionSymbols(axis.expression).forEach((symbol) => {
          if (environment[symbol] === null || environment[symbol] === undefined) unresolved.add(symbol);
        });
        return null;
      }
    });
    return {
      tensorId: tensor.tensor_id,
      label: tensor.label,
      semanticRole: tensor.semantic_role,
      axes: tensor.axes,
      shape,
      unresolvedSymbols: [...unresolved],
      producer: tensor.producer ? endpoint(tensor.producer) : null,
      consumers: tensor.consumers.map(endpoint),
    };
  });
}

function materializePorts(
  ports: readonly RawPort[],
  tensors: ReadonlyMap<string, MaterializedTemplateTensor>,
): MaterializedPort[] {
  return ports.map((port) => ({
    port: port.port,
    tensor: tensors.get(port.tensor_id) ?? null,
  }));
}

function portBindings(ports: readonly RawPort[]) {
  return ports.map((port) => ({ port: port.port, tensorId: port.tensor_id }));
}

function materializeAtomicTemplate(
  template: RawAtomicTemplate,
  environment: Readonly<Bindings>,
  stageRepeat: number | null,
  moduleRepeat: number | null,
  tail: MaterializedRequiredOutputTail | null,
  componentId: string | null,
  keyPrefix: string,
  definitions: ReadonlyMap<string, RawDefinition>,
  operatorsByRef: Map<string, OperatorDetail>,
  diagnostics: string[],
): MaterializedTemplate {
  const tensors = materializeTensors(template.tensors, environment, diagnostics);
  const tensorsById = new Map(tensors.map((tensor) => [tensor.tensorId, tensor]));
  const operators = template.operators.map((operator) => {
    const definition = definitions.get(operator.definition_id);
    if (!definition) throw new Error(`Unknown operator definition: ${operator.definition_id}`);
    const ref = `${keyPrefix}/${operator.operator_id}`;
    const relativeRef = componentId ? `${componentId}/${operator.operator_id}` : operator.operator_id;
    const tailRepeat = tail?.operatorRefs.includes(relativeRef) ? tail.repeat : 0;
    const intrinsicRepeat = safeCount(
      operator.multiplicity,
      environment,
      `${ref} multiplicity`,
      diagnostics,
    );
    const bindings = evaluateBindings(
      operator.bindings,
      definition.parameters,
      environment,
      diagnostics,
    );
    const analysis = definition.analysis.map((metric) => ({
      metric: metric.metric,
      unit: metric.unit,
      scope: metric.scope,
      value: safeCount(metric.expression, bindings, `${ref}.${metric.metric}`, diagnostics),
    }));
    const repeatedLayers = moduleRepeat === null ? null : moduleRepeat + tailRepeat;
    const effectiveRepeat =
      stageRepeat === null || repeatedLayers === null || intrinsicRepeat === null
        ? null
        : stageRepeat * repeatedLayers * intrinsicRepeat;
    const detail: OperatorDetail = {
      ref,
      operatorId: operator.operator_id,
      label: operator.label,
      definitionId: operator.definition_id,
      definitionLabel: definition.label,
      category: definition.category,
      formula: definition.formula_display,
      visualizer: definition.visualizer,
      bindings,
      scopeBindings: environment,
      ...(operator.slice ? {slice: operator.slice} : {}),
      inputs: materializePorts(operator.inputs, tensorsById),
      outputs: materializePorts(operator.outputs, tensorsById),
      analysis,
      intrinsicRepeat,
      moduleRepeat,
      tailRepeat,
      stageRepeat,
      effectiveRepeat,
      unresolvedSymbols: [
        ...new Set(
          [...Object.entries(bindings), ...Object.entries(environment)]
            .filter(([, value]) => value === null)
            .map(([symbol]) => symbol),
        ),
      ],
    };
    operatorsByRef.set(ref, detail);
    return detail;
  });
  return {
    templateId: template.template_id,
    label: template.label,
    tensors,
    inputPorts: portBindings(template.input_ports),
    outputPorts: portBindings(template.output_ports),
    operators,
    components: [],
  };
}

export function adaptV1ModelGraph(
  record: CanonicalRecord,
  overrides: Readonly<Record<string, number>> = {},
): MaterializedGraph {
  if (!isV1ModelGraphRecord(record)) {
    throw new Error("The selected record is not a V1 logical model graph");
  }
  const raw = record as unknown as RawRecord;
  const diagnostics: string[] = [];
  const bindings = resolveSymbols(raw.shape_symbols, overrides, diagnostics);
  const definitions = new Map(
    raw.operator_definitions.map((definition) => [definition.definition_id, definition]),
  );
  const blockTemplates = new Map(
    raw.block_templates.map((template) => [template.template_id, template]),
  );
  const componentTemplates = new Map(
    raw.component_templates.map((template) => [template.template_id, template]),
  );
  const operatorsByRef = new Map<string, OperatorDetail>();
  const graphTensors = materializeTensors(
    raw.graph_tensors,
    bindings,
    diagnostics,
  ) as MaterializedGraphTensor[];
  const stages: MaterializedStage[] = raw.stages.map((stage) => {
    const stageRepeat = safeCount(
      stage.repeat,
      bindings,
      `${stage.stage_id} repeat`,
      diagnostics,
    );
    const modules: MaterializedModule[] = stage.modules.map((module) => {
      const template = blockTemplates.get(module.template_id);
      if (!template) throw new Error(`Unknown block template: ${module.template_id}`);
      const moduleRepeat = safeCount(
        module.repeat,
        bindings,
        `${module.module_id} repeat`,
        diagnostics,
      );
      const moduleBindings = evaluateBindings(
        module.bindings,
        template.parameters,
        bindings,
        diagnostics,
      );
      const rawTail = module.required_output_tail ?? null;
      const requiredOutputTail: MaterializedRequiredOutputTail | null = rawTail
        ? {
            label: rawTail.label,
            description: rawTail.description,
            repeat:
              safeCount(rawTail.repeat, bindings, `${module.module_id} tail repeat`, diagnostics) ?? 0,
            operatorRefs: rawTail.operator_refs,
          }
        : null;
      const keyPrefix = `${stage.stage_id}/${module.module_id}`;
      let materializedTemplate: MaterializedTemplate;
      if (template.operators.length) {
        materializedTemplate = materializeAtomicTemplate(
          template,
          moduleBindings,
          stageRepeat,
          moduleRepeat,
          requiredOutputTail,
          null,
          keyPrefix,
          definitions,
          operatorsByRef,
          diagnostics,
        );
      } else {
        const tensors = materializeTensors(template.tensors, moduleBindings, diagnostics);
        const components: MaterializedComponent[] = template.components.map((component) => {
          const componentTemplate = componentTemplates.get(component.template_id);
          if (!componentTemplate) {
            throw new Error(`Unknown component template: ${component.template_id}`);
          }
          const componentBindings = evaluateBindings(
            component.bindings,
            componentTemplate.parameters,
            moduleBindings,
            diagnostics,
          );
          return {
            componentId: component.component_id,
            label: component.label,
            inputs: portBindings(component.inputs),
            outputs: portBindings(component.outputs),
            template: materializeAtomicTemplate(
              componentTemplate,
              componentBindings,
              stageRepeat,
              moduleRepeat,
              requiredOutputTail,
              component.component_id,
              `${keyPrefix}/${component.component_id}`,
              definitions,
              operatorsByRef,
              diagnostics,
            ),
          };
        });
        materializedTemplate = {
          templateId: template.template_id,
          label: template.label,
          tensors,
          inputPorts: portBindings(template.input_ports),
          outputPorts: portBindings(template.output_ports),
          operators: [],
          components,
        };
      }
      return {
        moduleId: module.module_id,
        label: module.label,
        templateId: module.template_id,
        moduleRepeat,
        effectiveRepeat:
          stageRepeat === null || moduleRepeat === null ? null : stageRepeat * moduleRepeat,
        repeatCarried: module.repeat_carried
          ? {
              inputPort: module.repeat_carried.input_port,
              outputPort: module.repeat_carried.output_port,
            }
          : null,
        requiredOutputTail,
        inputs: portBindings(module.inputs),
        outputs: portBindings(module.outputs),
        template: materializedTemplate,
      };
    });
    return {
      stageId: stage.stage_id,
      label: stage.label,
      description: stage.description,
      stageRepeat,
      loop: stage.loop_carried
        ? {
            loopId: stage.loop_carried.loop_id,
            controls: (stage.loop_carried.iteration_controls ?? []).map((control) => ({
              tensorId: control.tensor_id,
              port: control.port,
              formula: control.formula_display,
            })),
          }
        : null,
      modules,
    };
  });

  const editableSymbols: EditableSymbol[] = raw.shape_symbols
    .filter(
      (symbol): symbol is RawSymbol & { default: number; minimum: number } =>
        symbol.editable && symbol.expression === null && symbol.default !== null && symbol.minimum !== null,
    )
    .map((symbol) => ({
      symbol: symbol.symbol,
      label: symbol.label,
      semantic: symbol.semantic,
      defaultValue: symbol.default,
      minimum: symbol.minimum,
      maximum: symbol.maximum,
    }));

  return {
    graphId: raw.model_graph_id,
    modelId: raw.model_id,
    label: raw.label,
    version: raw.version,
    bindings,
    editableSymbols,
    derivedSymbols: raw.shape_symbols
      .filter((symbol): symbol is RawSymbol & { expression: Expr } => symbol.expression !== null)
      .map((symbol) => ({
        symbol: symbol.symbol,
        label: symbol.label,
        expression: symbol.expression,
        value: bindings[symbol.symbol] ?? null,
      })),
    stages,
    graphTensors,
    operatorsByRef,
    diagnostics: [...new Set(diagnostics)],
  };
}
