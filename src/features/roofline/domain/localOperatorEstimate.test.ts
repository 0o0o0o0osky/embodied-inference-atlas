import {expect,it} from 'vitest';
import type {OperatorDetail} from '../../model-graph/domain/types';
import {localOperatorWork} from './localOperatorEstimate';
import graphDoc from '../../../../data/model_graphs/pi0.json';
import type {CanonicalRecord} from '../../../types/atlas';
import {adaptV1ModelGraph} from '../../model-graph/domain/adaptV1ModelGraph';

const tensor=(shape:number[],tensorId='x')=>({shape,tensorId});
const detail=(definitionId:string,inputs:number[][],output:number[])=>({definitionId,formula:'x_next = x + dt*v, dt=-1/N_DENOISE',inputs:inputs.map((s,i)=>({tensor:tensor(s,String(i))})),outputs:[{tensor:tensor(output,'y')}],scopeBindings:{N_DENOISE:10},effectiveRepeat:180}) as unknown as OperatorDetail;
it('counts broadcast arithmetic and one-call boundary traffic independently of repeat',()=>{
 expect(localOperatorWork(detail('elementwise-multiply',[[2,4],[4]],[2,4]),2,2,2)).toMatchObject({flop:8,bytes:40,resource:'scalar'});
 expect(localOperatorWork(detail('euler-update',[[2,4],[2,4]],[2,4]),2,2,2)).toMatchObject({flop:16,bytes:48,resource:'fma'});
 expect(localOperatorWork(detail('euler-update',[[1,4],[2,4]],[2,4]),2,2,2)).toBeNull();
 expect(localOperatorWork({...detail('euler-update',[[2,4],[2,4]],[2,4]),formula:'x_next = x - dt*v'},2,2,2)).toBeNull();
 expect(localOperatorWork(detail('residual-add',[[2,4],[3]],[2,4]),2,2,2)).toBeNull();
});

it('models patch projection as shared weights without an im2col buffer',()=>{
 const graph=adaptV1ModelGraph(graphDoc.records[0] as CanonicalRecord,{V:1});
 const patch=[...graph.operatorsByRef.values()].find(d=>d.definitionId==='patch-embedding')!;
 const work=localOperatorWork(patch,2,2,2)!;
 expect(work.flop).toBe(2*256*588*1152);
 expect(work.bytes).toBe(2*(224*224*3+588*1152+256*1152));
 expect(work.resource).toBe('matrix');
 expect(localOperatorWork({...patch,effectiveRepeat:999},2,2,2)).toEqual(work);
});
