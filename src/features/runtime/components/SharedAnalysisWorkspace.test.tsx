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
 expect(markup).toContain('固定输入下的性能比较');expect(markup).toContain('没有符合所选口径');
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
