import { expect, it } from 'vitest';
import document from '../../../../data/model_graphs/smolvla.json';
import type { CanonicalRecord } from '../../../types/atlas';
import { adaptV1ModelGraph } from '../domain/adaptV1ModelGraph';
import { adaptLogicalDag } from '../domain/adaptLogicalDag';
import { layoutLogicalDag } from '../layout/paperLayout';
import { resolvePresentationProfile } from './registry';

it('keeps SmolVLA attention channels Q/K/V and RoPE/adapter branches in their own columns', () => {
  const graph = adaptV1ModelGraph(document.records[0] as CanonicalRecord);
  const dag = adaptLogicalDag(graph);
  const layout = layoutLogicalDag(dag, resolvePresentationProfile(graph, dag).presentation);
  const x = (ref: string) => { const box = layout.nodeBoxes.get(ref)!; return box.x + box.width / 2; };
  for (const scope of ['vision-encoder/vision-blocks/self-attention', 'prefix-encoder/prefix-blocks/self-attention', 'action-flow-decoder/expert-layer-pairs/self-attention']) {
    expect(x(`${scope}/query-projection`)).toBeLessThan(x(`${scope}/key-projection`));
    expect(x(`${scope}/key-projection`)).toBeLessThan(x(`${scope}/value-projection`));
    if (dag.nodes.has(`${scope}/query-rope`)) {
      expect(x(`${scope}/query-rope`)).toBeCloseTo(x(`${scope}/query-projection`));
      expect(x(`${scope}/key-rope`)).toBeCloseTo(x(`${scope}/key-projection`));
    }
  }
  const cross = 'action-flow-decoder/expert-layer-pairs/cross-attention';
  expect(x(`${cross}/query-projection`)).toBeLessThan(x(`${cross}/key-adapter`));
  expect(x(`${cross}/key-adapter`)).toBeLessThan(x(`${cross}/value-adapter`));
  expect(x(`${cross}/query-rope`)).toBeCloseTo(x(`${cross}/query-projection`));
  expect(x(`${cross}/flatten-prefix-key`)).toBeCloseTo(x(`${cross}/key-adapter`));
  expect(x(`${cross}/rearrange-key-heads`)).toBeCloseTo(x(`${cross}/key-adapter`));
});
