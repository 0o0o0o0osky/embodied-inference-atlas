import {useId, useState} from 'react';
import type {RuntimeRealizationRecord, RuntimeSystemFlow as Flow} from '../domain/types';
import './runtimeSystemFlow.css';

const WIDTH=132, HEIGHT=80, GAP=166, LEFT=86;
const yFor=(lane:'cpu'|'gpu')=>lane==='cpu'?66:266;
function lines(label:string):string[] {
 const tokens=label.match(/[A-Za-z0-9_]+|[^A-Za-z0-9_]/gu)??[label];
 const weight=(text:string)=>[...text].reduce((sum,char)=>sum+(char.charCodeAt(0)<128?.52:1),0);
 if(weight(label)<=8.5)return [label];
 const separators=label.split(' / ');
 if(separators.length===3)return [separators.slice(0,2).join(' / '),separators[2]!];
 let split=1,distance=Infinity;
 for(let i=1;i<tokens.length;i++) {
  const left=tokens.slice(0,i).join('').trim(),right=tokens.slice(i).join('').trim();
  const next=Math.abs(weight(left)-weight(right));
  if(left&&right&&next<distance){split=i;distance=next;}
 }
 return [tokens.slice(0,split).join('').trim(),tokens.slice(split).join('').trim()];
}

