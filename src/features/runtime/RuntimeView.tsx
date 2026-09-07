import type { RoutePatch, RouteState } from '../../app/routes';
import type { AtlasData, ModelRecord } from '../../types/atlas';
import { isV1ModelGraphRecord } from '../model-graph/domain/adaptV1ModelGraph';
import { ModelDisplayProvider } from '../model-graph/presentation/ModelDisplay';
import { RuntimeAnalysisWorkspace } from './RuntimeAnalysisWorkspace';

interface RuntimeViewProps {
  data: AtlasData;
  model: ModelRecord;
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}

/** A missing logical graph disables graph analysis, never measured execution. */
export function RuntimeView({data, model, route, navigate}: RuntimeViewProps) {
  const record = data.datasets.model_graphs.find(item => isV1ModelGraphRecord(item, model.model_id)) ?? null;
  return <ModelDisplayProvider modelId={model.model_id}>
    <RuntimeAnalysisWorkspace data={data} model={model} record={record} route={route} navigate={navigate} />
  </ModelDisplayProvider>;
}
