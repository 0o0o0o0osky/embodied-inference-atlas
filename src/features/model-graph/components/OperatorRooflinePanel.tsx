import type {ReactNode} from 'react';
import {buildOperatorRooflineSummary,type Pi0AnalyticalResult,type OperatorRooflineSummary} from '../../roofline/presentation/buildOperatorRooflineSummary';
import {formatNumber,formatQuantity,formatTime} from '../../roofline/presentation/viewModel';
import type {RooflinePointRecord} from '../../roofline/domain/types';
import type {OperatorDetail} from '../domain/types';
import {OperatorExecutionEstimate,supportsExecutionEstimate} from './OperatorExecutionEstimate';
import {TheoryRooflinePanel} from '../../roofline/components/TheoryRooflinePanel';
import type {RooflinePlotPoint} from '../../roofline/components/RooflinePlot';

interface OperatorRooflinePanelProps {
 detail?:OperatorDetail;result:Pi0AnalyticalResult;logicalRef:string;fullAnalysisLink:ReactNode;
}
const limiters={compute:'计算',memory:'带宽',dependency:'依赖路径',tie:'计算 / 带宽并列',unknown:'速率待补充'};
function rowLabel(point:RooflinePointRecord) {
 if(point.entity.entity_id.endsWith('#score'))return 'Q @ Kᵀ';
 if(point.entity.entity_id.endsWith('#softmax'))return 'Softmax';
 if(point.entity.entity_id.endsWith('#value'))return 'P @ V';
 return '理论参考';
}
export function OperatorRooflinePanel({result,detail,logicalRef,fullAnalysisLink}:OperatorRooflinePanelProps) {
 if(result.status==='unavailable')return <div className="drawer-availability"><h3>当前场景无法生成解析 Roofline</h3><p>{result.reason}</p>{fullAnalysisLink}</div>;
 if(detail&&supportsExecutionEstimate(detail))return <><OperatorExecutionEstimate detail={detail} scenario={result.value.scenario} ceiling={result.value.ceiling} bandwidth={result.value.bandwidthCeiling.byte_per_second}/><div className="operator-roofline-action">{fullAnalysisLink}</div></>;
 const summary=buildOperatorRooflineSummary(result.value,logicalRef);
 if(!summary)return <div className="drawer-availability"><h3>该算子的理论模型待补充</h3><p>需要对应的算术、特殊函数和读写公式。</p>{fullAnalysisLink}</div>;
 return <><OperatorTheoryRowsPanel summary={summary}/><div className="operator-roofline-action">{fullAnalysisLink}</div></>;
}
export function OperatorTheoryRowsPanel({summary}:{summary:OperatorRooflineSummary}) {
 const rows=summary.rows.filter(row=>!row.point.entity.entity_id.endsWith('#composite'));
 const primary=rows[0]!.point,bandwidth=rows[0]!.bandwidthCeiling;
 const computeRate=primary.derived.compute_second!==null&&primary.derived.compute_second>0?primary.work.total_flop/primary.derived.compute_second:null;
 const curve=computeRate&&bandwidth.byte_per_second?{computeFlopPerSecond:computeRate,bandwidthBytePerSecond:bandwidth.byte_per_second,ridgeFlopPerByte:computeRate/bandwidth.byte_per_second}:null;
 const points:RooflinePlotPoint[]=rows.flatMap(({point},index)=>point.derived.roof_flop_per_second!==null&&point.derived.arithmetic_intensity_flop_per_byte!==null?[{
  id:point.point_id,label:rowLabel(point),kind:index?'alternate' as const:'theory' as const,
  xFlopPerByte:point.derived.arithmetic_intensity_flop_per_byte,yFlopPerSecond:point.derived.roof_flop_per_second,
 }]:[]);
 const perCall=(point:RooflinePointRecord,value:number|null,format:(v:number)=>string)=>value===null?'速率待补充':format(value/point.calls);
 return <TheoryRooflinePanel title="算子 · 理论 Roofline" context="单次调用" curve={curve} points={points} columns={rows.map(row=>rowLabel(row.point))} rows={[
  {label:'理论时间',values:rows.map(({point})=>perCall(point,point.derived.roof_second,formatTime))},
  {label:'吞吐量',values:rows.map(({point})=>point.derived.roof_flop_per_second===null?'—':`${formatNumber(point.derived.roof_flop_per_second/1e12)} TFLOP/s`)},
  {label:'算术工作量',values:rows.map(({point})=>perCall(point,point.work.total_flop,v=>formatQuantity(v,'FLOP')))},
  {label:'建模读写',values:rows.map(({point})=>perCall(point,point.traffic.total_byte,v=>formatQuantity(v,'B')))},
  {label:'算术强度',values:rows.map(({point})=>point.derived.arithmetic_intensity_flop_per_byte===null?'—':`${formatNumber(point.derived.arithmetic_intensity_flop_per_byte)} FLOP/B`)},
  {label:'主要限制',values:rows.map(({point})=>limiters[point.derived.limiter])},
 ]} note={`理论计算与读写上限 · 当前 DAG 累计调用 ${primary.calls} 次。`}>
  <p>{primary.entity.shape_or_coverage}</p>
  <p>表中按单次调用展示。当前图中累计理论时间：{primary.derived.roof_second===null?'速率待补充':formatTime(primary.derived.roof_second)}。</p>
  {rows.map(({point,computeCeilings})=><div key={point.point_id}>
   {computeCeilings.map(c=><p key={c.compute_ceiling_id}>{c.compute_class.replaceAll('_',' ')}：{c.flop_per_second===null?'速率待补充':`${formatNumber(c.flop_per_second/1e12)} TFLOP/s`}。{c.provenance.condition}</p>)}
  </div>)}
  <p>带宽：{bandwidth.byte_per_second===null?'速率待补充':`${formatNumber(bandwidth.byte_per_second/1e9)} GB/s`}。</p>
 </TheoryRooflinePanel>;
}