/** Ordering and data dependencies only; no measured timestamps or scaled bars. */
export function RuntimeSystemFlow({realization}:{realization:RuntimeRealizationRecord}) {
 const flow=realization.systemFlow;
 const [selectedId,setSelectedId]=useState<string|null>(null);
 const uid=useId().replace(/:/g,'');
 if(!flow?.nodes.length)return null;
 const selected=flow.nodes.find(node=>node.nodeId===selectedId);
 const nodes=new Map(flow.nodes.map(node=>[node.nodeId,node]));
 const width=LEFT+(Math.max(...flow.nodes.map(node=>node.step))+1)*GAP;
 const groups=flow.groups.filter(group=>group.kind!=='repeat');
 const select=(id:string)=>setSelectedId(id===selectedId?null:id);
 return <section className="runtime-system-flow" aria-label="CPU 与 GPU 系统过程">
  <header><div><h3>一次推理的系统过程</h3><p>上方 CPU，下方 GPU；从左到右表示过程顺序，距离与宽度不表示耗时。</p></div>
   <div className="system-flow-key"><span className="is-data">数据传递</span><span className="is-control">提交 / 控制</span><span className="is-reuse">结果复用</span></div>
  </header>
  <div className="system-flow-scroll" tabIndex={0} aria-label="系统过程图，可横向滚动">
   <p className="system-flow-scroll-hint">左右滚动查看完整过程</p>
   <svg viewBox={`0 0 ${width} 434`} style={{minWidth:width}} role="group" aria-label={`${realization.runtimeId} 的 CPU GPU 模块与交互`}>
    <defs>{(['data','control','reuse'] as const).map(kind=><marker key={kind} id={`${uid}-${kind}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" className={`system-flow-arrow is-${kind}`}/></marker>)}</defs>
    <rect x="0" y="38" width={width} height="138" rx="6" className="system-flow-lane is-cpu"/>
    <rect x="0" y="230" width={width} height="166" rx="6" className="system-flow-lane is-gpu"/>
    <text x="18" y="99" className="system-flow-lane-label">CPU</text><text x="18" y="120" className="system-flow-lane-note">主机</text>
    <text x="18" y="302" className="system-flow-lane-label">GPU</text><text x="18" y="323" className="system-flow-lane-note">设备</text>
    <line x1={LEFT} y1="204" x2={width-20} y2="204" className="system-flow-time" markerEnd={`url(#${uid}-control)`}/>
    <text x={LEFT} y="196" className="system-flow-time-label">时间顺序 → · 示意</text>
    {groups.map((group,i)=>{
      const members=group.nodeIds.flatMap(id=>nodes.get(id)?[nodes.get(id)!]:[]);
      if(!members.length)return null;
      const x=LEFT+Math.min(...members.map(n=>n.step))*GAP-10;
      const right=LEFT+Math.max(...members.map(n=>n.step))*GAP+WIDTH+10;
      return <g key={i} className={`system-flow-boundary is-${group.kind}`}><rect x={x} y="245" width={right-x} height="122" rx="7"/><text x={x+9} y="258">{group.label}</text></g>;
    })}
    {flow.edges.map((edge,i)=>{
      const from=nodes.get(edge.from),to=nodes.get(edge.to);if(!from||!to)return null;
      const path=edgePath(from,to,edge.kind);
      const dim=selected && selected.nodeId!==edge.from && selected.nodeId!==edge.to;
      return <g key={i} className={`system-flow-edge is-${edge.kind}${dim?' is-muted':''}`}>
        <path d={path.d} markerEnd={`url(#${uid}-${edge.kind})`}/>
        <text x={path.x} y={path.y} textAnchor="middle">{edge.label}</text>
      </g>;
    })}
    {flow.nodes.map(node=>{
      const x=LEFT+node.step*GAP,y=yFor(node.lane),labelLines=lines(node.label);
      const repeated=flow.groups.find(group=>group.kind==='repeat' && group.nodeIds.includes(node.nodeId));
      return <g key={node.nodeId} transform={`translate(${x} ${y})`} className={`system-flow-node is-${node.lane}${node.nodeId===selectedId?' is-selected':''}`}
        role="button" tabIndex={0} aria-label={`查看模块：${node.label}`} aria-pressed={node.nodeId===selectedId}
        onClick={()=>select(node.nodeId)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select(node.nodeId);}}}>
        <rect width={WIDTH} height={HEIGHT} rx="6"/>
        <text x={WIDTH/2} textAnchor="middle">{labelLines.map((line,i)=><tspan key={i} x={WIDTH/2} y={labelLines.length===1?43:33+i*22}>{line}</tspan>)}</text>
        {repeated?<text x={WIDTH/2} y={HEIGHT+34} textAnchor="middle" className="system-flow-repeat">↻ {repeated.label}</text>:null}
      </g>;
    })}
    <text x={LEFT} y="423" className="system-flow-footnote">点击模块查看计算、读写与复用范围</text>
   </svg>
  </div>
  {selected?<div className="system-flow-detail" role="region" aria-label="所选系统模块">
    <div className="system-flow-detail-heading"><h4>{selected.label}<span>{selected.lane.toUpperCase()}</span></h4><button type="button" onClick={()=>setSelectedId(null)} aria-label="关闭系统模块详情">×</button></div>
    <p>{selected.operation}</p>
    <dl><div><dt>读入</dt><dd>{selected.reads.join('、')||'未记录'}</dd></div><div><dt>写出</dt><dd>{selected.writes.join('、')||'未记录'}</dd></div><div><dt>保留与复用</dt><dd>{selected.reuse??'未确认结果复用'}</dd></div></dl>
  </div>:null}
  <details className="system-flow-scope"><summary>输入准备、初始化与适用范围</summary>{flow.notes.map((note,i)=><p key={i}>{note}</p>)}</details>
 </section>;
}

function edgePath(from:Flow['nodes'][number],to:Flow['nodes'][number],kind:Flow['edges'][number]['kind']) {
 const x1=LEFT+from.step*GAP+WIDTH,y1=yFor(from.lane)+HEIGHT/2;
 const x2=LEFT+to.step*GAP,y2=yFor(to.lane)+HEIGHT/2;
 if(kind==='reuse') {
  const low=Math.max(y1,y2)+82;
  return {d:`M ${x1-24} ${y1+HEIGHT/2} V ${low} H ${x2+24} V ${y2+HEIGHT/2}`,x:(x1+x2)/2,y:low+16};
 }
 if(from.lane===to.lane && to.step-from.step>1) {
  const top=y1-HEIGHT/2-36;
  return {d:`M ${x1-20} ${y1-HEIGHT/2} V ${top} H ${x2+20} V ${y2-HEIGHT/2}`,x:(x1+x2)/2,y:top-7};
 }
 if(from.lane===to.lane)return {d:`M ${x1} ${y1} H ${x2}`,x:(x1+x2)/2,y:y1+HEIGHT/2+16};
 const middle=(x1+x2)/2;
 if(kind==='control')return {d:`M ${x1} ${y1+12} C ${middle+12} ${y1+12} ${middle+12} ${y2+12} ${x2} ${y2+12}`,x:middle+12,y:(y1+y2)/2+43};
 return {d:`M ${x1} ${y1} C ${middle} ${y1} ${middle} ${y2} ${x2} ${y2}`,x:middle,y:(y1+y2)/2+(to.lane==='gpu'?21:-13)};
}
