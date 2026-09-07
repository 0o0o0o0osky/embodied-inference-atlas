import { dagLabel } from "./operatorCatalog";
import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import pi0 from '../../../../data/model_graphs/pi0.json';
import pi05 from '../../../../data/model_graphs/pi05.json';
import smolvla from '../../../../data/model_graphs/smolvla.json';
import type { CanonicalRecord } from '../../../types/atlas';
import { adaptV1ModelGraph } from '../domain/adaptV1ModelGraph';
import { adaptLogicalDag } from '../domain/adaptLogicalDag';
import { resolvePresentationProfile } from './registry';
import { ModelDisplayProvider, modelDisplayText, useModelText } from './ModelDisplay';

function SharedLabel() { const t = useModelText(); return <span>{t('Query projection')}</span>; }

it('uses shared terminology for all models while retaining their own scopes and symbolic dimensions', () => {
  for (const document of [pi0, pi05, smolvla]) {
    const graph = adaptV1ModelGraph(document.records[0] as CanonicalRecord);
    const dag = adaptLogicalDag(graph);
    const profile = resolvePresentationProfile(graph, dag);
    expect(modelDisplayText(graph.modelId, dag.stages.find(stage => stage.id === 'prefix-encoder')!.label)).toBe('前缀编码器');
    const inputLabel = (ref: string) => modelDisplayText(graph.modelId,
      profile.presentation.aliases[ref] ?? dag.nodes.get(ref)!.label);
    expect(inputLabel(graph.modelId === 'pi0' ? 'input/images' : 'input/executed-images')).toBe('图像');
    expect(inputLabel('input/prompt-token-ids')).toBe(graph.modelId === 'pi05' ? 'prompt + state' : 'prompt');
    expect(inputLabel('prefix-encoder/prefix-blocks/feed-forward/gate-projection')).toBe('Gate');
    expect(inputLabel('action-flow-decoder/action-suffix-builder/time-mlp-in')).toBe('输入 Proj');
    expect(inputLabel('action-flow-decoder/action-suffix-builder/time-mlp-out')).toBe('输出 Proj');
    if (dag.nodes.has('input/state')) expect(inputLabel('input/state')).toBe('state');
    expect(renderToStaticMarkup(<ModelDisplayProvider modelId={graph.modelId}><SharedLabel /></ModelDisplayProvider>)).toContain('Q 投影');
    expect(modelDisplayText(graph.modelId, profile.panelLabel)).toContain('模型算子图');
    expect(Object.keys(profile).sort()).toEqual(['diagramLabel', 'panelLabel', 'presentation']);
    for (const stage of dag.stages.values()) {
      expect(modelDisplayText(graph.modelId, stage.label)).toMatch(/[\u4e00-\u9fff]/);
    }
    if (graph.modelId === 'smolvla') {
      const scale = Object.entries(profile.presentation.aliases).find(([ref]) => ref.endsWith('/connector-scale'))![1];
      expect(scale).toBe('×√DOUT');
      const cross = 'action-flow-decoder/expert-layer-pairs/cross-attention';
      expect(inputLabel(`${cross}/key-adapter`)).toBe('K Proj');
      expect(inputLabel(`${cross}/value-adapter`)).toBe('V Proj');
      expect(modelDisplayText(graph.modelId, 'Ordered self/cross expert pairs ×8')).toBe('Self-attention → Cross-attention ×8');
    }
    if (graph.modelId === 'pi05') {
      expect(modelDisplayText(graph.modelId, 'AdaRMS expert layers ×18')).toBe('AdaRMS 专家层 ×18');
      expect(modelDisplayText(graph.modelId, 'Prompt + state tokens')).toBe('prompt + state');
      expect(modelDisplayText(graph.modelId, 'Gemma ×17 full')).toBe('Gemma ×17 full');
    }
  }
  expect(modelDisplayText('unknown-model', 'Query projection')).toBe('Q 投影');
  expect(modelDisplayText('unknown-model', 'Model-specific operation')).toBe('Model-specific operation');
});

it('normalizes source synonyms through one vocabulary, including future model entries', () => {
  for (const model of ['pi0', 'pi05', 'smolvla', 'new-model']) {
    expect(["prompt", "state", "patch", "reshape", "concat", "scale", "shift", "× gate", "x₀", "Qₛ RoPE"].map(dagLabel))
      .toEqual(["Prompt", "State", "Patch", "Reshape", "Concat", "Scale", "Shift", "× Gate", "x₀", "Qₛ RoPE"]);
    const t = (label: string) => modelDisplayText(model, label);
    expect(['Images', 'Executed images', '512² execution'].map(t)).toEqual(['图像', '图像', '图像']);
    expect(['Prompt', 'Prompt tokens', 'Prompt token IDs'].map(t)).toEqual(['prompt', 'prompt', 'prompt']);
    expect(['State input', 'State scalars'].map(t)).toEqual(['state', 'state']);
    expect(['Attn', 'attention', 'Gate', 'bias', 'scale', 'shift', 'tokens'].map(t))
      .toEqual(['Attention', 'Attention', 'Gate', 'bias', 'scale', 'shift', 'token']);
  }
});
