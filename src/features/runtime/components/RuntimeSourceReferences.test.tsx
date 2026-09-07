import { renderToStaticMarkup } from 'react-dom/server';
import { expect,it } from 'vitest';
import { RuntimeSourceReferences,runtimeSourceReferences } from './RuntimeSourceReferences';
import { atlasSnapshot } from '../../../testSupport/atlasSnapshot';
it('uses catalog repository URLs, deduplicates revisions, and names local measurements',()=>{
 const sources=atlasSnapshot.datasets.sources;
 const refs=runtimeSourceReferences(sources,['source-lerobot','source-lerobot-fbb811f','source-local-thor','missing',null]);
 expect(refs).toEqual([{label:'lerobot',url:'https://github.com/huggingface/lerobot',github:true},{label:'本机 Thor 测量',url:null,github:false}]);
 const markup=renderToStaticMarkup(<p>参考来源：<RuntimeSourceReferences sources={sources} sourceIds={['source-flashrt','source-local-thor']}/></p>);
 expect(markup).toContain('https://github.com/flashrt-project/FlashRT');expect(markup).toContain('GitHub');
 expect(markup).not.toContain('source-flashrt');expect(markup).not.toContain('<div');
});
it('does not expose unknown IDs or create unsafe links',()=>{
 expect(renderToStaticMarkup(<RuntimeSourceReferences sourceIds={['secret-id']}/>)).toBe('来源未记录');
 expect(runtimeSourceReferences([{source_id:'bad',url:'javascript:alert(1)',title:'bad'}],['bad'])).toEqual([]);
});
