import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import type {AnalysisContext} from '../domain/resolveAnalysisContext';
import {STABILITY_LIMIT} from '../domain/analysisSamples';
import {InferenceSampleSummary} from './InferenceSampleSummary';
const active={capture:{captureId:'representative'},timeline:{window:{durationNs:170194352}}};
const context=(extra:Record<string,unknown>={})=>({batch:null,nsys:{options:[],active},selectedEvidence:null,...extra}) as unknown as AnalysisContext;
it('shows the checked representative without capture choices or a distribution',()=>{
 const html=renderToStaticMarkup(<InferenceSampleSummary context={context({traceSummary:{status:'stable',sampleCount:10,representativeCaptureId:'representative',wall:{medianNs:168812838,cv:0.0288586},hotspots:[{id:'conversion',label:'转换',cv:0.00104548,calls:17,countsMatch:true}]}})}/>);
 expect(html).toContain('稳定代表 trace');expect(html).toContain('170.194');
 expect(html).toContain('耗时波动');expect(html).toContain('标准差 ÷ 平均耗时');expect(html).not.toContain('墙钟 CV');
 expect(html).toContain('2.89%');expect(html).toContain('17 · 一致');
 expect(html).not.toContain('<select');expect(html).not.toContain('<svg');expect(html).not.toContain('历史采集');
});
it('distinguishes absent, failed and unrelated summaries',()=>{
 const cases=[
  {summary:null,label:'稳定性摘要待导入'},
  {summary:{status:'stable',representativeCaptureId:'different'},label:'稳定性未核验'},
  {summary:{status:'unstable'},label:'波动未通过检查'},
  {summary:{status:'incomplete'},label:'样本或覆盖不完整'},
 ];
 for(const testCase of cases){
  const traceSummary=testCase.summary?{sampleCount:10,wall:{cv:0.01},hotspots:[],...testCase.summary}:null;
  const html=renderToStaticMarkup(<InferenceSampleSummary context={context({traceSummary})}/>);
  expect(html).toContain(`已有单次采集 · ${testCase.label}`);
  expect(html).not.toContain('稳定代表 trace');
  if(traceSummary){
   expect(html).not.toContain('稳定性摘要待导入');
   expect(html).toContain('耗时波动定义');
   expect(html).toContain(`当前检查门槛为 ${STABILITY_LIMIT*100}%`);
  }
 }
});
it('distinguishes unavailable traces from unverified captures',()=>{
 const html=renderToStaticMarkup(<InferenceSampleSummary context={context({nsys:{active:null,options:[]}})}/>);
 expect(html).toContain('暂无可用 trace');expect(html).not.toContain('本次总耗时');
});
