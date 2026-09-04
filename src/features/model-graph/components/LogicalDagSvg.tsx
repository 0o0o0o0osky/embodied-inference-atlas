import { useRef } from "react";

import type {
  ConnectorResolution,
  GraphPresentation,
  LogicalDag,
  LogicalLayout,
  LogicalNode,
  LogicalScope,
  NodeBox,
  NodeVisualKind,
  ScopeBox,
} from "../domain/types";

interface LogicalDagSvgProps {
  dag: LogicalDag;
  layout: LogicalLayout;
  connectors: ConnectorResolution;
  presentation: GraphPresentation;
  selectedRef: string;
  relatedRefs: ReadonlySet<string>;
  onSelect: (ref: string) => void;
  ariaLabel: string;
}

function shortScopeLabel(moduleId: string | null, fallback: string) {
  if (moduleId === "vision-blocks") return fallback.replace("SigLIP transformer blocks", "SigLIP");
  if (moduleId === "prefix-blocks") return fallback.replace("Gemma prefix blocks", "Gemma");
  if (moduleId === "action-expert-blocks") return fallback.replace("Gemma action expert blocks", "Expert");
  if (moduleId === "expert-layer-pairs") return fallback.replace("Expert layer pairs", "Expert pairs");
  return fallback;
}

function nodeVisual(node: LogicalNode, presentation: GraphPresentation): NodeVisualKind {
  return presentation.visualOverrides[node.ref] ?? node.visual;
}

function nodeAlias(node: LogicalNode, presentation: GraphPresentation) {
  return presentation.aliases[node.ref] ?? node.operatorId ?? node.label;
}

function nodeDescription(node: LogicalNode) {
  if (!node.detail) return `${node.label}. ${node.definitionId.replaceAll("-", " ")}.`;
  return `${node.label}. ${node.detail.definitionLabel}. ${node.detail.formula}`;
}

function ScopeBadge({ scope, box }: { scope: LogicalScope; box: ScopeBox }) {
  const label = shortScopeLabel(scope.moduleId, scope.label);
  const badgeWidth = Math.min(box.width - 16, Math.max(82, label.length * 6.1 + 18));
  const tailLabel = scope.note?.split(":", 1)[0] ?? null;
  const tailWidth = tailLabel ? 94 : 0;
  return (
    <g className={`logical-scope logical-scope--${scope.kind}`}>
      <rect className="logical-scope-badge" x={box.x + 8} y={box.y} width={badgeWidth} height={box.headerHeight} rx={7} />
      <text className="logical-scope-label" x={box.x + 17} y={box.y + 12.5}>{label}</text>
      {tailLabel && box.width - badgeWidth > tailWidth + 22 ? (
        <g className="logical-tail-badge">
          <rect x={box.x + box.width - tailWidth - 8} y={box.y} width={tailWidth} height={box.headerHeight} rx={7} />
          <text x={box.x + box.width - tailWidth / 2 - 8} y={box.y + 12.5} textAnchor="middle">{tailLabel}</text>
          <title>{scope.note}</title>
        </g>
      ) : null}
    </g>
  );
}

