import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import { atlasSnapshot as atlas } from '../../../testSupport/atlasSnapshot';
import type {AtlasData} from '../../../types/atlas';
import {readRoute} from '../../../app/routes';
import {RuntimeView} from '../RuntimeView';
import {Workbench} from '../../workbench/Workbench';
import {AtlasHeader} from '../../../components/AtlasHeader';
const data=atlas as unknown as AtlasData;
it('uses the Chinese comparison shell for Pi0.5 without importing the Pi0 target grid',()=>{
 const model=data.datasets.models.find(item=>item.model_id==='pi05')!;
 const route=readRoute('?model=pi05&tab=runtime');
 const markup=renderToStaticMarkup(<Workbench data={data} model={model} route={route} navigate={()=>undefined}/>);
 expect(markup).toContain('推理耗时对比');expect(markup).toContain('当前采样口径暂无测量');
 expect(markup).not.toContain('Model workbench / stable route');expect(markup).not.toContain('Runtime realization overlay');expect(markup).not.toContain('目标点实测');
});
it('uses the same system/DAG/reuse navigation with the actual SmolVLA workload',()=>{
 const model=data.datasets.models.find(item=>item.model_id==='smolvla')!;
 const run=data.datasets.runs.find(item=>item.run_id==='run-lerobot-smolvla-matrix-001')!;
 const route=readRoute(`?model=smolvla&tab=runtime&runtime=${run.runtime_id}&runtimePrecision=${run.precision.precision_id}&hardware=${run.device_id}&workload=${run.configuration_id}&selectedRun=${run.run_id}`);
 const markup=renderToStaticMarkup(<RuntimeView data={data} model={model} route={route} navigate={()=>undefined}/>);
 expect(markup).toContain('系统耗时');expect(markup).toContain('执行 DAG');expect(markup).toContain('执行优化');
 expect(markup).not.toContain('稳定代表 trace');expect(markup).toContain('暂无可用 trace');
 expect(markup).toContain('已有原生证据');expect(markup).not.toContain('Pi0 推理栈实现图');
 expect(markup).not.toContain('P=48、N=10、A=20/50');
 expect(markup).not.toContain('>opaque<');expect(markup).not.toContain('>preserved<');expect(markup).not.toContain('MIXED BF16 FP32/FP32');
});

it('does not claim a representative trace for Pi0.5 without a capture',()=>{
 const model=data.datasets.models.find(item=>item.model_id==='pi05')!;
 const route=readRoute('?model=pi05&tab=runtime&runtime=flashrt');
 const markup=renderToStaticMarkup(<RuntimeView data={data} model={model} route={route} navigate={()=>undefined}/>);
 expect(markup).not.toContain('稳定代表 trace');expect(markup).toContain('暂无可用 trace');
});

it('keeps the two main entries and compact context for every runtime model',()=>{
 for(const model of ['pi0','pi05','smolvla']){
  const route=readRoute(`?model=${model}&tab=runtime&runtime=vla-cpp&runtimePrecision=q8_0-weight-only`);
  const markup=renderToStaticMarkup(<AtlasHeader data={data} route={route} navigate={()=>undefined}/>);
  expect(markup).toContain('模型理论');expect(markup).toContain('运行表现');expect(markup).toContain('atlas-context');
  if(model==='pi0')expect(markup).toContain('Q8_0 仅权重量化 / FP32 激活');
 }
});

it('shows measured FlashRT system metrics without empty bounds or audit boilerplate',()=>{
 const model=data.datasets.models.find(item=>item.model_id==='pi0')!;
 const run=data.datasets.runs.find(item=>item.run_id==='run-pi0-flashrt-fixed-e2e-001')!;
 const route=readRoute(`?model=pi0&tab=runtime&runtime=flashrt&runtimePrecision=${run.precision.precision_id}&hardware=${run.device_id}&workload=${run.configuration_id}&selectedRun=${run.run_id}&analysisView=system`);
 const markup=renderToStaticMarkup(<RuntimeView data={data} model={model} route={route} navigate={()=>undefined}/>);
 expect(markup).toContain('Nsys 采集统计 · 10 次中位数');
 expect(markup).toContain('各线程实际运行时间之和');
 expect(markup).toContain('GPU 活动时长');expect(markup).toContain('CUDA API 调用时长');
 expect(markup).not.toContain('system-bound-status');
 expect(markup).not.toContain('调度运行不等于函数归因');
 expect(markup).not.toContain('局部覆盖不代表端到端下界');
 expect(markup).not.toContain('前端差异不合并成同一次实测流程');
});

