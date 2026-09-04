import type { AtlasData, CanonicalRecord } from "../../../types/atlas";
import type {
  RooflineBasisRecord,
  RooflineCeilingRecord,
  RooflinePointRecord,
  RooflineScenarioRecord,
} from "../domain/types";

export interface RooflineIndex {
  readonly ceilings: readonly RooflineCeilingRecord[];
  readonly scenarios: readonly RooflineScenarioRecord[];
  readonly bases: readonly RooflineBasisRecord[];
  readonly points: readonly RooflinePointRecord[];
  readonly ceilingById: ReadonlyMap<string, RooflineCeilingRecord>;
  readonly scenarioById: ReadonlyMap<string, RooflineScenarioRecord>;
  readonly basisById: ReadonlyMap<string, RooflineBasisRecord>;
  readonly pointsByBasisId: ReadonlyMap<string, readonly RooflinePointRecord[]>;
}

function records<T>(values: readonly CanonicalRecord[], id: string): T[] {
  return values.filter((value) => value.schema_version === "2.0.0" && typeof value[id] === "string") as T[];
}

function indexBy<T>(values: readonly T[], id: (value: T) => string): ReadonlyMap<string, T> {
  return new Map(values.map((value) => [id(value), value]));
}

export function indexRoofline(data: AtlasData): RooflineIndex {
  return createRooflineIndex(
    records<RooflineCeilingRecord>(data.datasets.roofline_ceilings, "ceiling_id"),
    records<RooflineScenarioRecord>(data.datasets.roofline_scenarios, "scenario_id"),
    records<RooflineBasisRecord>(data.datasets.roofline_bases, "basis_id"),
    records<RooflinePointRecord>(data.datasets.roofline_points, "point_id"),
  );
}

export function createRooflineIndex(
  ceilings: readonly RooflineCeilingRecord[],
  scenarios: readonly RooflineScenarioRecord[],
  bases: readonly RooflineBasisRecord[],
  points: readonly RooflinePointRecord[],
): RooflineIndex {
  const grouped = new Map<string, RooflinePointRecord[]>();
  points.forEach((point) => grouped.set(point.basis_id, [...(grouped.get(point.basis_id) ?? []), point]));
  return {
    ceilings,
    scenarios,
    bases,
    points,
    ceilingById: indexBy(ceilings, (item) => item.ceiling_id),
    scenarioById: indexBy(scenarios, (item) => item.scenario_id),
    basisById: indexBy(bases, (item) => item.basis_id),
    pointsByBasisId: grouped,
  };
}
