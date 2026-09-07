import {useEffect,useId,useRef,useState} from 'react';
import {chartGeometry,logX,logY,roofPath,localVoronoiCell} from '../presentation/chartGeometry';
import {formatNumber} from '../presentation/viewModel';
import './rooflineComparison.css';

export interface RooflinePlotPoint {
 id:string;label:string;xFlopPerByte:number;yFlopPerSecond:number;
 kind:'theory'|'actual'|'alternate';
}
export interface RooflinePlotCurve {computeFlopPerSecond:number;bandwidthBytePerSecond:number;ridgeFlopPerByte:number}
/** Small selected-object plot shared by theoretical paths and measured Kernel pairs. */
export function RooflinePlot({title,points,curve,onSelect,xLabel='算术强度（FLOP/byte）',yLabel='吞吐量（TFLOP/s）',comparison}: {
 title:string;points:readonly RooflinePlotPoint[];curve:RooflinePlotCurve;
 onSelect?:(id:string)=>void;xLabel?:string;yLabel?:string;
 comparison?:{intensity:number;theoryRate:number;actualRate:number|null};
}) {
 const root=useRef<HTMLDivElement>(null),id=useId();
 const [width,setWidth]=useState(800);
 useEffect(()=>{
  if(!root.current)return;
  const observer=new ResizeObserver(([entry])=>{if(entry)setWidth(entry.contentRect.width);});
  observer.observe(root.current);return()=>observer.disconnect();
 },[]);
 const geometry=chartGeometry(points,[curve]);
 const height=width<550?310:360;
 const box={left:width<600?68:88,top:30,width:Math.max(1,width-(width<600?94:120)),height:height-105};
 const centers=points.map(p=>({x:logX(p.xFlopPerByte,geometry.x,box),y:logY(p.yFlopPerSecond,geometry.y,box)}));
 const hitCells=points.map((_,i)=>localVoronoiCell(centers,i,box,18));
 const hitId=(i:number)=>`${id.replaceAll(':','')}-hit-${i}`;
 return <div ref={root} className="roofline-pair-canvas">
  <svg viewBox={`0 0 ${width} ${height}`} aria-labelledby={id} role="img"><title id={id}>{title}</title>
   <defs>{hitCells.map((cell,i)=><clipPath key={i} id={hitId(i)} clipPathUnits="userSpaceOnUse"><polygon points={cell.map(p=>`${p.x-centers[i]!.x},${p.y-centers[i]!.y}`).join(' ')}/></clipPath>)}</defs>
   {geometry.xTicks.map(tick=><g key={tick}><line className="pair-grid" x1={logX(tick,geometry.x,box)} x2={logX(tick,geometry.x,box)} y1={box.top} y2={box.top+box.height}/><text className="pair-tick" x={logX(tick,geometry.x,box)} y={box.top+box.height+24} textAnchor="middle">{formatNumber(tick)}</text></g>)}
   {geometry.yTicks.map(tick=><g key={tick}><line className="pair-grid" x1={box.left} x2={box.left+box.width} y1={logY(tick,geometry.y,box)} y2={logY(tick,geometry.y,box)}/><text className="pair-tick" x={box.left-10} y={logY(tick,geometry.y,box)+4} textAnchor="end">{formatNumber(tick/1e12)}</text></g>)}
   <path className="pair-roof" d={roofPath(curve,geometry.x,geometry.y,box)}/>
   {comparison?<>
    <line className="pair-guide" x1={logX(comparison.intensity,geometry.x,box)} x2={logX(comparison.intensity,geometry.x,box)} y1={logY(comparison.theoryRate,geometry.y,box)} y2={box.top+box.height}/>
    {comparison.actualRate!==null?<line className="pair-gap" data-theory-rate={comparison.theoryRate} data-actual-rate={comparison.actualRate} x1={logX(comparison.intensity,geometry.x,box)} x2={logX(comparison.intensity,geometry.x,box)} y1={logY(comparison.theoryRate,geometry.y,box)} y2={logY(comparison.actualRate,geometry.y,box)}/>:null}
   </>:null}
   {points.map((point,index)=><g key={point.id} className={`pair-point is-${point.kind}`} data-point-id={point.id} transform={`translate(${logX(point.xFlopPerByte,geometry.x,box)} ${logY(point.yFlopPerSecond,geometry.y,box)})`}
    role={onSelect?'button':undefined} tabIndex={onSelect?0:undefined} aria-label={`${point.label} ${formatNumber(point.yFlopPerSecond/1e12)} TFLOP/s`}
    onClick={()=>onSelect?.(point.id)} onKeyDown={e=>{if(onSelect&&(e.key==='Enter'||e.key===' ')){e.preventDefault();onSelect(point.id);}}}>
    <title>{point.label} · {formatNumber(point.yFlopPerSecond/1e12)} TFLOP/s</title><circle className="pair-point-hit" r={15} clipPath={`url(#${hitId(index)})`}/><circle pointerEvents="none" className="pair-point-glyph" r={point.kind==='actual'?6:8}/>
   </g>)}
   <text className="pair-axis" x={box.left+box.width/2} y={height-15} textAnchor="middle">{xLabel}</text>
   <text className="pair-axis" transform={`translate(19 ${box.top+box.height/2}) rotate(-90)`} textAnchor="middle">{yLabel}</text>
  </svg>
 </div>;
}
