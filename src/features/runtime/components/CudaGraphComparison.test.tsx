import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { CudaGraphComparison } from './CudaGraphComparison';

it('reduces host launches to two on the comparison timeline while retaining the GPU work', () => {
  const markup = renderToStaticMarkup(<CudaGraphComparison />);
  const [before, after] = markup.split('data-mode="individual"')[1]!.split('data-mode="graph"');
  const kernels = (part: string) => [...part.matchAll(/<g class="graph-comparison-kernel"[\s\S]*?<\/g>/g)].map(match => match[0]);
  expect(before!.match(/class="graph-comparison-host-launch"/g)!.length).toBeGreaterThan(2);
  expect(after!.match(/class="graph-comparison-host-launch"/g)).toHaveLength(2);
  expect(kernels(after!)).toEqual(kernels(before!));
  expect(kernels(after!).length).toBeGreaterThan(2);
  expect(after).toContain('省去逐 Kernel launch 的 CPU 开销');
  expect(markup).toContain('时间线示意');
  expect(markup.replace(/<[^>]*>/g, '')).not.toMatch(/\d+(?:\.\d+)?\s*(?:ms|µs|μs|%)/);
});
