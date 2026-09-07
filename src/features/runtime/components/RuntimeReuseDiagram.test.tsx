import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import type {LogicalDag} from '../../model-graph/domain/types';
import type {RuntimeRealizationRecord} from '../domain/types';
import {RuntimeReuseDiagram} from './RuntimeReuseDiagram';
import {atlasSnapshot} from '../../../testSupport/atlasSnapshot';
import {adaptRuntimeRealization} from '../domain/adaptRuntimeRealization';
it('explains recorded reuse directly without stage controls, unknown costs or duplicate objects',()=>{
 const realization={modelId:'pi0',executionGroups:[],mappings:[],launch:{cudaGraphState:'present',submissionMode:'cuda_graph_replay',evidenceIds:[]},evidence:[],reuse:[{reuseId:'kv',label:'前缀 K/V 已确认',kind:'computed_result',producerRefs:['prefix'],consumerRefs:['solver'],lifetime:'observation',repeatScope:'当前观测的10次去噪',valueDependencies:['图像'],invalidationConditions:['图像变化'],implementationStatus:'implemented',evidenceIds:[],storageBytes:0,preparationNs:null,readNs:null}]} as unknown as RuntimeRealizationRecord;
 const markup=renderToStaticMarkup(<RuntimeReuseDiagram dag={{nodes:new Map()} as unknown as LogicalDag} realization={realization}/>);
 expect(markup).toContain('当前做法');expect(markup).toContain('减少的重复工作');expect(markup).toContain('何时重做');
 expect(markup).not.toContain('选择复用对象');expect(markup).not.toContain('下一阶段');
 expect(markup).not.toContain('prefix');expect(markup).not.toContain('solver');expect(markup).not.toContain('未记录算子');expect(markup).toContain('0 B');
 expect(markup).not.toContain('模型计算机制 · 当前栈实现待核对');
 expect(markup).not.toContain('准备时捕获，预测时提交');
 expect(markup).not.toContain('参考来源');expect(markup).not.toContain('准备：');expect(markup).not.toContain('读取：');
});
it('does not insert Pi0 prefix assumptions for another model without reuse evidence',()=>{
 const realization={modelId:'smolvla',mappings:[],launch:{cudaGraphState:'unknown',submissionMode:'none',evidenceIds:[]},evidence:[]} as unknown as RuntimeRealizationRecord;
 const markup=renderToStaticMarkup(<RuntimeReuseDiagram dag={{nodes:new Map()} as unknown as LogicalDag} realization={realization}/>);
 expect(markup).not.toContain('Prefix K/V');expect(markup).not.toContain('图像、文本与状态');
});
it('translates audited dependency and invalidation labels without changing unknown evidence',()=>{
 const realization={mappings:[],launch:{cudaGraphState:'unknown',submissionMode:'none',evidenceIds:[]},evidence:[],reuse:[{reuseId:'native-time-embedding-observation',label:'时间嵌入',kind:'computed_result',producerRefs:[],consumerRefs:[],lifetime:'observation',repeatScope:'本次预测',valueDependencies:['timestep schedule','embedding width','chunk length','sinusoidal embedding parameters','untranslated evidence'],invalidationConditions:['next predict recomputes and uploads all timestep embeddings','schedule or embedding shape changes'],implementationStatus:'implemented',evidenceIds:[],storageBytes:null,preparationNs:null,readNs:null}]} as unknown as RuntimeRealizationRecord;
 const markup=renderToStaticMarkup(<RuntimeReuseDiagram dag={{nodes:new Map()} as unknown as LogicalDag} realization={realization}/>);
 expect(markup).toContain('时间步计划');expect(markup).toContain('下一次预测重新计算并上传全部时间步嵌入');
 expect(markup).not.toContain('sinusoidal embedding parameters');expect(markup).toContain('untranslated evidence');
});

it('shows FlashRT extra optimizations and a single pinned version, without routine prefix KV sharing',()=>{
 const realization=adaptRuntimeRealization(atlasSnapshot.datasets.runtime_realizations.find(record=>record.realization_id==='rr-flashrt-pi0-thor-fp8-v1')!);
 const markup=renderToStaticMarkup(<RuntimeReuseDiagram dag={{nodes:new Map()} as unknown as LogicalDag} realization={realization} sources={atlasSnapshot.datasets.sources}/>);
 const primary=markup;
 expect(primary).toContain('时间嵌入与投影预计算');expect(primary).toContain('CUDA Graph 提交');
 expect(primary).toContain('后续观测继续使用');expect(primary).toContain('后续观测沿用计划');
 expect(primary).toContain('固定10步');expect(primary).toContain('视觉和主推理两张图');
 expect(primary).not.toContain('前缀 K/V');
 expect(markup).not.toContain('基础计算机制');expect(markup).not.toContain('前缀 K/V');
 expect(markup).toContain('时间预计算前后对照');expect(markup).toContain('CUDA Graph 提交前后对照');
 expect(markup).toContain('sin / cos');expect(markup).toContain('时间投影 + 偏置');
 expect(markup).toContain('读取当前步结果');expect(markup).toContain('动作分支投影');
 expect(markup).toContain('SiLU');expect(markup).toContain('输出投影');
 expect(markup).toContain('<details class="optimization-version">');
 expect(markup).toContain('https://github.com/flashrt-project/FlashRT/commit/054bea4d02ebc63f6a0c45991c6061b1e1caa46c');
 expect(markup.match(/<a /g)).toHaveLength(1);expect(markup).toContain('commit 054bea4');
 expect(markup).not.toContain('参考来源');expect(markup).not.toContain('准备：');expect(markup).not.toContain('下一阶段');
});

it('describes Graph submission from the recorded launch mode and preserves per-observation preparation',()=>{
 const realtime=adaptRuntimeRealization(atlasSnapshot.datasets.runtime_realizations.find(record=>record.realization_id==='rr-realtime-vla-pi0-thor-bf16-v1')!);
 const native=adaptRuntimeRealization(atlasSnapshot.datasets.runtime_realizations.find(record=>record.realization_id==='rr-vla-cpp-pi0-thor-bf16-f32-v1')!);
 const render=(realization:RuntimeRealizationRecord)=>renderToStaticMarkup(<RuntimeReuseDiagram dag={{nodes:new Map()} as unknown as LogicalDag} realization={realization}/>);
 expect(render({...realtime,reuse:realtime.reuse!.filter(item=>item.kind==='execution_plan')})).toContain('减少逐个 Kernel 提交');
 const perPrediction=render({...native,reuse:native.reuse!.filter(item=>item.producerRefs.some(ref=>ref.endsWith('/time-embedding')))});
 expect(perPrediction).toContain('每次观测重新准备');expect(perPrediction).toContain('下一次预测重新计算与上传');
 expect(perPrediction).not.toContain('后续观测继续使用');
});
