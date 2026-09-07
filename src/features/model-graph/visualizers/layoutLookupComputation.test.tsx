import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import type {OperatorDetail} from '../domain/types';
import {layoutExample,lookupDimensionTile,lookupTable} from './layoutLookupComputation';
import {LayoutVisualizer} from './LayoutVisualizer';
import {EmbeddingLookupVisualizer} from './EmbeddingLookupVisualizer';
const detail={ref:'example/slice',operatorId:'slice',definitionId:'slice',formula:'slice(X)',scopeBindings:{},inputs:[],outputs:[]} as unknown as OperatorDetail;
it('preserves element identity across reshape, transpose, concat and selected-row slice',()=>{
 expect(layoutExample('reshape').indices).toEqual([0,1,2,3,4,5]);
 expect(layoutExample('permute-rearrange').output).toEqual([1,4,2,5,3,6]);
 expect(layoutExample('concat').output).toEqual([1,2,3,4,5,6,7,8,9]);
 expect(layoutExample('slice').indices).toEqual([3,4,5]);
 const html=renderToStaticMarkup(<LayoutVisualizer operator={detail} resetKey="slice"/>);
 expect(html).toContain('物化拷贝');expect(html).toContain('兼容视图');expect(html).toContain('S[3]');
});
it('reads two dimension tiles from the selected id row and exposes clickable positions',()=>{
 expect([...lookupDimensionTile(0,0),...lookupDimensionTile(0,1)]).toEqual(lookupTable[2]);
 expect([...lookupDimensionTile(1,0),...lookupDimensionTile(1,1)]).toEqual(lookupTable[0]);
 const html=renderToStaticMarkup(<EmbeddingLookupVisualizer operator={detail} resetKey="lookup"/>);
 expect(html).toContain('table[ids[i], d]');expect(html).toContain('aria-pressed="true"');
 expect(html).toContain('完成输出行');
});

import {expansionLayoutExample} from './layoutLookupComputation';
import smolDocument from '../../../../data/model_graphs/smolvla.json';
import type {CanonicalRecord} from '../../../types/atlas';
import {adaptV1ModelGraph} from '../domain/adaptV1ModelGraph';
it('separates canonical state zero-padding and time broadcasting from ordinary reshape',()=>{
 const graph=adaptV1ModelGraph(smolDocument.records[0] as CanonicalRecord);
 const pad=[...graph.operatorsByRef.values()].find(d=>d.operatorId==='pad-state')!;
 const broadcast=[...graph.operatorsByRef.values()].find(d=>d.operatorId==='broadcast-time')!;
 expect(expansionLayoutExample('zero-pad').output).toEqual([3,7,0,0]);
 expect(expansionLayoutExample('zero-pad').indices).toEqual([0,1,null,null]);
 expect(expansionLayoutExample('broadcast').output).toEqual([3,7,3,7,3,7]);
 const padded=renderToStaticMarkup(<LayoutVisualizer operator={pad} resetKey="pad"/>);
 expect(padded).toContain('填充零值');expect(padded).not.toMatch(/零步幅视图|0 个元素额外拷贝|兼容视图/);
 const expanded=renderToStaticMarkup(<LayoutVisualizer operator={broadcast} resetKey="broadcast"/>);
 expect(expanded).toContain('零步幅视图');expect(expanded).toContain('物化重复值');
 expect(expanded).toContain('1×50×720');
});

import pi05Document from '../../../../data/model_graphs/pi05.json';
it('uses column examples for parameter and public-width slices, including identity output',()=>{
 const first=layoutExample('slice',{axis:'column',start:0,stop:1,size:3});
 const middle=layoutExample('slice',{axis:'column',start:1,stop:2,size:3});
 const last=layoutExample('slice',{axis:'column',start:2,stop:3,size:3});
 const identity=layoutExample('slice',{axis:'column',start:0,stop:32,size:32});
 expect(first.indices).toEqual([0,3,6]);expect(first.output).toEqual([1,4,7]);
 expect(middle.indices).toEqual([1,4,7]);expect(middle.output).toEqual([2,5,8]);
 expect(last.output).toEqual([3,6,9]);
 expect(identity.output).toEqual([1,2,3,4,5,6,7,8,9]);
 expect([middle.outputRows,middle.outputColumns]).toEqual([3,1]);
 const pi05=adaptV1ModelGraph(pi05Document.records[0] as CanonicalRecord);
 const smol=adaptV1ModelGraph(smolDocument.records[0] as CanonicalRecord);
 const shift=pi05.operatorsByRef.get('action-flow-decoder/action-expert-blocks/attention-adarms/shift-slice')!;
 const render=(operator:OperatorDetail)=>renderToStaticMarkup(<LayoutVisualizer operator={operator} resetKey={operator.ref}/>);
 const shiftMarkup=render(shift);
 expect(shiftMarkup).toContain('取列范围 [1, 2)');expect(shiftMarkup).toContain('S[1]');expect(shiftMarkup).not.toContain('选中行');
 const publicRef='public-output/public-action-slice/public-action-slice';
 expect(render(smol.operatorsByRef.get(publicRef)!)).toContain('取列范围 [0, 1)');
 expect(render(pi05.operatorsByRef.get(publicRef)!)).toContain('取列范围 [0, 3)');
});
