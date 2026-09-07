import {expect,it} from 'vitest';
import pi0Document from '../../../../data/model_graphs/pi0.json';
import type {CanonicalRecord} from '../../../types/atlas';
import {adaptV1ModelGraph} from '../../model-graph/domain/adaptV1ModelGraph';
import {adaptLogicalDag} from '../../model-graph/domain/adaptLogicalDag';
import {attentionShapeFromDetail} from './attentionInput';

const dag=adaptLogicalDag(adaptV1ModelGraph(pi0Document.records[0] as CanonicalRecord,{V:1,L_PROMPT:48,T_ACTION:50}));
const prefix=[...dag.nodes.values()].find(node=>node.stageId==='prefix-encoder' && node.detail?.definitionId==='attention-core')!.detail!;

it('resolves canonical Pi0 GQA dimensions for one selected invocation',()=>{
 expect(attentionShapeFromDetail(prefix)).toEqual({batch:1,queryHeads:8,kvHeads:1,queryTokens:304,keyTokens:304,qkDimension:256,valueDimension:256});
});

it('keeps missing or inconsistent K width unavailable instead of borrowing Q width',()=>{
 const key=prefix.inputs.find(port=>port.port==='key')!.tensor!;
 const axis=key.axes.findIndex(axis=>['head_width','head_dim'].includes(axis.axis));
 expect(axis).toBeGreaterThanOrEqual(0);
 for (const width of [128,null]) {
  const inputs=prefix.inputs.map(port=>port.port==='key'?{...port,tensor:{...key,shape:key.shape.map((size,i)=>i===axis?width:size)}}:port);
  expect(attentionShapeFromDetail({...prefix,inputs})).toBeNull();
 }
});
