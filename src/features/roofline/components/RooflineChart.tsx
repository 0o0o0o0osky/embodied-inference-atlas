import { useEffect, useId, useMemo, useRef, useState } from "react";

import type { CrossViewEntityKey } from "../../workbench/entityKeys";
import { theoryPointLabel } from "./TheoryPointSummary";
import {
  chartGeometry,
  localVoronoiCell,
  logX,
  logY,
  markerRadius,
  placeClusterCounts,
  roofPath,
  svgPolygonPath,
} from "../presentation/chartGeometry";
import {
  formatNumber,
  humanize,
  type RooflineCurveVM,
  type RooflinePointVM,
} from "../presentation/viewModel";

export interface RooflineRevealPolicy {
  key: string;
  durationMs: 400;
}

export interface UnplottedSelection {
  label: string;
  plotBlockers: readonly string[];
  otherEvidence: readonly string[];
}

interface PointCluster {
  key: string;
  xFlopPerByte: number;
  yFlopPerSecond: number;
  points: readonly RooflinePointVM[];
}

type ClusterMarker = RooflinePointVM["marker"] | "mixed";

interface PositionedCluster extends PointCluster {
  screenX: number;
  screenY: number;
  marker: ClusterMarker;
}

const STAGE_ORDER = ["Model total", "Vision Encoder", "Prefix Encoder", "Action Flow Decoder"];