function NodeShape({
  node,
  box,
  presentation,
}: {
  node: LogicalNode;
  box: NodeBox;
  presentation: GraphPresentation;
}) {
  const visual = nodeVisual(node, presentation);
  const label = nodeAlias(node, presentation);
  if (visual === "inline") {
    const symbol = node.definitionId === "residual-add" ? "+" : "×";
    return (
      <>
        <circle cx={box.width / 2} cy={box.height / 2} r={9} />
        <text x={box.width / 2} y={box.height / 2 + 4} textAnchor="middle">
          {symbol}
        </text>
      </>
    );
  }
  if (visual === "storage") {
    return (
      <>
        <ellipse cx={box.width / 2} cy={4} rx={box.width / 2} ry={4} />
        <rect x={0} y={4} width={box.width} height={18} />
        <ellipse cx={box.width / 2} cy={22} rx={box.width / 2} ry={4} />
        <text x={box.width / 2} y={14.5} textAnchor="middle">{label}</text>
      </>
    );
  }
  if (visual === "read-port") {
    const portLabel = node.ref.endsWith("extract-prefix-key") ? "Kₚ" : "Vₚ";
    return (
      <>
        <polygon points={`${box.width / 2},0 ${box.width},${box.height / 2} ${box.width / 2},${box.height} 0,${box.height / 2}`} />
        <text x={box.width / 2 - 1} y={box.height / 2 + 4} textAnchor="middle">{portLabel}</text>
      </>
    );
  }
  if (visual === "logical-view") {
    const labels = node.ref.endsWith("key-concat") ? ["Kₚ", "Kₛ"] : ["Vₚ", "Vₛ"];
    return (
      <>
        <rect width={box.width} height={box.height} rx={7} />
        <line className="logical-view-divider" x1={box.width / 2} y1={2} x2={box.width / 2} y2={box.height - 2} />
        <text x={box.width / 4} y={box.height / 2 + 4} textAnchor="middle">{labels[0]}</text>
        <text x={box.width * 0.75} y={box.height / 2 + 4} textAnchor="middle">{labels[1]}</text>
      </>
    );
  }
  const pill = visual === "line-op" || visual === "control";
  return (
    <>
      <rect
        width={box.width}
        height={box.height}
        rx={pill ? box.height / 2 : node.kind === "operator" ? 7 : 16}
      />
      <text x={box.width / 2} y={box.height / 2 + 4} textAnchor="middle">{label}</text>
    </>
  );
}

