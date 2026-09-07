import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import pi0 from '../../../../data/model_graphs/pi0.json';
import pi05 from '../../../../data/model_graphs/pi05.json';
import smol from '../../../../data/model_graphs/smolvla.json';
import scenarios from '../../../../data/analysis/roofline_scenarios.json';
import ceilings from '../../../../data/analysis/roofline_ceilings.json';
import type {CanonicalRecord} from '../../../types/atlas';
import type {RooflineScenarioRecord,RooflineCeilingRecord} from '../../roofline/domain/types';
import {adaptV1ModelGraph} from '../domain/adaptV1ModelGraph';
import {OperatorExecutionEstimate,supportsExecutionEstimate} from './OperatorExecutionEstimate';
import {remainingOperatorKinds} from '../../roofline/domain/remainingOperatorEstimate';
const ceiling=ceilings.records.find(c=>c.ceiling_id==='thor-t5000-120w-1386mhz') as unknown as RooflineCeilingRecord;
it('renders every added default operator instance in all three real models',()=>{
 for(const document of [pi0,pi05,smol]) {
  const record=document.records[0] as unknown as CanonicalRecord;
  const graph=adaptV1ModelGraph(record);
  const scenario=scenarios.records.find(s=>s.model_id===record.model_id&&s.precision_path.precision_path_id==='bf16_dense') as unknown as RooflineScenarioRecord;
  expect(scenario).toBeTruthy();
  const definitions=new Set<string>();
  for(const detail of graph.operatorsByRef.values()) {
   if(detail.definitionId==='linear')continue;
   definitions.add(detail.definitionId);
   expect(supportsExecutionEstimate(detail)).toBe(true);
   const html=renderToStaticMarkup(<OperatorExecutionEstimate detail={detail} scenario={scenario} ceiling={ceiling} bandwidth={273e9}/>);
   if(detail.operatorId==='pad-state'){expect(html).toContain('补零与物化写入');expect(html).not.toContain('0 B 额外拷贝');}
   expect(html,detail.ref+JSON.stringify([detail.inputs.map(p=>p.tensor?.shape),detail.outputs.map(p=>p.tensor?.shape)])).not.toMatch(/形状待补充|NaN|Infinity/);
   if([...remainingOperatorKinds,'permute-rearrange'].includes(detail.definitionId))expect(html,detail.ref).toContain(detail.definitionId==='token-embedding'?'查表理论成本':detail.definitionId==='permute-rearrange'?'0 B 额外拷贝':'data-point-id="remaining-operator"');
  }
  expect(definitions.size).toBe(document===smol?17:15);
 }
});

it('keeps token lookup encoded weights out of a plain-byte reference',()=>{
 const graph=adaptV1ModelGraph(pi0.records[0] as unknown as CanonicalRecord);
 const detail=[...graph.operatorsByRef.values()].find(d=>d.definitionId==='token-embedding')!;
 const source=scenarios.records.find(s=>s.model_id==='pi0'&&s.precision_path.precision_path_id==='bf16_dense') as unknown as RooflineScenarioRecord;
 for(const field of ['tensor_scale_bytes','scale_bytes_per_block','zero_point_bytes_per_block'] as const){
  const scenario=structuredClone(source);scenario.precision_path.segments[0]!.weight[field]=4;
  const html=renderToStaticMarkup(<OperatorExecutionEstimate detail={detail} scenario={scenario} ceiling={ceiling} bandwidth={273e9}/>);
  expect(html).toContain('当前编码成本待补充');expect(html).not.toContain('查表理论成本');
 }
});
