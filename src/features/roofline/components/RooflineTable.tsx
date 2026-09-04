import type { CrossViewEntityKey } from "../../workbench/entityKeys";
import type { RooflineRowVM } from "../presentation/viewModel";

const HEADERS = ["Entity", "Shape/Coverage", "Calls", "Work", "Traffic", "AI", "Roof time", "Actual time", "Efficiency/Gap", "Limiter"] as const;

export function RooflineTable({
  rows,
  focusedPointId,
  onSelect,
}: {
  rows: readonly RooflineRowVM[];
  focusedPointId: string | null;
  onSelect: (key: CrossViewEntityKey, pointId: string) => void;
}) {
  return (
    <section className="roofline-table-panel" aria-labelledby="roofline-table-title">
      <header><div><p>Same active basis</p><h3 id="roofline-table-title">Entity accounting ledger</h3></div><span>{rows.length} rows · 10 fields</span></header>
      <div className="roofline-table-scroll">
        <table>
          <thead><tr>{HEADERS.map((header) => <th scope="col" key={header}>{header}</th>)}</tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.pointId} aria-selected={focusedPointId ? focusedPointId === row.pointId : row.selected} className={row.partial ? "is-partial" : undefined}>
                <th scope="row"><button type="button" onClick={() => onSelect(row.entityKey, row.pointId)}>{row.entity}</button>{row.partial ? <small>Partial envelope</small> : null}</th>
                <td>{row.shapeOrCoverage}</td>
                <td>{row.calls}</td>
                <td>{row.work}</td>
                <td>{row.traffic}</td>
                <td>{missing(row.arithmeticIntensity, row.missingSummary)}</td>
                <td>{missing(row.roofTime, row.missingSummary)}</td>
                <td>{missing(row.actualTime, row.missingSummary)}</td>
                <td>{missing(row.efficiencyGap, row.missingSummary)}</td>
                <td>{row.limiter}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function missing(value: string, reason: string) {
  return value === "—" ? <span title={reason}>—<span className="sr-only"> Missing: {reason}</span></span> : value;
}
