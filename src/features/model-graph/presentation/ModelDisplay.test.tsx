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

it('uses shared Chinese terms for all three models while retaining their own scopes and symbolic dimensions', () => {
  for (const document of [pi0, pi05, smolvla]) {
    const graph = adaptV1ModelGraph(document.records[0] as CanonicalRecord);
    const dag = adaptLogicalDag(graph);
    const profile = resolvePresentationProfile(graph, dag);
    expect(renderToStaticMarkup(<ModelDisplayProvider modelId={graph.modelId}><SharedLabel /></ModelDisplayProvider>)).toContain('Q 投影');
    expect(modelDisplayText(graph.modelId, profile.panelLabel)).toContain('模型算子图');
    expect(Object.keys(profile).sort()).toEqual(['diagramLabel', 'panelLabel', 'presentation']);
    for (const stage of dag.stages.values()) {
      expect(modelDisplayText(graph.modelId, stage.label)).toMatch(/[\u4e00-\u9fff]/);
    }
    if (graph.modelId === 'smolvla') {
      const scale = Object.entries(profile.presentation.aliases).find(([ref]) => ref.endsWith('/connector-scale'))![1];
      expect(scale).toBe('×√DOUT');
      expect(modelDisplayText(graph.modelId, 'Ordered self/cross expert pairs ×8')).toBe('自注意力/交叉注意力层对 ×8');
    }
    if (graph.modelId === 'pi05') {
      expect(modelDisplayText(graph.modelId, 'AdaRMS expert layers ×18')).toBe('AdaRMS 专家层 ×18');
      expect(modelDisplayText(graph.modelId, 'Prompt + state tokens')).toBe('提示词 + 状态词元');
      expect(modelDisplayText(graph.modelId, 'Gemma ×17 full')).toBe('Gemma ×17 full');
    }
  }
  expect(modelDisplayText('unknown-model', 'Query projection')).toBe('Q 投影');
  expect(modelDisplayText('unknown-model', 'Model-specific operation')).toBe('Model-specific operation');
});