// Missing structure must preserve the same navigation and valid measured evidence.
it('keeps system analysis available without a model DAG',()=>{
 const scoped={...data,datasets:{...data.datasets,model_graphs:[]}};
 const model=data.datasets.models.find(item=>item.model_id==='pi0')!;
 const route=readRoute('?model=pi0&tab=runtime&runtime=flashrt&runtimePrecision=mixed-fp8-e4m3-fp16&workload=config-pi0-flashrt-nsys-node-002');
 const html=renderToStaticMarkup(<RuntimeView data={scoped} model={model} route={route} navigate={()=>undefined}/>);
 expect(html).toContain('Nsys 采集统计 · 10 次中位数');
 expect(html).toContain('返回性能对比');expect(html).toContain('执行 DAG');
 expect(html).toContain('data-analysis-state="not_recorded"');
 expect(html).not.toContain('运行表现暂不可用');
});
it('uses the shared shell and concrete placeholders for a new model with no filled analysis',()=>{
 const model={...data.datasets.models[0]!,model_id:'new-model',display_name:'New model'};
 const scoped={...data,datasets:{...data.datasets,models:[...data.datasets.models,model]}};
 const route=readRoute('?model=new-model&tab=runtime&runtime=flashrt');
 const html=renderToStaticMarkup(<RuntimeView data={scoped} model={model} route={route} navigate={()=>undefined}/>);
 expect(html).toContain('输入形状尚未填写');expect(html).toContain('系统流程');
 expect(html).toContain('补充 CPU/GPU 模块');expect(html).toContain('系统时间线尚未采集');
 expect(html).toContain('执行优化');expect(html).toContain('返回性能对比');
 expect(html).not.toContain('canonical 逻辑图');expect(html).not.toContain('稳定代表 trace');
 expect(html).not.toContain('0.000 ms');expect(html).not.toContain('当前配置无匹配测量');
});
it('distinguishes another-input capture from no capture or confirmed unsupported shape',()=>{
 const model=data.datasets.models.find(item=>item.model_id==='pi0')!;
 const route=readRoute('?model=pi0&tab=runtime&runtime=vla-cpp&runtimePrecision=bf16&workload=v=2,p=48,a=50,n=10');
 const html=renderToStaticMarkup(<RuntimeView data={data} model={model} route={route} navigate={()=>undefined}/>);
 expect(html).toContain('当前输入暂无系统时间线');expect(html).toContain('data-analysis-state="no_match"');
 expect(html).not.toContain('Nsys 采集统计 · 10 次中位数');
});

it('uses one theory workspace, context and interaction contract for all three models',()=>{
 for(const modelId of ['pi0','pi05','smolvla']){
  const model=data.datasets.models.find(item=>item.model_id===modelId)!;
  const route=readRoute(`?model=${modelId}&tab=logical&precision=bf16_dense`);
  const html=renderToStaticMarkup(<><AtlasHeader data={data} route={route} navigate={()=>undefined}/><Workbench data={data} model={model} route={route} navigate={()=>undefined}/></>);
  expect(html).toContain('model-workbench');expect(html).toContain('model-graph-workspace model-workspace');
  expect(html.match(/class="atlas-context"/g)).toHaveLength(1);
  expect(html.match(/class="graph-scenario-editor"/g)).toHaveLength(1);
  expect(html).toContain('模型图工具栏');expect(html).toContain('模型理论下界');expect(html).toContain('Ctrl + 滚轮缩放');
  expect(html).not.toContain('logical-intro');expect(html).not.toContain('Workload bindings');
  expect(html).not.toContain('Model workbench / stable route');
 }
});
it('retains the shared theory shell and local missing state when a model has no graph',()=>{
 const model={...data.datasets.models[0]!,model_id:'unfilled-model',display_name:'未填写模型'};
 const route=readRoute('?model=unfilled-model&tab=logical');
 const html=renderToStaticMarkup(<Workbench data={data} model={model} route={route} navigate={()=>undefined}/>);
 expect(html).toContain('model-workspace');expect(html).toContain('模型结构尚未填写');
 expect(html).toContain('data-analysis-state="not_recorded"');expect(html).not.toContain('data-layout-fingerprint');
});