export function LogicalDagSvg({
  dag,
  layout,
  connectors,
  presentation,
  selectedRef,
  relatedRefs,
  onSelect,
  ariaLabel,
}: LogicalDagSvgProps) {
  const selected = Boolean(selectedRef);
  const canvasRef = useRef<HTMLDivElement>(null);
  const pan = (direction: -1 | 1) => {
    canvasRef.current?.scrollBy({ left: direction * 320, behavior: "auto" });
  };
  return (
    <div className="logical-viewport">
      <div className="logical-viewport-controls" aria-label="Logical graph viewport controls">
        <span className="logical-viewport-note">{layout.width}-unit authored layout · pan to inspect at full scale</span>
        <span
          className="logical-edge-coverage"
          title="Folded repeat edges connect one represented block to the next; each named ×N boundary stands in for those paths."
        >
          {connectors.coverage.truthEdgeCount} truth edges: {connectors.coverage.routedEdgeIds.length} routed
          {" · "}{connectors.coverage.foldedEdges.length} folded by ×N boundaries
          {connectors.coverage.uncoveredEdgeIds.length
            ? ` · ${connectors.coverage.uncoveredEdgeIds.length} uncovered`
            : ""}
        </span>
        <button type="button" onClick={() => pan(-1)} aria-label="Pan logical graph left">
          ← Pan left
        </button>
        <button type="button" onClick={() => pan(1)} aria-label="Pan logical graph right">
          Pan right →
        </button>
      </div>
      <div
        className="logical-canvas"
        ref={canvasRef}
        role="region"
        aria-label="Authored-scale logical graph; use the pan buttons or scroll horizontally on narrower screens"
        tabIndex={0}
      >
      <div className="logical-legend" aria-hidden="true">
        <span><i className="legend-line" />Declared tensor flow</span>
        <span><i className="legend-line legend-line--rail" />Residual / loop rail</span>
        <em>Horizontal = parallel · vertical = dependency</em>
      </div>
      <svg
        className="logical-dag"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        style={{ minWidth: `${layout.width}px` }}
        role="img"
        aria-label={ariaLabel}
        data-truth-edge-count={dag.edges.length}
        data-connector-count={connectors.connectors.length}
        data-invalid-connector-count={connectors.invalidHints.length}
        data-routed-truth-edge-count={connectors.coverage.routedEdgeIds.length}
        data-folded-truth-edge-count={connectors.coverage.foldedEdges.length}
        data-uncovered-truth-edge-count={connectors.coverage.uncoveredEdgeIds.length}
      >
        <defs>
          <marker
            id="logical-arrow"
            markerWidth="7"
            markerHeight="7"
            refX="6.2"
            refY="3.5"
            orient="auto"
            markerUnits="userSpaceOnUse"
            overflow="visible"
          >
            <path className="logical-arrow-halo" d="M 0 0 L 7 3.5 L 0 7" />
            <path className="logical-arrow-head" d="M 0 0 L 7 3.5 L 0 7" />
          </marker>
          <pattern id="paper-grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M 24 0 L 0 0 0 24" />
          </pattern>
        </defs>
        <rect className="logical-paper-grid" width={layout.width} height={layout.height} />

        {layout.stageBoxes.map((stage, index) => (
          <g className={`logical-stage logical-stage--${index + 1}`} key={stage.stageId}>
            <rect x={stage.x} y={stage.y} width={stage.width} height={stage.height} rx={18} />
            <text className="logical-stage-index" x={stage.x + 18} y={stage.y + 31}>
              {String(index + 1).padStart(2, "0")}
            </text>
            <text className="logical-stage-label" x={stage.x + 54} y={stage.y + 31}>
              {stage.label.split(/\s+/)[0]}
            </text>
            <title>{stage.label}. {stage.description}</title>
          </g>
        ))}

        {layout.scopeBoxes.map((box) => {
          const scope = dag.scopes.find((item) => item.id === box.scopeId);
          if (!scope) return null;
          return (
            <g className={`logical-scope logical-scope--${scope.kind}`} key={scope.id}>
              <rect className="logical-scope-frame" x={box.x} y={box.y} width={box.width} height={box.height} rx={14} />
            </g>
          );
        })}

        <g className="logical-edges" aria-hidden="true">
          {connectors.connectors.flatMap((connector) =>
            connector.paths.map((path) => {
              const incident =
                path.sourceRefs.includes(selectedRef) || path.targetRefs.includes(selectedRef);
              return (
                <path
                  key={path.id}
                  d={path.path}
                  markerEnd={path.arrow ? "url(#logical-arrow)" : undefined}
                  className={[
                    "logical-edge",
                    `logical-edge--${connector.kind}`,
                    path.shared ? "is-shared" : "",
                    selected && incident ? "is-incident" : "",
                    selected && !incident ? "is-muted" : "",
                  ].filter(Boolean).join(" ")}
                />
              );
            }),
          )}
        </g>

        {layout.scopeBoxes.map((box) => {
          const scope = dag.scopes.find((item) => item.id === box.scopeId);
          return scope ? <ScopeBadge key={scope.id} scope={scope} box={box} /> : null;
        })}

        {[...dag.nodes.values()].map((node) => {
          const box = layout.nodeBoxes.get(node.ref);
          if (!box) return null;
          const interactive = node.kind === "operator";
          return (
            <g
              key={node.ref}
              data-node-ref={node.ref}
              transform={`translate(${box.x} ${box.y})`}
              className={[
                "logical-node",
                `logical-node--${node.kind}`,
                `logical-node--${nodeVisual(node, presentation)}`,
                node.ref === selectedRef ? "is-selected" : "",
                relatedRefs.has(node.ref) ? "is-related" : "",
                selected && node.ref !== selectedRef && !relatedRefs.has(node.ref) ? "is-muted" : "",
              ].filter(Boolean).join(" ")}
              role={interactive ? "button" : undefined}
              tabIndex={interactive ? 0 : undefined}
              aria-label={interactive ? `Inspect ${nodeDescription(node)}` : undefined}
              onClick={interactive ? () => onSelect(node.ref) : undefined}
              onKeyDown={interactive ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(node.ref);
                }
              } : undefined}
            >
              <title>{nodeDescription(node)}</title>
              <NodeShape node={node} box={box} presentation={presentation} />
            </g>
          );
        })}

        {connectors.invalidHints.map((item, index) => (
          <text className="logical-warning" key={item.id} x={24} y={layout.height - 20 - index * 16}>
            Unresolved authored route: {item.id}
          </text>
        ))}
        </svg>
      </div>
    </div>
  );
}
