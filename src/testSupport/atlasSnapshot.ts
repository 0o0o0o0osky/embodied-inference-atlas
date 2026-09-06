import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { AtlasData } from '../types/atlas';

// Read canonical evidence at runtime: Vite must not transform the full timeline
// into JavaScript/source maps, and tests must not depend on a stale site build.
const root = fileURLToPath(new URL('../../', import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(root, 'schema/manifest.json'), 'utf8')) as {
  datasets: Record<string, { data?: string; data_glob?: string; primary_key: string }>;
};
const datasets = Object.fromEntries(Object.entries(manifest.datasets).map(([name, entry]) => {
  const paths = entry.data ? [resolve(root, entry.data)] : globSync(entry.data_glob!, { cwd: root }).sort().map(path => resolve(root, path));
  const records = paths.flatMap(path => JSON.parse(readFileSync(path, 'utf8')).records) as Record<string, string>[];
  records.sort((left, right) => left[entry.primary_key]!.localeCompare(right[entry.primary_key]!));
  return [name, records];
}));
export const atlasSnapshot = { format_version: '1.0.0', datasets } as unknown as AtlasData;
