import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { RuntimePerformanceChart } from './RuntimePerformanceChart';
import { ExistingPerformanceComparison } from './ExistingPerformanceComparison';
import { atlasSnapshot as data } from '../../../testSupport/atlasSnapshot';
import { readRoute } from '../../../app/routes';

it('draws zero-based vertical bars with explicit statistics and no zero bar for missing data', () => {
  const common = { precisionLabel: 'BF16', onSelect: () => undefined, missing: '' };
  const markup = renderToStaticMarkup(<RuntimePerformanceChart label="固定输入" columns={[
    { ...common, id: 'a', runtimeId: 'a', runtimeLabel: 'A', latencyMs: 50, statistic: 'p50' },
    { ...common, id: 'b', runtimeId: 'b', runtimeLabel: 'B', latencyMs: 100, statistic: 'mean' },
    { ...common, id: 'c', runtimeId: 'c', runtimeLabel: 'C', latencyMs: null, statistic: null, missing: '当前输入无匹配测量' },
  ]} />);
  expect(markup).toContain('height:50%');
  expect(markup).toContain('height:100%');
  expect(markup).toContain('<span>0</span>');
  expect(markup.match(/class="pi0-runtime-bar"/g)).toHaveLength(2);
  expect(markup).toContain('中位数'); expect(markup).toContain('均值');
  expect(markup).toContain('当前输入无匹配测量');
});

it('keeps SmolVLA legacy measurements folded and Pi0.5 runtime entry points available', () => {
  for (const modelId of ['pi05', 'smolvla']) {
    const markup = renderToStaticMarkup(<ExistingPerformanceComparison data={data} model={data.datasets.models.find(model => model.model_id === modelId)!} route={readRoute(`?model=${modelId}&tab=runtime`)} navigate={() => undefined} />);
    const primary = markup.split('existing-other-protocols')[0]!;
    expect(primary).toContain('pi0-runtime-chart');
    expect(primary).toContain('查看推理栈');
    expect(primary).not.toContain('class="pi0-runtime-bar"');
    expect(primary).not.toContain('existing-performance-bars');
    if (modelId === 'smolvla') {
      expect(markup).toContain('查看已有其他采样口径');
      expect(markup).toContain('测量 50 次');
      expect(markup).toContain('class="pi0-runtime-bar"');
    }
  }
});
