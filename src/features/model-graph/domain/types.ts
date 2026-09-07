export type LogicalRef = string;

export type Expr =
  | number
  | { symbol: string }
  | { op: "add" | "sub" | "mul" | "div" | "ceil_div"; args: Expr[] };

export type LogicalNodeKind = "input" | "output" | "operator" | "loop" | "control";

export type NodeVisualKind =
  | "box"
  | "inline"
  | "line-op"
  | "storage"
  | "read-port"
  | "logical-view"
  | "control";

export interface TensorAxis {
  axis: string;
  expression: Expr;
}

export interface MaterializedTensor {
  tensorId: string;
  label: string;
  semanticRole: string;
  axes: readonly TensorAxis[];
  shape: readonly (number | null)[];
  unresolvedSymbols: readonly string[];
}

export interface MaterializedPort {
  port: string;
  tensor: MaterializedTensor | null;
}

export interface MaterializedMetric {
  metric: string;
  unit: string;
  scope: string;
  value: number | null;
}

export interface SliceDeclaration {
  axis: Expr;
  start: Expr;
  stop: Expr;
  step: Expr;
  drop_axis: boolean;
  output_symbol: string;
  explanation: string;
  identity_explanation?: string;
}

export interface OperatorDetail {
  slice?: SliceDeclaration | undefined;
  ref: LogicalRef;
  operatorId: string;
  label: string;
  definitionId: string;
  definitionLabel: string;
  category: string;
  formula: string;
  visualizer: string;
  bindings: Readonly<Record<string, number | null>>;
  scopeBindings: Readonly<Record<string, number | null>>;
  inputs: readonly MaterializedPort[];
  outputs: readonly MaterializedPort[];
  analysis: readonly MaterializedMetric[];
  intrinsicRepeat: number | null;
  moduleRepeat: number | null;
  tailRepeat: number;
  stageRepeat: number | null;
  effectiveRepeat: number | null;
  unresolvedSymbols: readonly string[];
}

export interface LogicalNode {
  ref: LogicalRef;
  kind: LogicalNodeKind;
  stageId: string;
  moduleId: string | null;
  componentId: string | null;
  operatorId: string | null;
  definitionId: string;
  label: string;
  visual: NodeVisualKind;
  detail: OperatorDetail | null;
}

export interface LogicalEdge {
  id: string;
  tensorId: string;
  tensorLabel: string;
  source: LogicalRef;
  target: LogicalRef;
  kind: "tensor" | "repeat" | "feedback";
}

export interface LogicalScope {
  id: string;
  kind: "component" | "module" | "transformer" | "denoise" | "tail";
  label: string;
  stageId: string;
  moduleId: string | null;
  nodeRefs: readonly LogicalRef[];
  repeat: number;
  note?: string;
}

export interface LogicalStage {
  id: string;
  label: string;
  description: string;
}

export interface LogicalDag {
  nodes: ReadonlyMap<LogicalRef, LogicalNode>;
  edges: readonly LogicalEdge[];
  scopes: readonly LogicalScope[];
  stages: readonly LogicalStage[];
  stageOrder: readonly string[];
  diagnostics: readonly string[];
}

export interface RowSpec {
  slots: readonly (LogicalRef | readonly LogicalRef[] | null)[];
  /** Fractional region of the stage content used by this row. */
  region?: readonly [number, number];
  slotWeights?: readonly number[];
  label?: string;
  gapBefore?: boolean;
  /** Center-to-center distance to the next row; defaults to the shared row step. */
  stepAfter?: number;
  offsetY?: number;
  centerBetween?: readonly LogicalRef[];
  alignTo?: LogicalRef;
}

export interface BoundaryLaneSpec {
  slotCount: number;
  lanes: Readonly<Record<LogicalRef, number>>;
  region?: readonly [number, number];
}

export interface StageBoundarySpec {
  input?: BoundaryLaneSpec;
  loop?: BoundaryLaneSpec;
  output?: BoundaryLaneSpec;
}

export interface ConnectorHint {
  id: string;
  kind:
    | "chain"
    | "branch-in"
    | "branch-out"
    | "residual"
    | "cache"
    | "cross"
    | "rail"
    | "feedback";
  pairs: readonly (readonly [LogicalRef, LogicalRef])[];
  route?: "top-bus" | "right-to-top" | "gutter";
  /** Cross-column routes enter beside the consumer, using separate gutter/bus offsets. */
  sourceSide?: "right" | "bottom";
  targetSide?: "top" | "left" | "right";
  busOffset?: number;
  side?: "left" | "right";
  railInset?: number;
  railOffset?: number;
  sourceOffset?: number;
  targetOffset?: number;
}

