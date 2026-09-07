import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import smol from '../../../../data/model_graphs/smolvla.json';
import pi0 from '../../../../data/model_graphs/pi0.json';
import type {CanonicalRecord} from '../../../types/atlas';
import {adaptV1ModelGraph} from '../domain/adaptV1ModelGraph';
import {PositionVisualizer} from './PositionVisualizer';
it('keeps standalone time embedding separate from a subsequent broadcast node',()=>{
 const detail=(document:typeof smol|typeof pi0)=>[...adaptV1ModelGraph(document.records[0] as CanonicalRecord).operatorsByRef.values()].find(d=>d.definitionId==='sinusoidal-time-embedding')!;
 const smolDetail=detail(smol);
 expect(smolDetail.outputs[0]!.tensor!.shape).toEqual([1,720]);
 const html=renderToStaticMarkup(<PositionVisualizer operator={smolDetail} resetKey="smol-time"/>);
 expect(html).toContain('写出时间向量');expect(html).not.toContain('广播到动作位置');
 const pi0Detail=detail(pi0);
 const pi0Html=renderToStaticMarkup(<PositionVisualizer operator={pi0Detail} resetKey="pi0-time"/>);
 const shape=pi0Detail.outputs[0]!.tensor!.shape;
 expect(shape).toEqual([1,50,1024]);expect(pi0Html).toContain('广播到动作位置');
});
