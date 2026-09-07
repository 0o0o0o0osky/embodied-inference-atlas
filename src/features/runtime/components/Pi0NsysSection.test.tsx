import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {atlasSnapshot as data} from '../../../testSupport/atlasSnapshot';
import {readRoute} from '../../../app/routes';
import {resolveAnalysisContext} from '../domain/resolveAnalysisContext';
import {Pi0NsysSection} from './Pi0NsysSection';
const model=data.datasets.models.find(row=>row.model_id==='pi0')!;
const record=data.datasets.model_graphs.find(row=>row.model_id==='pi0')!;
const route=readRoute('?model=pi0&runtime=flashrt&runtimePrecision=mixed-fp8-e4m3-fp16&workload=config-pi0-flashrt-nsys-node-002');
const view=resolveAnalysisContext({data,model,record,route}).nsys;
const render=(value= view)=>renderToStaticMarkup(<Pi0NsysSection view={value} onSelectEvent={()=>undefined} onOpenDetails={()=>undefined}/>);
it('shows unresolved sample records as a short capture fact and renders aligned overlap columns',()=>{
 expect(view.active!.timeline.cpuSamples).toHaveLength(3);
 const markup=render();
 expect(markup).toContain('3 条，未分到具体函数');
 expect(markup).not.toContain('当前 trace 的 CPU 函数采样');
 expect(markup).not.toContain('100.0%');
 expect(markup).toContain('<th scope="col">统计项</th>');
 expect(markup).toContain('<th scope="col">耗时</th>');
 expect(markup).toContain('<th scope="col">说明</th>');
 expect(markup).not.toContain('pi0-nsys-ledger');
});
it('includes unattributed sample weight in the denominator when known functions are present',()=>{
 const first=view.active!.timeline.cpuSamples![0]!;
 const samples=[{...first,weight:2,frames:[{...first.frames[0]!,depth:0,labelSanitized:'cuda-runtime'}]},
  {...first,weight:3,frames:[{...first.frames[0]!,depth:0,labelSanitized:'other'}]}];
 const mixed={...view,active:{...view.active!,timeline:{...view.active!.timeline,cpuSamples:samples}}};
 const markup=render(mixed);
 expect(markup).toContain('当前 trace 的 CPU 函数采样');
 expect(markup).toContain('40.0%');expect(markup).toContain('60.0%');
 const table=markup.match(/<table class="system-sample-table">[\s\S]*?<\/table>/)?.[0] ?? '';
 expect(table).toContain('采样权重');expect(table).not.toContain('2 个');
});
