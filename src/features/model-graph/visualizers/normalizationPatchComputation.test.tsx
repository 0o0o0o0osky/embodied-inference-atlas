import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import pi0Document from '../../../../data/model_graphs/pi0.json';
import pi05Document from '../../../../data/model_graphs/pi05.json';
import smolvlaDocument from '../../../../data/model_graphs/smolvla.json';
import {PatchVisualizer} from './PatchVisualizer';
import type { CanonicalRecord } from '../../../types/atlas';
import { adaptV1ModelGraph } from '../domain/adaptV1ModelGraph';
import { adaptLogicalDag } from '../domain/adaptLogicalDag';
import { patchProjectionShape } from './patchProjectionShape';
import { RmsNormVisualizer } from './RmsNormVisualizer';

const dag = adaptLogicalDag(adaptV1ModelGraph(pi0Document.records[0] as CanonicalRecord, {V:1}));
const patch = [...dag.nodes.values()].find(node => node.detail?.definitionId === 'patch-embedding')!.detail!;
const rms = [...dag.nodes.values()].find(node => node.detail?.definitionId === 'rms-norm')!.detail!;

it('uses the declared patch shape and rejects unrelated or inconsistent convolutions', () => {
 expect(patchProjectionShape(patch)).toEqual({height:224,width:224,channels:3,patch:14,rows:16,columns:16,tokens:256,embedding:1152});
 const markup=renderToStaticMarkup(<PatchVisualizer operator={patch} resetKey="patch"/>);
 expect(markup).toContain('共享权重 W');expect(markup).toContain('按图像位置排列的 token 序列');
 for(const document of [pi05Document,smolvlaDocument]) {
  const other=adaptLogicalDag(adaptV1ModelGraph(document.records[0] as CanonicalRecord));
  const detail=[...other.nodes.values()].find(node=>node.detail?.definitionId==='patch-embedding')!.detail!;
  expect(patchProjectionShape(detail)).not.toBeNull();
 }
 expect(patchProjectionShape({...patch,definitionId:'conv2d'})).toBeNull();
 expect(patchProjectionShape({...patch,scopeBindings:{...patch.scopeBindings,T:255}})).toBeNull();
 expect(patchProjectionShape({...patch,scopeBindings:{...patch.scopeBindings,P:null}})).toBeNull();
});
it('explains one complete RMS row with a shared scalar and no undeclared affine weight', () => {
 const markup=renderToStaticMarkup(<RmsNormVisualizer operator={rms} resetKey="rms"/>);
 expect(markup).toContain('平方');expect(markup).toContain('rsqrt');expect(markup).toContain('共享');
 expect(markup).toContain('D=4');expect(markup).toContain('0.447');
 expect(markup).not.toMatch(/γ|gamma|减均值/);
 expect(markup).toContain('https://arxiv.org/abs/1910.07467');
});
