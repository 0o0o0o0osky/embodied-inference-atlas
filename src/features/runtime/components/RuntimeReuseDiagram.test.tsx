import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import type {LogicalDag} from '../../model-graph/domain/types';
import type {RuntimeRealizationRecord} from '../domain/types';
import {RuntimeReuseDiagram} from './RuntimeReuseDiagram';
it('selects structured reuse with equal lifecycle stages and no duplicate generic objects',()=>{
 const realization={modelId:'pi0',executionGroups:[],mappings:[],launch:{cudaGraphState:'present',submissionMode:'cuda_graph_replay',evidenceIds:[]},evidence:[],reuse:[{reuseId:'kv',label:'前缀 K/V 已确认',kind:'computed_result',producerRefs:['prefix'],consumerRefs:['solver'],lifetime:'observation',repeatScope:'当前观测的10次去噪',valueDependencies:['图像'],invalidationConditions:['图像变化'],implementationStatus:'implemented',evidenceIds:[],storageBytes:0,preparationNs:null,readNs:null}]} as unknown as RuntimeRealizationRecord;
 const markup=renderToStaticMarkup(<RuntimeReuseDiagram dag={{nodes:new Map()} as unknown as LogicalDag} realization={realization}/>);
 expect(markup).toContain('选择复用对象');expect(markup).toContain('下一阶段');
 expect(markup).not.toContain('prefix');expect(markup).not.toContain('solver');expect(markup).toContain('未记录算子');expect(markup).toContain('0 B');
 expect(markup).not.toContain('模型计算机制 · 当前栈实现待核对');
 expect(markup).not.toContain('准备时捕获，预测时提交');
 expect(markup).toContain('<details class="reuse-evidence">');
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
