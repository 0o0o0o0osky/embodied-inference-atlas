import {useState,type ReactNode} from 'react';
import {RooflinePlot,type RooflinePlotCurve,type RooflinePlotPoint} from './RooflinePlot';
import {RooflineMetricsTable,type RooflineMetricRow} from './RooflineMetricsTable';

/** Common selected-operator layout; formulas and explanatory content stay with their adapters. */
export function TheoryRooflinePanel({title,context,curve,points,columns,rows,note,children,yLabel,onSelect}: {
 title:string;context:string;curve:RooflinePlotCurve|null;points:readonly RooflinePlotPoint[];
 columns:readonly string[];rows:readonly RooflineMetricRow[];note:string;children:ReactNode;
 yLabel?:string;onSelect?:(id:string)=>void;
}) {
 const [inspecting,setInspecting]=useState(false);
 return <section className="roofline-pair-chart theory-roofline-panel" aria-label={title}>
  <header className="roofline-pair-summary"><span>{title}</span><strong>{context}</strong></header>
  {curve && points.length ? <RooflinePlot title={title} curve={curve} points={points} {...(yLabel?{yLabel}:{})} onSelect={id=>{setInspecting(true);onSelect?.(id);}}/>
   :<p className="roofline-comparison-missing">硬件速率待补充；已知工作量与读写量见下表。</p>}
  {points.length?<div className="roofline-pair-legend">{points.map(point=><span key={point.id}><i className={`is-${point.kind}`}/>{point.label}</span>)}<small>理论参考 · 建模流量</small></div>:null}
  <RooflineMetricsTable label={`${title}指标对照`} columns={columns} rows={rows}/>
  <p className="roofline-pair-hint">{note}</p>
  <details className="roofline-pair-inspector" open={inspecting} onToggle={event=>setInspecting(event.currentTarget.open)}><summary>计算过程与参考条件</summary>{children}</details>
 </section>;
}
