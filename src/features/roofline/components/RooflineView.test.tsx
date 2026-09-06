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
import {RooflineView} from './RooflineView';

it('renders selected non-BF16 defaults and overview from formulas without point snapshots',()=>{
 const models=['pi0','pi05','smolvla'].map(model_id=>({model_id,display_name:model_id})) as ModelRecord[];
 const data={datasets:{models,runtimes:[],runs:[],runtime_realizations:[],profiler_captures:[],timelines:[],kernel_observations:[],roofline_points:[],
  model_graphs:[...pi0.records,...pi05.records,...smolvla.records],roofline_scenarios:scenarios.records,roofline_bases:bases.records,roofline_ceilings:ceilings.records}} as unknown as AtlasData;
 for(const model of models){
  for(const precision of ['fp16_dense','q8_0_weight_only_bf16_compute']){
   const route=readRoute(`?model=${model.model_id}&tab=roofline&precision=${precision}&roofline-level=atomic`);
   const html=renderToStaticMarkup(<RooflineView data={data} model={model} route={route} navigate={()=>{}}/>);
   expect(html).toContain('roofline-analysis-grid');expect(html).not.toContain('No valid point set');
   expect(html).toContain(`basis-${model.model_id}-${precision}-atomic-interactive-`);
   const overview=renderToStaticMarkup(<RooflineView data={data} model={model} route={{...route,rooflineLevel:'overview'}} navigate={()=>{}}/>);
   expect(overview).toContain(`basis-${model.model_id}-${precision}-atomic-interactive-`);
   expect(overview).toContain(`basis-${model.model_id}-${precision}-stage-interactive-`);
  }
 }
 expect((data.datasets.roofline_points as CanonicalRecord[]).length).toBe(0);
});
