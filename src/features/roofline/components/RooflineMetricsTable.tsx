import type {ReactNode} from 'react';
import './rooflineComparison.css';
export interface RooflineMetricRow {label:string;values:readonly ReactNode[]}
export function RooflineMetricsTable({columns,rows,label,children}:{columns:readonly string[];rows:readonly RooflineMetricRow[];label:string;children?:ReactNode}) {
 return <div className="roofline-pair-table-wrap"><table className="roofline-pair-metrics" aria-label={label}>
  <thead><tr><th scope="col">指标</th>{columns.map(c=><th key={c} scope="col">{c}</th>)}</tr></thead>
  <tbody>{rows.map(row=><tr key={row.label}><th scope="row">{row.label}</th>{row.values.map((value,index)=><td key={index}>{value}</td>)}</tr>)}{children}</tbody>
 </table></div>;
}
