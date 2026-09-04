import { useEffect, useId, useMemo, useRef, useState } from "react";

import type { CrossViewEntityKey } from "../../workbench/entityKeys";
import {
  chartGeometry,
  logX,
  logY,
  markerRadius,
  roofPath,
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
  reasons: readonly string[];
}

interface PointCluster {
  key: string;
  xFlopPerByte: number;
  yFlopPerSecond: number;
  points: readonly RooflinePointVM[];
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

function fanOffset(index: number, count: number) {
  if (count === 1) return { x: 0, y: 0 };
  const ring = Math.floor(index / 8);
  const withinRing = index % 8;
  const ringCount = Math.min(8, count - ring * 8);
  const radius = 18 + ring * 13;
  const angle = -Math.PI / 2 + withinRing / ringCount * Math.PI * 2;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
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
            <ul>{unplottedSelection.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          </div>
        ) : null}
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${uid}-svg-title ${uid}-svg-desc`}>
          <title id={`${uid}-svg-title`}>{title}</title>
          <desc id={`${uid}-svg-desc`}>Logarithmic roofline chart. Hollow markers are analytical; half-filled markers combine observed time with modeled traffic; filled markers require observed time and measured traffic. Coincident points retain their true values and use screen-space fanout only for selection.</desc>
          <defs>
            <clipPath id={`${uid}-plot`}><rect x={box.left} y={box.top} width={box.width} height={box.height} /></clipPath>
            {points.filter((point) => point.marker === "half").map((point) => (
              <clipPath key={point.pointId} id={`${uid}-${safe(point.pointId)}`} clipPathUnits="objectBoundingBox"><rect x="0" y="0" width="0.5" height="1" /></clipPath>
            ))}
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
            {clusters.map((cluster) => {
              const trueX = logX(cluster.xFlopPerByte, geometry.x, box);
              const trueY = logY(cluster.yFlopPerSecond, geometry.y, box);
              return <g className="roofline-cluster" key={cluster.key} transform={`translate(${trueX} ${trueY})`}>
                {cluster.points.length > 1 ? cluster.points.map((_, index) => {
                  const offset = fanOffset(index, cluster.points.length);
                  return <line className="roofline-cluster-tether" key={`tether-${index}`} x1="0" y1="0" x2={offset.x} y2={offset.y} />;
                }) : null}
                {cluster.points.map((point, index) => {
                  const offset = fanOffset(index, cluster.points.length);
                  const radius = markerRadius(point.markerAreaPx2);
                  const selected = focusedPointId ? focusedPointId === point.pointId : point.selected;
                  return <g className={`roofline-marker is-${point.marker} ${selected ? "is-selected" : ""}`} key={point.pointId} transform={`translate(${offset.x} ${offset.y})`}>
                    <title>{point.label}; true AI {formatNumber(point.xFlopPerByte)} FLOP/byte; true throughput {throughput(point.yFlopPerSecond)} FLOP/s; {point.marker}</title>
                    {selected ? <circle className="roofline-marker-halo" r={radius + 5} /> : null}
                    {point.marker === "half" ? <circle className="roofline-marker-half" r={radius} clipPath={`url(#${uid}-${safe(point.pointId)})`} /> : null}
                    <circle className="roofline-marker-core" r={radius} />
                    <circle
                      className="roofline-marker-hit"
                      r={Math.max(12, radius + 4)}
                      role="button"
                      tabIndex={0}
                      aria-label={`Select ${point.label}; true arithmetic intensity ${formatNumber(point.xFlopPerByte)} FLOP per byte; true throughput ${throughput(point.yFlopPerSecond)} FLOP per second`}
                      onClick={() => onSelect(point.entityKey, point.pointId)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelect(point.entityKey, point.pointId);
                        }
                      }}
                    />
                    {selected ? <text className="roofline-selected-label" x={radius + 8} y={-radius - 4}>{point.label}</text> : null}
                  </g>;
                })}
                {cluster.points.length > 1 ? <g className="roofline-cluster-count" aria-label={`${cluster.points.length} coincident points`}><circle r="10" /><text y="4" textAnchor="middle">{cluster.points.length}</text></g> : null}
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
              <strong>{cluster.points.length} points at true AI {formatNumber(cluster.xFlopPerByte)} FLOP/B · {throughput(cluster.yFlopPerSecond)} FLOP/s</strong>
              <ul>{cluster.points.map((point) => <li key={point.pointId}><button type="button" onClick={() => onSelect(point.entityKey, point.pointId)}>{point.label}</button><span>{humanize(point.marker)} · true coordinates unchanged</span></li>)}</ul>
            </article>
          ))}</div>
        </details>
      ) : null}
      <div className="roofline-chart-legend" aria-label="Marker legend">
        <span><i className="marker-swatch is-hollow" /> Analytical time + traffic</span>
        <span><i className="marker-swatch is-half" /> Observed time + modeled traffic</span>
        <span><i className="marker-swatch is-filled" /> Observed time + measured traffic</span>
        <strong>Marker area = compatible time share</strong>
      </div>
    </section>
  );
}

function safe(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}
