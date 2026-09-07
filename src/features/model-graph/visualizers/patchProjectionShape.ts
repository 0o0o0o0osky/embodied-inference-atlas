import type { MaterializedTensor, OperatorDetail } from '../domain/types';

const axis = (tensor: MaterializedTensor | null | undefined, name: string) => {
  const aliases: Record<string, readonly string[]> = {channels:['channels','channel'],views:['views','view'],tokens_per_view:['tokens_per_view','tokens']};
  const index = tensor?.axes.findIndex(item => (aliases[name] ?? [name]).includes(item.axis)) ?? -1;
  return index < 0 ? null : tensor?.shape[index] ?? null;
};
const positive = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/** Only the declared non-overlapping patch lattice, never arbitrary Conv2d. */
export function patchProjectionShape(operator: OperatorDetail) {
  if (operator.definitionId !== 'patch-embedding') return null;
  const image = operator.inputs.find(port => port.port === 'image')?.tensor;
  const output = operator.outputs.find(port => port.port === 'output')?.tensor;
  const height = axis(image, 'height'), width = axis(image, 'width'), channels = axis(image, 'channels');
  const tokens = axis(output, 'tokens_per_view'), embedding = axis(output, 'width');
  const patch = operator.scopeBindings.P;
  if (!positive(height) || !positive(width) || !positive(channels) || !positive(tokens) || !positive(embedding) || !positive(patch)) return null;
  const rows = height / patch, columns = width / patch;
  if (!positive(rows) || !positive(columns) || tokens !== rows * columns) return null;
  for (const [key, value] of Object.entries({H:height,W:width,C:channels,P:patch,T:tokens,D:embedding})) {
    if (operator.scopeBindings[key] !== value) return null;
  }
  for (const name of ['batch', 'views']) if (axis(image,name) !== axis(output,name)) return null;
  return {height,width,channels,patch,rows,columns,tokens,embedding};
}
