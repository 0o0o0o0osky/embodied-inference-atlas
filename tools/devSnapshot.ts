import {globSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {Plugin} from 'vite';

/** Development only: serialize canonical JSON as a separate HTTP asset, never a JS import. */
export async function readDevelopmentSnapshot(root: string) {
  const manifest = JSON.parse(await readFile(resolve(root, 'schema/manifest.json'), 'utf8')) as {
    datasets: Record<string, {data?: string; data_glob?: string; primary_key: string}>;
  };
  const datasets: Record<string, Record<string, unknown>[]> = {};
  for (const name of Object.keys(manifest.datasets).sort()) {
    const entry = manifest.datasets[name]!;
    const paths = entry.data ? [entry.data] : globSync(entry.data_glob!, {cwd: root}).sort();
    const records = (await Promise.all(paths.map(async path => {
      const document = JSON.parse(await readFile(resolve(root, path), 'utf8'));
      if (!Array.isArray(document.records)) throw new Error(`Invalid canonical records: ${path}`);
      return document.records as Record<string, unknown>[];
    }))).flat();
    datasets[name] = records.sort((a, b) => {
      const left=String(a[entry.primary_key]), right=String(b[entry.primary_key]);
      return left < right ? -1 : left > right ? 1 : 0;
    });
  }
  return {format_version: '1.0.0', datasets};
}

export function canonicalDevelopmentData(): Plugin {
  return {
    name: 'atlas-canonical-development-data',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/assets/data/atlas-data.json', (_request, response) => {
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        void readDevelopmentSnapshot(server.config.root).then(snapshot => {
          response.end(JSON.stringify(snapshot));
        }).catch(error => {
          server.config.logger.error(String(error));
          response.statusCode=500;
          response.end(JSON.stringify({error:'Canonical data could not be read'}));
        });
      });
    },
  };
}
