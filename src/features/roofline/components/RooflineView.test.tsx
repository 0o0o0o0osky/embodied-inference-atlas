import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {readRoute} from '../../../app/routes';
import type {AtlasData,CanonicalRecord,ModelRecord} from '../../../types/atlas';
import bases from '../../../../data/analysis/roofline_bases.json';
import ceilings from '../../../../data/analysis/roofline_ceilings.json';
import scenarios from '../../../../data/analysis/roofline_scenarios.json';
import pi0 from '../../../../data/model_graphs/pi0.json';
import pi05 from '../../../../data/model_graphs/pi05.json';
import smolvla from '../../../../data/model_graphs/smolvla.json';
import {ModelRooflineAnalysis} from '../../model-graph/components/ModelRooflineAnalysis';
import {OperatorRooflinePanel} from '../../model-graph/components/OperatorRooflinePanel';
import {materializeCurrentModelRoofline} from '../presentation/buildOperatorRooflineSummary';

it('renders precision-specific formulas and numeric ceilings without raw hardware provenance',()=>{
 const models=['pi0','pi05','smolvla'].map(model_id=>({model_id,display_name:model_id})) as ModelRecord[];
 const data={datasets:{models,devices:[],runtimes:[],runs:[],runtime_realizations:[],profiler_captures:[],timelines:[],kernel_observations:[],roofline_points:[],
  model_graphs:[...pi0.records,...pi05.records,...smolvla.records],roofline_scenarios:scenarios.records,roofline_bases:bases.records,roofline_ceilings:ceilings.records}} as unknown as AtlasData;
 for(const model of models){
  for(const precision of ['bf16_dense','fp16_dense','q8_0_weight_only_bf16_compute']){
   const route=readRoute(`?model=${model.model_id}&tab=logical&theoryView=roofline&precision=${precision}&roofline-level=atomic`);
   const html=renderToStaticMarkup(<ModelRooflineAnalysis data={data} model={model} route={route} navigate={()=>{}}/>);
   expect(html).toContain('roofline-analysis-grid');expect(html).not.toContain('No valid point set');
   expect(html).toContain('data-cluster-center="true"');expect(html).toContain('TFLOP/s');expect(html).toContain('GB/s');
   expect(html).toContain('理论分析层级');expect(html).not.toContain('roofline-mode-tabs');expect(html).not.toContain('Roofline &amp; kernels');
   const overview=renderToStaticMarkup(<ModelRooflineAnalysis data={data} model={model} route={{...route,rooflineLevel:'overview'}} navigate={()=>{}}/>);
   expect(overview).toContain('模型解析下界');expect(overview).toContain(precision);
   const result=materializeCurrentModelRoofline({data,modelId:model.model_id,precisionPathId:precision,hardwareId:null,workloadBinding:null});
   if(result.status!=='available')throw new Error(result.reason);
   const gemm=result.value.atomicPoints.find(point=>point.entity.entity_id.endsWith('/up-projection'))!;
   const drawer=renderToStaticMarkup(<OperatorRooflinePanel result={result} logicalRef={gemm.entity.logical_refs[0]!} fullAnalysisLink={null}/>);
   expect(drawer).toContain('data-point-id=');expect(drawer).toContain('TFLOP/s');
   for(const item of [...result.value.ceiling.compute,...result.value.ceiling.bandwidth]){
    if(item.provenance.condition){
     expect(html).not.toContain(item.provenance.condition);
     expect(drawer).not.toContain(item.provenance.condition);
    }
   }
  }
 }
 expect((data.datasets.roofline_points as CanonicalRecord[]).length).toBe(0);
});
