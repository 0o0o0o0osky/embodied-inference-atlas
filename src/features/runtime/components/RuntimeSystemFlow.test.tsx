import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { atlasSnapshot } from '../../../testSupport/atlasSnapshot';
import { adaptRuntimeRealization } from '../domain/adaptRuntimeRealization';
import { RuntimeSystemFlow } from './RuntimeSystemFlow';

function realization(id: string) {
  return adaptRuntimeRealization(atlasSnapshot.datasets.runtime_realizations.find(r => r.realization_id === id)!);
}
const native = realization('rr-vla-cpp-pi0-thor-bf16-f32-v1');
const flash = realization('rr-flashrt-pi0-thor-fp8-v1');
const q8 = realization('rr-vla-cpp-pi0-thor-q8-0-v1');
const render = (record: typeof native) => renderToStaticMarkup(<RuntimeSystemFlow realization={record} />);

it('exposes CPU/GPU modules as selectable structural steps without measured durations', () => {
  for (const record of [native, flash, q8]) {
    const markup = render(record);
    expect(markup).toContain('system-flow-lane is-cpu');
    expect(markup).toContain('system-flow-lane is-gpu');
    expect(markup).toContain('role="button" tabindex="0"');
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).not.toContain('aria-label="所选系统模块"');
    expect(markup.replace(/<[^>]*>/g, '')).not.toMatch(/\d+(?:\.\d+)?\s*(?:ms|μs|ns|毫秒)/);
    expect(markup).not.toContain('x1="LEFT"');
  }
});

it('distinguishes native embedding readback from FlashRT GPU-resident intermediate data', () => {
  const nativeFlow = native.systemFlow!;
  const flashFlow = flash.systemFlow!;
  expect(nativeFlow.nodes.find(n => n.nodeId === 'main-input')?.lane).toBe('cpu');
  expect(nativeFlow.edges).toContainEqual(expect.objectContaining({from: 'vision', to: 'main-input', kind: 'data'}));
  expect(render(native)).toContain('视觉 embedding 回读');
  expect(flashFlow.nodes.find(n => n.nodeId === 'prefix')?.lane).toBe('gpu');
  expect(flashFlow.edges).toContainEqual(expect.objectContaining({from: 'vision', to: 'prefix', kind: 'data'}));
  expect(render(flash)).toContain('GPU 多模态 embedding');
  expect(render(flash)).not.toContain('视觉 embedding 回读');
});

it('keeps Q8 backend graph boundaries distinct from confirmed CUDA Graph boundaries', () => {
  expect(render(q8)).toContain('system-flow-boundary is-backend_graph');
  expect(render(q8)).not.toContain('system-flow-boundary is-cuda_graph');
  expect(render(flash)).toContain('system-flow-boundary is-cuda_graph');
});

it('keeps parallel data and control edges visually distinguishable', () => {
  const markup = render(flash);
  const paths = [...markup.matchAll(/<g class="system-flow-edge is-(?:data|control)"><path d="([^"]+)"/g)].map(match => match[1]);
  expect(paths.length).toBeGreaterThan(1);
  expect(new Set(paths).size).toBe(paths.length);
});

it('keeps source scope notes in data while presenting only the execution diagram',()=>{
 const record={...flash,systemFlow:{...flash.systemFlow!,notes:['internal-scope-note-sentinel']}};
 const markup=render(record);
 expect(markup).toContain('CPU/GPU 执行流程示意');
 expect(markup).not.toContain('internal-scope-note-sentinel');
 expect(markup).not.toContain('输入准备、初始化与适用范围');
 expect(markup).not.toContain('未确认结果复用');
 expect(record.systemFlow.notes).toEqual(['internal-scope-note-sentinel']);
});
