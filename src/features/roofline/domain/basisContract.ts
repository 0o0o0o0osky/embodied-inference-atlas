import type { RooflineBasisRecord } from "./types";

/**
 * Fields that must stay identical when two accounting levels are paired.
 * Level-specific fields (level, work unit, aggregation) are intentionally
 * excluded so one Stage basis can be paired with its Atomic counterpart.
 */
export function rooflineBasisContract(basis: RooflineBasisRecord) {
  return JSON.stringify([
    basis.precision_path_id,
    basis.ceiling_id,
    basis.bandwidth_ceiling_id,
    basis.device_id,
    basis.operating_point_id,
    basis.time_basis,
    basis.traffic_basis,
    basis.work_basis,
    basis.runtime_overhead,
    basis.runtime_id,
    basis.realization_id,
    basis.run_id,
    basis.capture_id,
    basis.comparison_mode,
  ]);
}
