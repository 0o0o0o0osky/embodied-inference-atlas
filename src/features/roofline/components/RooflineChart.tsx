import { useEffect, useId, useMemo, useRef, useState } from "react";

import type { CrossViewEntityKey } from "../../workbench/entityKeys";
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
  provenanceLabel,
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
}: {
  title: string;
  curves: readonly RooflineCurveVM[];
  points: readonly RooflinePointVM[];
  reveal: RooflineRevealPolicy;
  focusedPointId: string | null;
  unplottedSelection: UnplottedSelection | null;
  onSelect: (key: CrossViewEntityKey, pointId: string) => void;
}) {
  const { ref, width } = useWidth();
  const height = 520;
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
  const clusterByKey = new Map(positionedClusters.map((cluster) => [cluster.key, cluster]));
  const countLabels = placeClusterCounts(
    positionedClusters.map((cluster) => ({ key: cluster.key, count: cluster.points.length, x: cluster.screenX, y: cluster.screenY })),
    box,
  ).map((placement) => ({ ...placement, cluster: clusterByKey.get(placement.key)! }));
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
        <div><p>Active basis only</p><h3 id={`${uid}-title`}>{title}</h3></div>
        <span>{points.length} points / {clusters.length} plot positions / log₁₀</span>
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
          <desc id={`${uid}-svg-desc`}>Logarithmic roofline chart. Hollow markers are analytical; half-filled markers combine observed time with modeled traffic; filled markers require observed time and measured traffic. Exact coincidences use one aggregate glyph at the true coordinate; activate it repeatedly or use the roster to select members.</desc>
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
            {positionedClusters.map((cluster, clusterIndex) => {
              const nearest = nearestCenterDistance(positionedClusters, clusterIndex);
              const ownershipRadius = Number.isFinite(nearest)
                ? Math.max(0.05, nearest / 2 - 0.05)
                : 18;
              const desiredRadius = markerRadius(cluster.points.reduce((sum, point) => sum + point.markerAreaPx2, 0));
              const radius = Math.min(desiredRadius, Math.max(0.025, ownershipRadius - 0.025));
              const haloRadius = Math.min(radius + 4, ownershipRadius);
              const selectedMember = selectedClusterMember(cluster);
              const nextMember = nextClusterMember(cluster);
              const selectedLabelWidth = selectedMember ? Math.max(48, selectedMember.label.length * 6.5) : 0;
              const selectedLabelX = radius + 8;
              const selectedLabelY = -radius - 4;
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
                {selectedMember && !selectedLabelBlocked ? <text className="roofline-selected-label" x={selectedLabelX} y={selectedLabelY}>{selectedMember.label}</text> : null}
              </g>;
            })}
            {countLabels.map((placement) => {
              const { cluster } = placement;
              const nextMember = nextClusterMember(cluster);
              const selected = focusedPointId !== null
                ? cluster.points.some((point) => point.pointId === focusedPointId)
                : cluster.points.some((point) => point.selected);
              return <g className="roofline-cluster-count-control" key={`count-${cluster.key}`} data-cluster-key={cluster.key}>
                <line className="roofline-cluster-count-leader" x1={cluster.screenX} y1={cluster.screenY} x2={placement.x} y2={placement.y} />
                <rect className="roofline-cluster-count-badge" x={placement.x - placement.width / 2 + 2} y={placement.y - placement.height / 2 + 3} width={placement.width - 4} height={placement.height - 6} rx="4" />
                <text className="roofline-cluster-count" x={placement.x} y={placement.y + 3.5} textAnchor="middle" aria-hidden="true">×{cluster.points.length}</text>
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
                  aria-label={`Select or cycle ${cluster.points.length} coincident points at true arithmetic intensity ${formatNumber(cluster.xFlopPerByte)} FLOP per byte and true throughput ${throughput(cluster.yFlopPerSecond)} FLOP per second; next ${nextMember.label}`}
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
            if (curve.kind !== "uniform_roof") return null;
            const ridgeX = logX(curve.ridgeFlopPerByte, geometry.x, box);
            const labelX = Math.min(box.left + box.width - 6, Math.max(box.left + 110, ridgeX - 7));
            return <text key={`${curve.curveId}-label`} className="roofline-ridge-label" x={labelX} y={box.top + 16 + index * 15} textAnchor="end">{formatNumber(curve.ridgeFlopPerByte)} FLOP/B</text>;
          })}
          <text className="roofline-axis-title" x={box.left + box.width / 2} y={height - 16} textAnchor="middle">Arithmetic intensity (FLOP/byte)</text>
          <text className="roofline-axis-title" transform={`translate(22 ${box.top + box.height / 2}) rotate(-90)`} textAnchor="middle">Throughput (FLOP/s)</text>
        </svg>
      </div>
      <div className="roofline-curve-ledger" aria-label="Curve identities and provenance">
        {curves.map((curve) => (
          <article key={curve.curveId}>
            <strong><i className={`roof-swatch ${curve.kind === "reference_only" ? "is-reference" : ""}`} /> {curve.label}</strong>
            <code>{curve.curveId}</code>
            <span>Compute · {curve.computeCeilingId} · {provenanceLabel(curve.computeProvenance)} · {curve.computeProvenance.condition ?? "no extra condition"}</span>
            <span>Bandwidth · {curve.bandwidthCeilingId} · {provenanceLabel(curve.bandwidthProvenance)} · {curve.bandwidthProvenance.condition ?? "no extra condition"}</span>
          </article>
        ))}
      </div>
      {overlapping.length ? (
        <details className="roofline-cluster-roster">
          <summary>{overlapping.length} coincident clusters · open entity roster</summary>
          <div>{overlapping.map((cluster) => (
            <article key={cluster.key}>
              <strong>{cluster.points.length} points at true AI {formatNumber(cluster.xFlopPerByte)} FLOP/B · {throughput(cluster.yFlopPerSecond)} FLOP/s · {markerEvidence(clusterMarker(cluster.points))}</strong>
              <ul>{cluster.points.map((point) => <li key={point.pointId}><button type="button" onClick={() => onSelect(point.entityKey, point.pointId)}>{point.label}</button><span>{humanize(point.marker)} · true coordinates unchanged</span></li>)}</ul>
            </article>
          ))}</div>
        </details>
      ) : null}
      <div className="roofline-chart-legend" aria-label="Marker legend">
        <span><i className="marker-swatch is-hollow" /> Analytical time + traffic</span>
        <span><i className="marker-swatch is-half" /> Observed time + modeled traffic</span>
        <span><i className="marker-swatch is-filled" /> Observed time + measured traffic</span>
        <strong>Marker area = compatible time share · coincident glyphs aggregate member area</strong>
      </div>
    </section>
  );
}

function safe(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}
