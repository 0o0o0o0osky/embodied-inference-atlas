import { useEffect, useId, useRef, useState } from "react";

import type { CrossViewEntityKey } from "../../workbench/entityKeys";
import {
  chartGeometry,
  logX,
  logY,
  markerRadius,
  roofPath,
} from "../presentation/chartGeometry";
import { formatNumber, type RooflineCurveVM, type RooflinePointVM } from "../presentation/viewModel";

export interface RooflineRevealPolicy {
  key: string;
  durationMs: 400;
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

export function RooflineChart({
  title,
  curves,
  points,
  reveal,
  onSelect,
}: {
  title: string;
  curves: readonly RooflineCurveVM[];
  points: readonly RooflinePointVM[];
  reveal: RooflineRevealPolicy;
  selectedEntityKey: CrossViewEntityKey | null;
  onSelect: (key: CrossViewEntityKey) => void;
}) {
  const { ref, width } = useWidth();
  const height = 520;
  const compact = width < 680;
  const box = { left: compact ? 76 : 94, top: 34, width: width - (compact ? 102 : 128), height: height - 116 };
  const geometry = chartGeometry(points, curves);
  const uid = useId().replaceAll(":", "");
  const xTicks = compact ? geometry.xTicks.filter((_, index) => index % 2 === 0) : geometry.xTicks;
  const yTicks = compact ? geometry.yTicks.filter((_, index) => index % 2 === 0) : geometry.yTicks;
  return (
    <section className="roofline-chart-panel" aria-labelledby={`${uid}-title`}>
      <header>
        <div><p>Active basis only</p><h3 id={`${uid}-title`}>{title}</h3></div>
        <span>{points.length} plottable / log₁₀</span>
      </header>
      <div className="roofline-svg-wrap" ref={ref}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${uid}-svg-title ${uid}-svg-desc`}>
          <title id={`${uid}-svg-title`}>{title}</title>
          <desc id={`${uid}-svg-desc`}>Logarithmic roofline chart. Hollow markers are analytical; half-filled markers combine observed time with modeled traffic; filled markers require observed time and measured traffic.</desc>
          <defs>
            <clipPath id={`${uid}-plot`}><rect x={box.left} y={box.top} width={box.width} height={box.height} /></clipPath>
            {points.filter((point) => point.marker === "half").map((point) => {
              return <clipPath key={point.pointId} id={`${uid}-${safe(point.pointId)}`} clipPathUnits="objectBoundingBox"><rect x="0" y="0" width="0.5" height="1" /></clipPath>;
            })}
          </defs>
          <rect className="roofline-plot-field" x={box.left} y={box.top} width={box.width} height={box.height} />
          {geometry.xTicks.map((tick) => {
            const x = logX(tick, geometry.x, box);
            return <g key={`x-${tick}`}><line className="roofline-gridline" x1={x} x2={x} y1={box.top} y2={box.top + box.height} /><text className="roofline-tick" x={x} y={box.top + box.height + 24} textAnchor="middle">{formatNumber(tick)}</text></g>;
          })}
          {geometry.yTicks.map((tick) => {
            const y = logY(tick, geometry.y, box);
            return <g key={`y-${tick}`}><line className="roofline-gridline" x1={box.left} x2={box.left + box.width} y1={y} y2={y} /><text className="roofline-tick" x={box.left - 12} y={y + 4} textAnchor="end">{throughput(tick)}</text></g>;
          })}
          <g key={reveal.key} style={{ "--roofline-reveal-ms": `${reveal.durationMs}ms` } as React.CSSProperties} clipPath={`url(#${uid}-plot)`}>
            {curves.map((curve) => {
              const ridgeX = logX(curve.ridgeFlopPerByte, geometry.x, box);
              return <g key={curve.curveId}>
                <path className={`roofline-roof ${curve.kind === "reference_only" ? "is-reference" : ""}`} pathLength={curve.kind === "uniform_roof" ? 1 : undefined} d={roofPath(curve, geometry.x, geometry.y, box)} />
                {curve.kind === "uniform_roof" ? <><line className="roofline-ridge" x1={ridgeX} x2={ridgeX} y1={box.top} y2={box.top + box.height} /><text className="roofline-ridge-label" x={ridgeX + 7} y={box.top + 16}>{formatNumber(curve.ridgeFlopPerByte)} FLOP/B</text></> : null}
              </g>;
            })}
            {points.map((point) => {
              const x = logX(point.xFlopPerByte, geometry.x, box);
              const y = logY(point.yFlopPerSecond, geometry.y, box);
              const radius = markerRadius(point.markerAreaPx2);
              return <g className={`roofline-marker is-${point.marker} ${point.selected ? "is-selected" : ""}`} key={point.pointId} transform={`translate(${x} ${y})`}>
                <title>{point.label}; {formatNumber(point.xFlopPerByte)} FLOP/byte; {throughput(point.yFlopPerSecond)}FLOP/s; {point.marker}</title>
                {point.selected ? <circle className="roofline-marker-halo" r={radius + 5} /> : null}
                {point.marker === "half" ? <circle className="roofline-marker-half" r={radius} clipPath={`url(#${uid}-${safe(point.pointId)})`} /> : null}
                <circle className="roofline-marker-core" r={radius} />
                <circle
                  className="roofline-marker-hit"
                  r={Math.max(12, radius + 4)}
                  role="button"
                  tabIndex={0}
                  aria-label={`Select ${point.label}`}
                  onClick={() => onSelect(point.entityKey)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(point.entityKey);
                    }
                  }}
                />
                {point.selected ? <text className="roofline-selected-label" x={radius + 8} y={-radius - 4}>{point.label}</text> : null}
              </g>;
            })}
          </g>
          <text className="roofline-axis-title" x={box.left + box.width / 2} y={height - 16} textAnchor="middle">Arithmetic intensity (FLOP/byte)</text>
          <text className="roofline-axis-title" transform={`translate(22 ${box.top + box.height / 2}) rotate(-90)`} textAnchor="middle">Throughput (FLOP/s)</text>
        </svg>
      </div>
      <div className="roofline-chart-legend" aria-label="Marker legend">
        <span><i className="marker-swatch is-hollow" /> Analytical time + traffic</span>
        <span><i className="marker-swatch is-half" /> Observed time + modeled traffic</span>
        <span><i className="marker-swatch is-filled" /> Observed time + measured traffic</span>
        {curves.some((curve) => curve.kind === "reference_only") ? <span><i className="roof-swatch" /> Reference only</span> : null}
        <strong>Marker area = compatible time share</strong>
      </div>
    </section>
  );
}

function safe(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}
