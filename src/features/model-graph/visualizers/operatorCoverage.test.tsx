import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import pi0 from '../../../../data/model_graphs/pi0.json';
import pi05 from '../../../../data/model_graphs/pi05.json';
import smolvla from '../../../../data/model_graphs/smolvla.json';
import type {CanonicalRecord} from '../../../types/atlas';
import {adaptV1ModelGraph} from '../domain/adaptV1ModelGraph';
import {OperatorVisualizer} from './OperatorVisualizer';

it('provides a computation walkthrough for every operator kind present in the three model DAGs',()=>{
 for(const document of [pi0,pi05,smolvla]) {
  const graph=adaptV1ModelGraph(document.records[0] as CanonicalRecord);
  const kinds=new Map([...graph.operatorsByRef.values()].map(detail=>[detail.definitionId,detail]));
  for(const [kind,operator] of kinds) {
   const html=renderToStaticMarkup(<OperatorVisualizer operator={operator} resetKey={operator.ref}/>);
   expect(html,`${graph.modelId}: ${kind}`).toContain('computation-stepper');
   expect(html).not.toMatch(/逐步计算图未填写|NaN|Infinity/);
  }
 }
});
