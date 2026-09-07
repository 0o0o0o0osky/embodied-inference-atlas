import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { atlasSnapshot as atlasDocument } from '../../../testSupport/atlasSnapshot';
import type { AtlasData } from '../../../types/atlas';
import { adaptV1ModelGraph } from '../../model-graph/domain/adaptV1ModelGraph';
import { adaptLogicalDag } from '../../model-graph/domain/adaptLogicalDag';
import { runtimeGroupEntity } from '../../workbench/entityKeys';
import { adaptRuntimeRealization } from '../domain/adaptRuntimeRealization';
import { Pi0ExecutionInspector } from './Pi0ExecutionInspector';

it('retains the selected calculation and kernel binding with compact repository credits', () => {
  const data = atlasDocument as unknown as AtlasData;
  const realization = adaptRuntimeRealization(data.datasets.runtime_realizations.find(record =>
    record.realization_id === 'rr-flashrt-pi0-thor-fp8-v1')!);
  const dag = adaptLogicalDag(adaptV1ModelGraph(data.datasets.model_graphs.find(record => record.model_id === 'pi0')!));
  const markup = renderToStaticMarkup(<Pi0ExecutionInspector dag={dag} realization={realization}
    sources={data.datasets.sources} selectedEntity={runtimeGroupEntity(realization.realizationId, 'prefix-merged-gate-up')}
    onClose={() => undefined} renderKernelDetails={ids => {
      expect(ids).toEqual(['prefix-merged-gate-up']);
      return <p>关联 Kernel 分析</p>;
    }} />);
  expect(markup).toContain('前缀 Gate/Up 合并投影');
  expect(markup).toContain('第 1–17 层');
  expect(markup).toContain('关联 Kernel 分析');
  expect(markup.match(/href="https:\/\/github.com\/flashrt-project\/FlashRT"/g)).toHaveLength(1);
  expect(markup).toContain('GitHub');
  for (const internal of [realization.runtimeRevision, ...realization.configurationIds,
    realization.realizationId, 'source-flashrt', 'map-prefix-merged-gate-up', 'prefix-merged-gate-up']) {
    expect(markup).not.toContain(internal);
  }
});
