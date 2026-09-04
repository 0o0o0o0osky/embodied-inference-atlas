import type { AtlasData } from "../types/atlas";

const DATASET_NAMES = [
  "architectures",
  "devices",
  "end_to_end",
  "models",
  "model_graphs",
  "operators",
  "rooflines",
  "runs",
  "runtimes",
  "sources",
  "stages",
  "systems",
] as const;

export async function loadAtlasData(): Promise<AtlasData> {
  const response = await fetch("./assets/data/atlas-data.json", {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Snapshot request failed with status ${response.status}`);
  }

  const payload: unknown = await response.json();
  if (!isAtlasData(payload)) {
    throw new Error("The generated Atlas snapshot has an invalid envelope");
  }
  return payload;
}

function isAtlasData(value: unknown): value is AtlasData {
  if (!isRecord(value) || value.format_version !== "1.0.0") {
    return false;
  }
  const datasets = value.datasets;
  if (!isRecord(datasets)) {
    return false;
  }
  return DATASET_NAMES.every((name) => Array.isArray(datasets[name]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
