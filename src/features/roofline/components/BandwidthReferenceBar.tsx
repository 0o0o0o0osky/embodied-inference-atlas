import {useId} from 'react';
/** Linear bandwidth scale for memory-only operators; no artificial FLOP axis. */
export function BandwidthReferenceBar({bandwidth}:{bandwidth:number|null}) {
 const id=useId();
 if(bandwidth===null||!Number.isFinite(bandwidth)||bandwidth<=0)return <p>带宽待补充；读写量见下表。</p>;
 const gb=bandwidth/1e9;
 return <svg viewBox="0 0 480 100" role="img" aria-labelledby={id} style={{width:'100%',maxWidth:640}}>
  <title id={id}>{`所选理论带宽 ${gb.toLocaleString()} GB/s`}</title>
  <rect x={32} y={16} width={416} height={24} rx={4} fill="var(--analysis-prepared-bg, #edf6f0)"/>
  <line x1={32} y1={40} x2={448} y2={40} stroke="var(--analysis-prepared-stroke, #6c9f88)" strokeWidth={3}/>
  {[0,.5,1].map(f=><g key={f}><line x1={32+416*f} x2={32+416*f} y1={40} y2={46} stroke="currentColor"/><text x={32+416*f} y={65} textAnchor={f===0?'start':f===1?'end':'middle'} fill="currentColor" fontSize={13}>{(gb*f).toLocaleString('zh-CN',{maximumFractionDigits:2})}</text></g>)}
  <text x={240} y={89} textAnchor="middle" fill="currentColor" fontSize={13}>理论带宽（GB/s）</text>
 </svg>;
}
