import { expect, it } from 'vitest';
import document from '../../../../data/model_graphs/smolvla.json';
import type { CanonicalRecord } from '../../../types/atlas';
import { adaptV1ModelGraph } from '../domain/adaptV1ModelGraph';
import { adaptLogicalDag } from '../domain/adaptLogicalDag';
import { layoutLogicalDag } from '../layout/paperLayout';
import { resolvePresentationProfile } from './registry';

it('aligns SmolVLA input preparation and cross-attention branches with their dependencies', () => {
  const graph = adaptV1ModelGraph(document.records[0] as CanonicalRecord);
  const dag = adaptLogicalDag(graph);
  const layout = layoutLogicalDag(dag, resolvePresentationProfile(graph, dag).presentation);
  const box = (ref: string) => layout.nodeBoxes.get(ref)!;
  const center = (ref: string) => box(ref).x + box(ref).width / 2;
  const prefix = 'prefix-encoder/prompt-prefix-builder';
  expect(center(`${prefix}/embed-prompt`)).toBeCloseTo(center(`${prefix}/prompt-scale`));
  expect(center(`${prefix}/image-language-concat`)).toBeLessThan(center('prefix-encoder/state-token-projector/state-projection'));
  const cross = 'action-flow-decoder/expert-layer-pairs/cross-attention';
  const middle = center(`${cross}/query-projection`);
  expect(center(`${cross}/query-rope`)).toBeCloseTo(middle);
  expect(center(`${cross}/attention`)).toBeCloseTo(middle);
  expect(box(`${cross}/query-projection`).row).toBe(box(`${cross}/flatten-prefix-key`).row);
  expect(box(`${cross}/query-rope`).row).toBe(box(`${cross}/key-adapter`).row);
  for (const side of ['key', 'value']) {
    const chain = [`extract-prefix-${side}`, `flatten-prefix-${side}`, `${side}-adapter`, `rearrange-${side}-heads`];
    for (const id of chain) expect(center(`${cross}/${id}`)).toBeCloseTo(center(`${cross}/${chain[0]}`));
  }
});
