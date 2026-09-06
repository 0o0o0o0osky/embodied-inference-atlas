import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import type {AnalysisContext} from '../domain/resolveAnalysisContext';
import {InferenceSampleSummary} from './InferenceSampleSummary';
const active={capture:{captureId:'representative'},timeline:{window:{durationNs:170194352}}};
const context=(extra:Record<string,unknown>={})=>({batch:null,traceBatches:[],nsys:{options:[],active},selectedEvidence:null,...extra}) as unknown as AnalysisContext;
it('shows the checked representative without capture choices or a distribution',()=>{
 const html=renderToStaticMarkup(<InferenceSampleSummary context={context({traceSummary:{status:'stable',sampleCount:10,representativeCaptureId:'representative',wall:{medianNs:168812838,cv:0.0288586},hotspots:[{id:'conversion',label:'转换',cv:0.00104548,calls:17,countsMatch:true}]}})}/>);
 expect(html).toContain('稳定代表 trace');expect(html).toContain('170.194');
 expect(html).toContain('2.89%');expect(html).toContain('17 · 一致');
 expect(html).not.toContain('<select');expect(html).not.toContain('<svg');expect(html).not.toContain('历史采集');
});
it('does not claim stability for an unverified or a different trace',()=>{
 for(const extra of [{},{traceSummary:{status:'stable',sampleCount:10,representativeCaptureId:'different',wall:{cv:0.01},hotspots:[]}}]){
  const html=renderToStaticMarkup(<InferenceSampleSummary context={context(extra)}/>);
  expect(html).toContain('已有单次采集 · 稳定性未核验');expect(html).not.toContain('稳定代表 trace');
 }
});
it('distinguishes unavailable traces from unverified captures',()=>{
 const html=renderToStaticMarkup(<InferenceSampleSummary context={context({nsys:{active:null,options:[]}})}/>);
 expect(html).toContain('暂无可用 trace');expect(html).not.toContain('本次墙钟');
});
