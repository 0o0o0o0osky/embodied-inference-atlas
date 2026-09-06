import type { KernelRow } from '../../performance/domain/buildKernelRows';
import type { RuntimeRealizationRecord } from './types';

/** A group may span kernels, and one kernel may cover multiple groups. */
export function groupKernelRows(rows: readonly KernelRow[], realization: RuntimeRealizationRecord, groupIds: readonly string[]) {
  const signatures = new Set(realization.executionGroups.filter(group=>groupIds.includes(group.executionGroupId))
    .flatMap(group=>group.kernelSignatureIds));
  return rows.filter(row=>signatures.has(row.signature.kernelSignatureId) || row.links.some(link=>
    (link.status === 'resolved' || link.status === 'partial' && link.reasonCode === 'ambiguous_attribution') && link.realizationId === realization.realizationId
    && link.executionGroupIds.some(id=>groupIds.includes(id))));
}
