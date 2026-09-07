import { Fragment } from 'react';
import type { CanonicalRecord } from '../../../types/atlas';

/** Catalog-only references. No fetching, repository lookup table, or evidence dump. */
export function runtimeSourceReferences(sources: readonly CanonicalRecord[] = [], sourceIds: readonly (string|null)[]) {
  const refs = new Map<string,{label:string;url:string|null;github:boolean}>();
  for (const id of sourceIds) {
    const source=sources.find(item=>item.source_id===id);
    if (!source) continue;
    if (source.evidence_kind==='measured_local' || source.evidence==='measured_local') {
      refs.set('local',{label:'本机 Thor 测量',url:null,github:false});continue;
    }
    if (typeof source.url!=='string') continue;
    try {
      const url=new URL(source.url);
      if (url.protocol!=='https:' && url.protocol!=='http:') continue;
      const parts=url.pathname.split('/').filter(Boolean);
      if (url.hostname==='github.com' && parts.length>=2) {
        const repository=parts[1]!.replace(/\.git$/,'');
        const href=`https://github.com/${parts[0]}/${repository}`;
        refs.set(href.toLowerCase(),{label:repository,url:href,github:true});
      } else {
        const label=typeof source.title==='string' ? source.title.replace(/\s+(?:at|revision)\s+[a-f0-9]{7,40}\b/gi,'').replace(/\b[a-f0-9]{40}\b/g,'').trim() : url.hostname;
        refs.set(url.href,{label:label || url.hostname,url:url.href,github:false});
      }
    } catch { /* Missing/invalid catalog URLs do not become links or raw IDs. */ }
  }
  return [...refs.values()];
}

export function RuntimeSourceReferences({sources,sourceIds}:{sources?:readonly CanonicalRecord[] | undefined;sourceIds:readonly (string|null)[]}) {
  const references=runtimeSourceReferences(sources,sourceIds);
  return <>{references.length ? references.map((ref,index)=><Fragment key={ref.url ?? ref.label}>{index ? '、' : ''}{ref.url ? <><span>{ref.label}</span>（<a href={ref.url} target="_blank" rel="noreferrer">{ref.github ? 'GitHub' : '来源链接'}</a>）</> : ref.label}</Fragment>) : '来源未记录'}</>;
}