function throughput(value: number) {
  return value >= 1e12 ? `${formatNumber(value / 1e12)}T` : value >= 1e9 ? `${formatNumber(value / 1e9)}G` : formatNumber(value);
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(760);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => setWidth(Math.max(520, Math.round(node.getBoundingClientRect().width)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function clusterPoints(points: readonly RooflinePointVM[]): PointCluster[] {
  const groups = new Map<string, RooflinePointVM[]>();
  points.forEach((point) => {
    const key = `${point.xFlopPerByte}:${point.yFlopPerSecond}`;
    groups.set(key, [...(groups.get(key) ?? []), point]);
  });
  return [...groups].map(([key, members]) => ({
    key,
    xFlopPerByte: members[0]!.xFlopPerByte,
    yFlopPerSecond: members[0]!.yFlopPerSecond,
    points: members,
  }));
}

function clusterMarker(points: readonly RooflinePointVM[]): ClusterMarker {
  const markers = new Set(points.map((point) => point.marker));
  return markers.size === 1 ? points[0]!.marker : "mixed";
}

function markerEvidence(marker: ClusterMarker) {
  if (marker === "hollow") return "analytical time and modeled traffic";
  if (marker === "half") return "observed time and modeled traffic";
  if (marker === "filled") return "observed time and measured traffic";
  return "mixed evidence markers; inspect the member roster";
}

function nearestCenterDistance(clusters: readonly PositionedCluster[], index: number) {
  const current = clusters[index]!;
  return clusters.reduce((nearest, candidate, candidateIndex) => {
    if (candidateIndex === index) return nearest;
    return Math.min(nearest, Math.hypot(candidate.screenX - current.screenX, candidate.screenY - current.screenY));
  }, Number.POSITIVE_INFINITY);
}

export function RooflineChart({
  title,
  curves,
  points,
  reveal,
  focusedPointId,
  unplottedSelection,
  onSelect,
  modelTheory = false,
  labelAllPoints = false,
}: {
  title: string;
  curves: readonly RooflineCurveVM[];
  points: readonly RooflinePointVM[];
  reveal: RooflineRevealPolicy;
  focusedPointId: string | null;
  unplottedSelection: UnplottedSelection | null;
  onSelect: (key: CrossViewEntityKey, pointId: string) => void;
  modelTheory?: boolean;
  labelAllPoints?: boolean;
}) {
  const { ref, width } = useWidth();
  const height = modelTheory ? 420 : 520;
  const compact = width < 680;
  const box = { left: compact ? 76 : 94, top: 34, width: width - (compact ? 102 : 128), height: height - 116 };
  const geometry = chartGeometry(points, curves);
  const clusters = useMemo(() => clusterPoints(points), [points]);
  const overlapping = clusters.filter((cluster) => cluster.points.length > 1);
  const uid = useId().replaceAll(":", "");
  const xTicks = compact ? geometry.xTicks.filter((_, index) => index % 2 === 0) : geometry.xTicks;
  const yTicks = compact ? geometry.yTicks.filter((_, index) => index % 2 === 0) : geometry.yTicks;
  const positionedClusters: PositionedCluster[] = clusters.map((cluster) => ({
    ...cluster,
    screenX: logX(cluster.xFlopPerByte, geometry.x, box),
    screenY: logY(cluster.yFlopPerSecond, geometry.y, box),
    marker: clusterMarker(cluster.points),
  }));
  const selectedClusterMember = (cluster: PositionedCluster) => focusedPointId !== null
    ? cluster.points.find((point) => point.pointId === focusedPointId) ?? null
    : cluster.points.find((point) => point.selected) ?? null;
  const hitCenters = positionedClusters.map((cluster) => ({ x: cluster.screenX, y: cluster.screenY }));
  const hitPolygons = positionedClusters.map((_, index) => localVoronoiCell(hitCenters, index, box));
  const clusterRadii = positionedClusters.map((cluster, index) => {
    const nearest = nearestCenterDistance(positionedClusters, index);
    const ownershipRadius = Number.isFinite(nearest)
      ? Math.max(0.05, nearest / 2 - 0.05)
      : 18;
    const desiredRadius = markerRadius(cluster.points.reduce((sum, point) => sum + point.markerAreaPx2, 0));
    const radius = Math.min(desiredRadius, Math.max(0.025, ownershipRadius - 0.025));
    return { ownershipRadius, radius };
  });
  const clusterByKey = new Map(positionedClusters.map((cluster) => [cluster.key, cluster]));
  const countLabels = (modelTheory ? [] : placeClusterCounts(
    positionedClusters.map((cluster, index) => ({
      key: cluster.key,
      count: cluster.points.length,
      x: cluster.screenX,
      y: cluster.screenY,
      coreRadius: clusterRadii[index]!.radius + 2,
      cellPolygon: hitPolygons[index]!,
    })),
    box,
  )).map((placement) => ({ ...placement, cluster: clusterByKey.get(placement.key)! }));
  const nextClusterMember = (cluster: PositionedCluster) => {
    const focusedIndex = cluster.points.findIndex((point) => point.pointId === focusedPointId);
    return cluster.points[focusedIndex >= 0 ? (focusedIndex + 1) % cluster.points.length : 0]!;
  };
  const activateCluster = (cluster: PositionedCluster) => {
    const member = nextClusterMember(cluster);
    onSelect(member.entityKey, member.pointId);
  };
  return (
    <section className="roofline-chart-panel" aria-labelledby={`${uid}-title`}>
      <header>
        <div>{!modelTheory ? <p>Active basis only</p> : null}<h3 id={`${uid}-title`}>{title}</h3></div>
        <span>{modelTheory ? `${points.length} 个解析点 · 对数坐标` : `${points.length} points / ${clusters.length} plot positions / log₁₀`}</span>
      </header>
      <div className="roofline-svg-wrap" ref={ref}>
        {unplottedSelection ? (
          <div className="roofline-not-plotted" role="status">
            <strong>Selected entity not plotted</strong>
            <span>{unplottedSelection.label}</span>
            <b>Plot blockers</b>
            <ul>{unplottedSelection.plotBlockers.map((reason) => <li key={reason}>{reason}</li>)}</ul>
            {unplottedSelection.otherEvidence.length ? <>
              <b>Other evidence status</b>
              <ul>{unplottedSelection.otherEvidence.map((reason) => <li key={reason}>{reason}</li>)}</ul>
            </> : null}
          </div>
        ) : null}
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${uid}-svg-title ${uid}-svg-desc`}>
          <title id={`${uid}-svg-title`}>{title}</title>
          <desc id={`${uid}-svg-desc`}>{modelTheory ? "理论 Roofline，使用对数坐标。点保留真实坐标，坐标重合时可用图下的选择器分别查看阶段或算子。空心点是理论估计，不是实测性能。" : "Logarithmic roofline chart. Hollow markers are analytical; half-filled markers combine observed time with modeled traffic; filled markers require observed time and measured traffic. Coincident points retain their true coordinates; use the roster to select members."}</desc>
          <defs>
            <clipPath id={`${uid}-plot`}><rect x={box.left} y={box.top} width={box.width} height={box.height} /></clipPath>
            {positionedClusters.filter((cluster) => cluster.marker === "half").map((cluster) => (
              <clipPath key={cluster.key} id={`${uid}-${safe(cluster.key)}`} clipPathUnits="objectBoundingBox"><rect x="0" y="0" width="0.5" height="1" /></clipPath>
            ))}
            <pattern id={`${uid}-mixed-marker`} width="5" height="5" patternUnits="userSpaceOnUse">
              <rect width="5" height="5" fill="white" />
              <path className="roofline-marker-mixed-hatch" d="M-1 1 L1 -1 M0 5 L5 0 M4 6 L6 4" strokeWidth="1.5" />
            </pattern>
          </defs>
          <rect className="roofline-plot-field" x={box.left} y={box.top} width={box.width} height={box.height} />
          {xTicks.map((tick) => {
            const x = logX(tick, geometry.x, box);
            return <g key={`x-${tick}`}><line className="roofline-gridline" x1={x} x2={x} y1={box.top} y2={box.top + box.height} /><text className="roofline-tick" x={x} y={box.top + box.height + 24} textAnchor="middle">{formatNumber(tick)}</text></g>;
          })}
          {yTicks.map((tick) => {
            const y = logY(tick, geometry.y, box);
            return <g key={`y-${tick}`}><line className="roofline-gridline" x1={box.left} x2={box.left + box.width} y1={y} y2={y} /><text className="roofline-tick" x={box.left - 12} y={y + 4} textAnchor="end">{throughput(tick)}</text></g>;
          })}
          <g key={reveal.key} style={{ "--roofline-reveal-ms": `${reveal.durationMs}ms` } as React.CSSProperties} clipPath={`url(#${uid}-plot)`}>
            {curves.map((curve) => {
              const ridgeX = logX(curve.ridgeFlopPerByte, geometry.x, box);
              return <g key={curve.curveId}>
                <path className={`roofline-roof ${curve.kind === "reference_only" ? "is-reference" : ""}`} pathLength={curve.kind === "uniform_roof" ? 1 : undefined} d={roofPath(curve, geometry.x, geometry.y, box)} />
                {curve.kind === "uniform_roof" ? <line className="roofline-ridge" x1={ridgeX} x2={ridgeX} y1={box.top} y2={box.top + box.height} /> : null}
              </g>;
            })}
            {countLabels.map((placement) => <line
              className="roofline-cluster-count-leader"
              key={`leader-${placement.key}`}
              data-cluster-key={placement.key}
              x1={placement.leaderStartX}
              y1={placement.leaderStartY}
              x2={placement.leaderEndX}
              y2={placement.leaderEndY}
            />)}
            {positionedClusters.map((cluster, clusterIndex) => {
              const { ownershipRadius, radius } = clusterRadii[clusterIndex]!;
              const haloRadius = Math.min(radius + 4, ownershipRadius);
              const selectedMember = selectedClusterMember(cluster);
              const nextMember = nextClusterMember(cluster);
              const labelMember = selectedMember ?? (labelAllPoints ? cluster.points[0] : null);
              const pointLabel = labelMember ? modelTheory ? theoryPointLabel(labelMember.label) : labelMember.label : "";
              const selectedLabelWidth = Math.max(48, pointLabel.length * (modelTheory ? 13 : 6.5));
              const rightFits = cluster.screenX + radius + 8 + selectedLabelWidth < box.left + box.width;
              const selectedLabelX = rightFits ? radius + 8 : -radius - 8;
              const rank = positionedClusters.filter((other) => other.screenX < cluster.screenX).length;
              const selectedLabelY = labelAllPoints && rank % 2 ? radius + 22 : -radius - 8;
              const selectedLabelBlocked = selectedMember && (cluster.points.length > 1 || countLabels.some((label) => (
                Math.abs(cluster.screenX + selectedLabelX + selectedLabelWidth / 2 - label.x) < (selectedLabelWidth + label.width) / 2
                && Math.abs(cluster.screenY + selectedLabelY - 5 - label.y) < (16 + label.height) / 2
              )));
              const title = `${cluster.points.length} point${cluster.points.length === 1 ? "" : "s"} at true AI ${formatNumber(cluster.xFlopPerByte)} FLOP/byte and true throughput ${throughput(cluster.yFlopPerSecond)} FLOP/s; ${markerEvidence(cluster.marker)}; members: ${cluster.points.map((point) => `${point.label} (${markerEvidence(point.marker)})`).join("; ")}`;
              return <g
                className="roofline-cluster"
                key={cluster.key}
                transform={`translate(${cluster.screenX} ${cluster.screenY})`}
                data-cluster-center="true"
                data-cluster-key={cluster.key}
                data-cluster-size={cluster.points.length}
                data-selected-point-id={selectedMember?.pointId}
                data-true-x={cluster.xFlopPerByte}
                data-true-y={cluster.yFlopPerSecond}
                data-marker-evidence={cluster.marker}
              >
                <title>{title}</title>
                <g className={`roofline-marker is-${cluster.marker} ${selectedMember ? "is-selected" : ""}`}>
                  {selectedMember ? <circle className="roofline-marker-halo" r={haloRadius} data-halo-radius={haloRadius} /> : null}
                  <circle className="roofline-marker-base" r={radius} />
                  {cluster.marker === "half" ? <circle className="roofline-marker-half" r={radius} clipPath={`url(#${uid}-${safe(cluster.key)})`} /> : null}
                  {cluster.marker === "mixed" ? <circle className="roofline-marker-mixed" r={radius} fill={`url(#${uid}-mixed-marker)`} /> : null}
                  <circle className="roofline-marker-outline" r={radius} />
                </g>
                <path
                  className="roofline-marker-hit"
                  d={svgPolygonPath(hitPolygons[clusterIndex]!, { x: cluster.screenX, y: cluster.screenY })}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selectedMember !== null}
                  aria-label={`${cluster.points.length > 1 ? `Select or cycle ${cluster.points.length} coincident points` : `Select ${nextMember.label}`}; true arithmetic intensity ${formatNumber(cluster.xFlopPerByte)} FLOP per byte; true throughput ${throughput(cluster.yFlopPerSecond)} FLOP per second; ${markerEvidence(cluster.marker)}; next ${nextMember.label}`}
                  data-cluster-key={cluster.key}
                  onClick={() => activateCluster(cluster)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      activateCluster(cluster);
                    }
                  }}
                />
                <circle className="roofline-marker-focus" r={Math.max(4, Math.min(radius + 4, 9))} />
                {!modelTheory && labelMember && !selectedLabelBlocked ? <text className="roofline-selected-label" textAnchor={rightFits ? "start" : "end"} x={selectedLabelX} y={selectedLabelY}>{pointLabel}</text> : null}
              </g>;
            })}
            {countLabels.map((placement) => {
              const { cluster } = placement;
              const nextMember = nextClusterMember(cluster);
              const selected = focusedPointId !== null
                ? cluster.points.some((point) => point.pointId === focusedPointId)
                : cluster.points.some((point) => point.selected);
              const coincident = cluster.points.length > 1;
              return <g
                className={`roofline-cluster-count-control${coincident ? "" : " is-singleton"}`}
                key={`count-${cluster.key}`}
                data-cluster-key={cluster.key}
                data-control-kind={coincident ? "coincident-count" : "dense-singleton"}
              >
                <rect className="roofline-cluster-count-badge" x={placement.x - placement.width / 2 + 2} y={placement.y - placement.height / 2 + 3} width={placement.width - 4} height={placement.height - 6} rx="4" />
                <text className="roofline-cluster-count" x={placement.x} y={placement.y + 3.5} textAnchor="middle" aria-hidden="true">{placement.label}</text>
                <rect
                  className="roofline-cluster-count-hit"
                  x={placement.x - placement.width / 2}
                  y={placement.y - placement.height / 2}
                  width={placement.width}
                  height={placement.height}
                  rx="5"
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  aria-label={coincident
                    ? `Select or cycle ${cluster.points.length} coincident points at true arithmetic intensity ${formatNumber(cluster.xFlopPerByte)} FLOP per byte and true throughput ${throughput(cluster.yFlopPerSecond)} FLOP per second; next ${nextMember.label}`
                    : `Select ${nextMember.label} using the external control for this dense true-coordinate point at arithmetic intensity ${formatNumber(cluster.xFlopPerByte)} FLOP per byte and throughput ${throughput(cluster.yFlopPerSecond)} FLOP per second`}
                  data-cluster-key={cluster.key}
                  onClick={() => activateCluster(cluster)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      activateCluster(cluster);
                    }
                  }}
                />
              </g>;
            })}
          </g>
          {curves.map((curve, index) => {
            if (modelTheory || curve.kind !== "uniform_roof") return null;
            const ridgeX = logX(curve.ridgeFlopPerByte, geometry.x, box);
            const labelX = Math.min(box.left + box.width - 6, Math.max(box.left + 110, ridgeX - 7));
            return <text key={`${curve.curveId}-label`} className="roofline-ridge-label" x={labelX} y={box.top + 16 + index * 15} textAnchor="end">{formatNumber(curve.ridgeFlopPerByte)} FLOP/B</text>;
          })}
          <text className="roofline-axis-title" x={box.left + box.width / 2} y={height - 16} textAnchor="middle">{modelTheory ? "算术强度 (FLOP/byte)" : "Arithmetic intensity (FLOP/byte)"}</text>
          <text className="roofline-axis-title" transform={`translate(22 ${box.top + box.height / 2}) rotate(-90)`} textAnchor="middle">{modelTheory ? "吞吐量 (FLOP/s)" : "Throughput (FLOP/s)"}</text>
        </svg>
      </div>
      {modelTheory ? <div className="roofline-point-picker">
        {labelAllPoints ? <div className="roofline-stage-picker" aria-label="选择模型阶段">{[...points].sort((a, b) => STAGE_ORDER.indexOf(a.label) - STAGE_ORDER.indexOf(b.label)).map((point) => <button
          type="button" key={point.pointId} aria-pressed={point.pointId === focusedPointId || (focusedPointId === null && point.selected)}
          onClick={() => onSelect(point.entityKey, point.pointId)}>{theoryPointLabel(point.label)}</button>)}</div>
          : <label><span>选择模型算子</span><select value={focusedPointId ?? points.find((point) => point.selected)?.pointId ?? points[0]?.pointId ?? ""}
            onChange={(event) => { const point = points.find((item) => item.pointId === event.target.value); if (point) onSelect(point.entityKey, point.pointId); }}>
            {clusters.map((cluster) => <optgroup key={cluster.key} label={cluster.points.length > 1 ? `${cluster.points.length} 个算子坐标重合` : "独立坐标"}>
              {cluster.points.map((point) => <option key={point.pointId} value={point.pointId}>{theoryPointLabel(point.label)}</option>)}
            </optgroup>)}
          </select></label>}
      </div> : null}
      <details className="roofline-curve-details" open={modelTheory ? undefined : true}>
        <summary hidden={!modelTheory}>计算与带宽上限</summary>
      <div className="roofline-curve-ledger" aria-label="计算与带宽上限">
        {curves.map((curve) => (
          <article key={curve.curveId}>
            <strong><i className={`roof-swatch ${curve.kind === "reference_only" ? "is-reference" : ""}`} /> {curve.label}</strong>
            {modelTheory && curve.kind === "uniform_roof" ? <span>计算 / 带宽分界：{formatNumber(curve.ridgeFlopPerByte)} FLOP/B</span> : null}
            <span>计算上限：{formatNumber(curve.computeFlopPerSecond / 1e12)} TFLOP/s</span>
            <span>带宽上限：{formatNumber(curve.bandwidthBytePerSecond / 1e9)} GB/s</span>
          </article>
        ))}
      </div>
      </details>
      {!modelTheory && overlapping.length ? (
        <details className="roofline-cluster-roster">
          <summary>{modelTheory ? `${overlapping.length} 组重合点 · 展开选择算子` : `${overlapping.length} coincident clusters · open entity roster`}</summary>
          <div>{overlapping.map((cluster) => (
            <article key={cluster.key}>
              <strong>{cluster.points.length} points at true AI {formatNumber(cluster.xFlopPerByte)} FLOP/B · {throughput(cluster.yFlopPerSecond)} FLOP/s · {markerEvidence(clusterMarker(cluster.points))}</strong>
              <ul>{cluster.points.map((point) => <li key={point.pointId}><button type="button" onClick={() => onSelect(point.entityKey, point.pointId)}>{point.label}</button><span>{humanize(point.marker)} · true coordinates unchanged</span></li>)}</ul>
            </article>
          ))}</div>
        </details>
      ) : null}
      <div className="roofline-chart-legend" aria-label="Marker legend">
        {modelTheory ? <><span><i className="marker-swatch is-hollow" /> 理论估计，非实测</span><strong>图下选择阶段或算子；坐标重合的项仍可分别查看。</strong></> : <>
          <span><i className="marker-swatch is-hollow" /> Analytical time + traffic</span>
          <span><i className="marker-swatch is-half" /> Observed time + modeled traffic</span>
          <span><i className="marker-swatch is-filled" /> Observed time + measured traffic</span>
          <strong>Marker area = compatible time share · coincident glyphs aggregate member area</strong>
        </>}
      </div>
    </section>
  );
}

function safe(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}
