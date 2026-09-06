import { useEffect, useId, useRef, useState, type ReactNode } from "react";

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
import { effectiveCameraZoom, getCameraPanRanges, graphWheelZoomAction, updateManualCamera, type GraphViewport, type ManualCameraAction } from "../domain/focusViewport";
import { useModelText, type ModelText } from "../presentation/ModelDisplay";

const savedCameras = new Map<string, {zoom:number;x:number;y:number}>();

interface LogicalDagSvgProps {
  dag: LogicalDag;
  layout: LogicalLayout;
  connectors: ConnectorResolution;
  presentation: GraphPresentation;
  selectedRef: string;
  focusRefs?: ReadonlySet<string>;
  relatedRefs: ReadonlySet<string>;
  mode?: "overview" | "focus";
  viewport?: GraphViewport;
  onSelect: (ref: string) => void;
  ariaLabel: string;
  overlay?: ReactNode;
  underlay?: ReactNode;
  compactControls?: boolean;
  toolbar?: ReactNode;
  scenario?: ReactNode;
  cameraResetKey?: string;
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

function nodeDescription(node: LogicalNode, t: ModelText) {
  if (!node.detail) return t(node.label);
  return `${t(node.label)}. ${t(node.detail.definitionLabel)}. ${node.detail.formula}`;
}

function layoutFingerprint(layout: LogicalLayout) {
  const source = [...layout.nodeBoxes]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([ref, box]) => `${ref}@${box.x},${box.y},${box.width},${box.height}`)
    .join("|");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${layout.width}x${layout.height}:${layout.nodeBoxes.size}:${(hash >>> 0).toString(16)}`;
}

function ScopeBadge({ scope, box }: { scope: LogicalScope; box: ScopeBox }) {
  const t = useModelText();
  const label = scope.kind === "denoise" ? t("Denoise ×{count}", { count: scope.repeat }) : t(shortScopeLabel(scope.moduleId, scope.label));
  const labelWidth = [...label].reduce((width, character) => width + (/[\u3400-\u9fff]/u.test(character) ? 9.5 : 6.1), 18);
  const badgeWidth = Math.min(box.width - 16, Math.max(82, labelWidth));
  const tailLabel = scope.note ? t(scope.note.split(":", 1)[0]!) : null;
  const tailWidth = tailLabel ? 94 : 0;
  return (
    <g className={`logical-scope logical-scope--${scope.kind}`}>
      <rect className="logical-scope-badge" x={box.x + 8} y={box.y} width={badgeWidth} height={box.headerHeight} rx={7} />
      <text className="logical-scope-label" x={box.x + 17} y={box.y + 12.5}>{label}</text>
      {tailLabel && box.width - badgeWidth > tailWidth + 22 ? (
        <g className="logical-tail-badge">
          <rect x={box.x + box.width - tailWidth - 8} y={box.y} width={tailWidth} height={box.headerHeight} rx={7} />
          <text x={box.x + box.width - tailWidth / 2 - 8} y={box.y + 12.5} textAnchor="middle">{tailLabel}</text>
          <title>{scope.note?.split(": ").map((part) => t(part)).join("：")}</title>
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
  const t = useModelText();
  const visual = nodeVisual(node, presentation);
  const label = t(nodeAlias(node, presentation));
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
  focusRefs,
  relatedRefs,
  mode = selectedRef ? "focus" : "overview",
  viewport,
  onSelect,
  ariaLabel,
  overlay,
  underlay,
  compactControls = false,
  toolbar,
  scenario,
  cameraResetKey = "",
}: LogicalDagSvgProps) {
  const t = useModelText();
  const clipId = useId();
  const activeFocusRefs = focusRefs ?? new Set(selectedRef ? [selectedRef] : []);
  const selected = mode === "focus" && activeFocusRefs.size > 0;
  const activeViewport = viewport ?? { x: 0, y: 0, width: layout.width, height: layout.height, scopeId: null };
  const scale = Math.min(layout.width / activeViewport.width, layout.height / activeViewport.height);
  const frameX = (layout.width - activeViewport.width * scale) / 2;
  const frameY = (layout.height - activeViewport.height * scale) / 2;
  const cameraFrame = {
    x: frameX, y: frameY, width: activeViewport.width * scale, height: activeViewport.height * scale,
  };
  const cameraContent = {
    x: frameX - activeViewport.x * scale, y: frameY - activeViewport.y * scale,
    width: layout.width * scale, height: layout.height * scale,
  };
  const sceneTransform = `translate(${frameX} ${frameY}) scale(${scale}) translate(${-activeViewport.x} ${-activeViewport.y})`;
  const canvasRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const resetKey = `${cameraResetKey}|${[...activeFocusRefs].sort().join(",")}|${mode}`;
  const automaticCamera = { zoom: 100, x: 0, y: 0 };
  const [manualState, setManualState] = useState({ resetKey, camera: savedCameras.get(resetKey) ?? automaticCamera });
  const camera = manualState.resetKey === resetKey ? manualState.camera : automaticCamera;
  const cameraRanges = getCameraPanRanges(camera.zoom, cameraFrame, cameraContent);
  const canPan = cameraRanges.x.max - cameraRanges.x.min > 1e-6 || cameraRanges.y.max - cameraRanges.y.min > 1e-6;
  const displayedZoom = effectiveCameraZoom(camera.zoom, scale);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; resetKey: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    setManualState({ resetKey, camera: savedCameras.get(resetKey) ?? { zoom: 100, x: 0, y: 0 } });
    dragRef.current = null;
    setDragging(false);
  }, [resetKey]);
  const changeCamera = (action: ManualCameraAction) => setManualState((previous) => {
    const next = updateManualCamera(previous.resetKey === resetKey ? previous.camera : automaticCamera, action, cameraFrame, cameraContent);
    savedCameras.set(resetKey,next);
    return {resetKey,camera:next};
  });
  const framePoint = (clientX: number, clientY: number) => {
    const matrix = svgRef.current?.getScreenCTM();
    return matrix ? new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse()) : null;
  };
  useEffect(() => {
    const svg = svgRef.current;
    if (!compactControls || !svg) return;
    const wheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      const anchor = framePoint(event.clientX, event.clientY);
      if (anchor) changeCamera(graphWheelZoomAction(camera.zoom, event.deltaY, anchor));
    };
    svg.addEventListener("wheel", wheel, { passive: false });
    return () => svg.removeEventListener("wheel", wheel);
  }, [compactControls, resetKey, camera.zoom, frameX, frameY, activeViewport.x, activeViewport.y, activeViewport.width, activeViewport.height, scale, layout.width, layout.height]);
  const stepZoom = (direction: -1 | 1) => {
    const canvas = canvasRef.current;
    const bounds = canvas?.getBoundingClientRect();
    const anchor = bounds ? framePoint(
      (Math.max(0, bounds.left) + Math.min(window.innerWidth, bounds.right)) / 2,
      (Math.max(0, bounds.top) + Math.min(window.innerHeight, bounds.bottom)) / 2,
    ) : null;
    if (anchor) changeCamera({ type: "zoom", percent: camera.zoom + direction * 10, anchor });
  };
  const [panBounds, setPanBounds] = useState({ left: false, right: false });
  useEffect(() => {
    if (!compactControls || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const update = () => setPanBounds({
      left: canvas.scrollLeft > 1,
      right: canvas.scrollWidth - canvas.clientWidth - canvas.scrollLeft > 1,
    });
    const observer = new ResizeObserver(update);
    observer.observe(canvas);
    canvas.addEventListener("scroll", update);
    update();
    return () => { observer.disconnect(); canvas.removeEventListener("scroll", update); };
  }, [compactControls, layout.width, mode]);
  const pan = (direction: -1 | 1) => {
    canvasRef.current?.scrollBy({ left: direction * 320, behavior: "auto" });
  };
  return (
    <div className="logical-viewport">
      <div className="logical-viewport-controls" aria-label={compactControls ? "模型图工具栏" : "Logical graph viewport controls"}>
        {toolbar}
        {!compactControls ? <>
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
        </> : <span className="graph-direction-hint">横向并行，纵向依赖</span>}
        {!compactControls || panBounds.left || panBounds.right ? <>
        <button type="button" onClick={() => pan(-1)} disabled={compactControls && !panBounds.left} aria-label={compactControls ? "向左平移模型图" : "Pan logical graph left"}>
          {compactControls ? "←" : "← Pan left"}
        </button>
        <button type="button" onClick={() => pan(1)} disabled={compactControls && !panBounds.right} aria-label={compactControls ? "向右平移模型图" : "Pan logical graph right"}>
          {compactControls ? "→" : "Pan right →"}
        </button>
        </> : null}
      </div>
      {compactControls ? <div className="logical-scenario-strip">
        {scenario}
        <div className="logical-zoom-controls" role="group" aria-label="模型图缩放">
          <button type="button" aria-label="缩小模型图" title="缩小模型图" disabled={camera.zoom <= 50} onClick={() => stepZoom(-1)}>−</button>
          <output aria-label="模型图缩放比例" aria-live="polite">{displayedZoom}%</output>
          <button type="button" aria-label="放大模型图" title="放大模型图" disabled={camera.zoom >= 250} onClick={() => stepZoom(1)}>+</button>
          <button type="button" aria-label="适配模型图，恢复自动视图" onClick={() => changeCamera({ type: "reset" })}>适配</button>
        </div>
      </div> : scenario}
      <div
        className="logical-canvas"
        ref={canvasRef}
        role="region"
        aria-label={compactControls ? "模型结构图；在图内滚轮缩放，内容超出视图时可拖动空白处平移；图外滚轮正常滚动页面" : "Authored-scale logical graph; use the pan buttons or scroll horizontally on narrower screens"}
        tabIndex={0}
      >
      {!compactControls ? <div className="logical-legend" aria-hidden="true">
        <span><i className="legend-line" />Declared tensor flow</span>
        <span><i className="legend-line legend-line--rail" />Residual / loop rail</span>
        <em>Horizontal = parallel · vertical = dependency</em>
      </div> : null}
      <svg
        className="logical-dag"
        ref={svgRef}
        data-manual-zoom={compactControls ? camera.zoom : undefined}
        data-effective-zoom={compactControls ? displayedZoom : undefined}
        data-pannable={compactControls && canPan || undefined}
        data-dragging={dragging || undefined}
        onPointerDown={(event) => {
          if (!compactControls || !canPan || event.button !== 0
            || (event.target as Element).closest('.logical-node, [role="button"]')) return;
          const point = framePoint(event.clientX, event.clientY);
          if (!point) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { pointerId: event.pointerId, x: point.x, y: point.y, resetKey };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId || drag.resetKey !== resetKey) return;
          const point = framePoint(event.clientX, event.clientY);
          if (!point) return;
          changeCamera({ type: "pan", x: point.x - drag.x, y: point.y - drag.y });
          dragRef.current = { ...drag, x: point.x, y: point.y };
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          dragRef.current = null;
          setDragging(false);
        }}
        onLostPointerCapture={() => { dragRef.current = null; setDragging(false); }}
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
        data-layout-fingerprint={layoutFingerprint(layout)}
        data-viewport-contract="two-state-focus"
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={frameX} y={frameY} width={activeViewport.width * scale} height={activeViewport.height * scale} />
          </clipPath>
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
        <g clipPath={compactControls && selected ? `url(#${clipId})` : undefined}>
        <g className="logical-manual-camera" transform={compactControls ? `translate(${camera.x} ${camera.y}) scale(${camera.zoom / 100})` : undefined}>
        <g
          className="logical-scene"
          transform={sceneTransform}
          data-viewport-mode={mode}
          data-focus-scope={activeViewport.scopeId ?? undefined}
        >
        <rect className="logical-paper-grid" width={layout.width} height={layout.height} />

        {layout.stageBoxes.map((stage, index) => (
          <g className={`logical-stage logical-stage--${index + 1}`} key={stage.stageId}>
            <rect x={stage.x} y={stage.y} width={stage.width} height={stage.height} rx={18} />
            <text className="logical-stage-index" x={stage.x + 18} y={stage.y + 31}>
              {String(index + 1).padStart(2, "0")}
            </text>
            <text className="logical-stage-label" x={stage.x + 54} y={stage.y + 31}>
              {t(stage.label).split(/\s+/)[0]}
            </text>
            <title>{`${t(stage.label)}. ${t(stage.description)}`}</title>
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

        {underlay}
        <g className="logical-edges" aria-hidden="true">
          {connectors.connectors.flatMap((connector) =>
            connector.paths.map((path) => {
              const incident = [...activeFocusRefs].some((ref) =>
                path.sourceRefs.includes(ref) || path.targetRefs.includes(ref));
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
                activeFocusRefs.has(node.ref) ? "is-selected" : "",
                relatedRefs.has(node.ref) ? "is-related" : "",
                selected && !activeFocusRefs.has(node.ref) && !relatedRefs.has(node.ref) ? "is-muted" : "",
              ].filter(Boolean).join(" ")}
              role={interactive ? "button" : undefined}
              tabIndex={interactive ? 0 : undefined}
              aria-label={interactive ? t("Inspect {description}", { description: nodeDescription(node, t) }) : undefined}
              onClick={interactive ? () => onSelect(node.ref) : undefined}
              onKeyDown={interactive ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(node.ref);
                }
              } : undefined}
            >
              <title>{nodeDescription(node, t)}</title>
              <NodeShape node={node} box={box} presentation={presentation} />
            </g>
          );
        })}

        {overlay}

        {connectors.invalidHints.map((item, index) => (
          <text className="logical-warning" key={item.id} x={24} y={layout.height - 20 - index * 16}>
            Unresolved authored route: {item.id}
          </text>
        ))}
        </g>
        </g>
        </g>
        </svg>
      </div>
    </div>
  );
}
