import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {atlasSnapshot as data} from '../../../testSupport/atlasSnapshot';
import {materializeCurrentModelRoofline} from '../presentation/buildOperatorRooflineSummary';
import {Pi0RooflineOverview} from './Pi0RooflineOverview';

it('uses shared stage names and canonical devices for all model theory overviews',()=>{
 for(const modelId of ['pi0','pi05','smolvla']) {
  const result=materializeCurrentModelRoofline({data,modelId,hardwareId:'nvidia-jetson-agx-thor',precisionPathId:'bf16_dense',workloadBinding:null});
  const html=renderToStaticMarkup(<Pi0RooflineOverview data={data} result={result} navigate={()=>{}}/>);
  expect(html).toContain('动作解码器');
  expect(html).toContain('NVIDIA Jetson AGX Thor');
  expect(html).not.toContain('pi0-secondary-bases');
  expect(html).not.toContain('动作流解码器');
 }
});
