import {readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect, it} from 'vitest';
import {readDevelopmentSnapshot} from '../../tools/devSnapshot';
import {atlasSnapshot} from '../testSupport/atlasSnapshot';

it('serves the same canonical records as offline export without reading site', async () => {
  const actual=await readDevelopmentSnapshot(process.cwd());
  const manifest=JSON.parse(readFileSync('schema/manifest.json','utf8'));
  for (const [name,records] of Object.entries(actual.datasets)) {
    const key=manifest.datasets[name].primary_key;
    const expected=atlasSnapshot.datasets[name as keyof typeof atlasSnapshot.datasets];
    const indexed=(rows: readonly object[])=>Object.fromEntries(rows.map(row=>[String((row as Record<string,unknown>)[key]),row]));
    expect(indexed(records)).toEqual(indexed(expected));
  }
});
it('reads current canonical changes without a build or stale cache', async () => {
  const root=mkdtempSync(join(tmpdir(),'atlas-dev-'));
  try {
    mkdirSync(join(root,'schema')); mkdirSync(join(root,'data'));
    writeFileSync(join(root,'schema/manifest.json'),JSON.stringify({datasets:{models:{data_glob:'data/*.json',primary_key:'id'}}}));
    const file=join(root,'data/models.json');
    writeFileSync(file,JSON.stringify({records:[{id:'b'},{id:'a'}]}));
    expect((await readDevelopmentSnapshot(root)).datasets.models).toEqual([{id:'a'},{id:'b'}]);
    writeFileSync(file,JSON.stringify({records:[{id:'c'}]}));
    expect((await readDevelopmentSnapshot(root)).datasets.models).toEqual([{id:'c'}]);
  } finally {rmSync(root,{recursive:true,force:true});}
});
