import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import type {OperatorDetail} from '../domain/types';
import {layoutExample,lookupDimensionTile,lookupTable} from './layoutLookupComputation';
import {LayoutVisualizer} from './LayoutVisualizer';
import {EmbeddingLookupVisualizer} from './EmbeddingLookupVisualizer';
const detail={definitionId:'slice',formula:'slice(X)',inputs:[],outputs:[]} as unknown as OperatorDetail;
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
