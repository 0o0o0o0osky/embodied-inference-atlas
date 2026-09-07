import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import graphDoc from '../../../../data/model_graphs/pi0.json';
import ceilingDoc from '../../../../data/analysis/roofline_ceilings.json';
import scenarioDoc from '../../../../data/analysis/roofline_scenarios.json';
import {adaptV1ModelGraph} from '../domain/adaptV1ModelGraph';
import type {CanonicalRecord} from '../../../types/atlas';
import type {RooflineCeilingRecord,RooflineScenarioRecord} from '../../roofline/domain/types';
import {OperatorExecutionEstimate} from './OperatorExecutionEstimate';
import {OperatorRooflinePanel} from './OperatorRooflinePanel';

const graph=adaptV1ModelGraph(graphDoc.records[0] as unknown as CanonicalRecord,{V:1,L_PROMPT:48,T_ACTION:50,N_DENOISE:10});
const detail=[...graph.operatorsByRef.values()].find(d=>d.definitionId==='attention-core' && d.ref.startsWith('prefix'))!;
const scenario=scenarioDoc.records.find(s=>s.model_id==='pi0' && s.precision_path.precision_path_id==='bf16_dense') as unknown as RooflineScenarioRecord;
const ceiling=ceilingDoc.records.find(c=>c.operating_point.operating_point_id==='thor-120w-1386mhz-analytical') as unknown as RooflineCeilingRecord;

it('renders the two real formula paths through the operator drawer even without legacy point rows',()=>{
 const html=renderToStaticMarkup(<OperatorRooflinePanel detail={detail} logicalRef={detail.ref} fullAnalysisLink={<a href="#expanded">展开</a>} result={{status:'available',value:{scenario,ceiling,bandwidthCeiling:ceiling.bandwidth[0]!,atomicPoints:[]} as never}}/>);
 expect(html).toContain('三阶段分项');expect(html).toContain('理想融合');expect(html).toContain('ar-point ar-separate');expect(html).toContain('ar-point ar-fused');
 expect(html).toContain('单次调用');expect(html).toContain('特殊函数使用参考速率');expect(html).not.toContain('部分下界');expect(html).not.toMatch(/NaN|Infinity/);
 const withRepeat=renderToStaticMarkup(<OperatorExecutionEstimate detail={{...detail,effectiveRepeat:1000}} scenario={scenario} ceiling={ceiling} bandwidth={273e9}/>);
 const single=renderToStaticMarkup(<OperatorExecutionEstimate detail={{...detail,effectiveRepeat:1}} scenario={scenario} ceiling={ceiling} bandwidth={273e9}/>);
 expect(withRepeat).toBe(single);
});
it('keeps unsupported hardware explicit while preserving the two paths and modeled traffic',()=>{
 const html=renderToStaticMarkup(<OperatorExecutionEstimate detail={detail} scenario={scenario} ceiling={{...ceiling,device_id:'other-device'}} bandwidth={273e9}/>);
 expect(html).toContain('三阶段分项');expect(html).toContain('全局读写');expect(html).toContain('速率待补充');expect(html).not.toContain('ar-point');
});