export interface GraphPresentation {
  /** Ordered canonical stages sharing one visual column; omitted stages keep their own column. */
  stageColumns?: readonly (readonly string[])[];
  avoidNodeObstacles?: boolean;
  rowsByStage: Readonly<Record<string, readonly RowSpec[]>>;
  boundaryLanes: Readonly<Record<string, StageBoundarySpec>>;
  aliases: Readonly<Record<LogicalRef, string>>;
  visualOverrides: Readonly<Record<LogicalRef, NodeVisualKind>>;
  connectorHints: readonly ConnectorHint[];
}

export interface NodeBox {
  x: number;
  y: number;
  width: number;
  height: number;
  compact: boolean;
  inline: boolean;
  row: string | number;
  lane: number;
  chain?: number;
}

export interface StageBox {
  stageId: string;
  stageIds?: readonly string[];
  label: string;
  description: string;
  x: number;
  y: number;
  width: number;
  height: number;
  contentX: number;
  contentWidth: number;
  effectiveRows: number;
}

export interface ScopeBox {
  scopeId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  headerHeight: number;
  contentTop: number;
  headerBottom: number;
}

export interface LogicalLayout {
  width: number;
  height: number;
  nodeBoxes: ReadonlyMap<LogicalRef, NodeBox>;
  stageBoxes: readonly StageBox[];
  scopeBoxes: readonly ScopeBox[];
  rowLabels?: readonly { ref: LogicalRef; label: string; x: number; y: number; width: number }[];
  diagnostics: readonly string[];
}

export interface RoutedPath {
  id: string;
  path: string;
  arrow: boolean;
  sourceRefs: readonly LogicalRef[];
  targetRefs: readonly LogicalRef[];
  shared: boolean;
}

export interface RoutedConnector {
  id: string;
  kind: ConnectorHint["kind"];
  sourceRefs: readonly LogicalRef[];
  targetRefs: readonly LogicalRef[];
  paths: readonly RoutedPath[];
}

export interface ConnectorResolution {
  connectors: readonly RoutedConnector[];
  invalidHints: readonly { id: string; missingPairs: readonly (readonly [LogicalRef, LogicalRef])[] }[];
  coverage: {
    truthEdgeCount: number;
    routedEdgeIds: readonly string[];
    foldedEdges: readonly {
      edgeId: string;
      scopeId: string;
      reason: "folded-repeat-boundary";
    }[];
    uncoveredEdgeIds: readonly string[];
  };
}

export interface MaterializedGraph {
  graphId: string;
  modelId: string;
  label: string;
  version: string;
  bindings: Readonly<Record<string, number | null>>;
  editableSymbols: readonly EditableSymbol[];
  derivedSymbols: readonly DerivedSymbol[];
  stages: readonly MaterializedStage[];
  graphTensors: readonly MaterializedGraphTensor[];
  operatorsByRef: ReadonlyMap<LogicalRef, OperatorDetail>;
  diagnostics: readonly string[];
}

export interface EditableSymbol {
  symbol: string;
  label: string;
  semantic: string;
  defaultValue: number;
  minimum: number;
  maximum: number | null;
}

export interface DerivedSymbol {
  symbol: string;
  label: string;
  expression: Expr;
  value: number | null;
}

export interface MaterializedStage {
  stageId: string;
  label: string;
  description: string;
  stageRepeat: number | null;
  loop: MaterializedLoop | null;
  modules: readonly MaterializedModule[];
}

export interface MaterializedLoop {
  loopId: string;
  controls: readonly { tensorId: string; port: string; formula: string }[];
}

export interface MaterializedModule {
  moduleId: string;
  label: string;
  templateId: string;
  moduleRepeat: number | null;
  effectiveRepeat: number | null;
  repeatCarried: { inputPort: string; outputPort: string } | null;
  requiredOutputTail: MaterializedRequiredOutputTail | null;
  inputs: readonly { port: string; tensorId: string }[];
  outputs: readonly { port: string; tensorId: string }[];
  template: MaterializedTemplate;
}

export interface MaterializedRequiredOutputTail {
  label: string;
  description: string;
  repeat: number;
  operatorRefs: readonly string[];
}

export interface MaterializedTemplate {
  templateId: string;
  label: string;
  tensors: readonly MaterializedTemplateTensor[];
  inputPorts: readonly { port: string; tensorId: string }[];
  outputPorts: readonly { port: string; tensorId: string }[];
  operators: readonly OperatorDetail[];
  components: readonly MaterializedComponent[];
}

export interface MaterializedComponent {
  componentId: string;
  label: string;
  inputs: readonly { port: string; tensorId: string }[];
  outputs: readonly { port: string; tensorId: string }[];
  template: MaterializedTemplate;
}

export interface Endpoint {
  nodeKind: "operator" | "component" | "module" | "loop";
  nodeId: string;
  port: string;
}

export interface MaterializedTemplateTensor extends MaterializedTensor {
  producer: Endpoint | null;
  consumers: readonly Endpoint[];
}

export interface MaterializedGraphTensor extends MaterializedTemplateTensor {}
