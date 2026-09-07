import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { CudaGraphComparison } from './CudaGraphComparison';

it('illustrates asynchronous submission and smaller gaps for one graph with the same GPU work', () => {
  const markup = renderToStaticMarkup(<CudaGraphComparison />);
  const [before, after] = markup.split('data-mode="individual"')[1]!.split('data-mode="graph"');
  const kernels = (part: string) => [...part.matchAll(/<g class="graph-comparison-kernel" data-kernel="([^"]+)"><rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/g)].map(match => ({label:match[1],x:Number(match[2]),width:Number(match[3])}));
  const launches = (part: string) => [...part.matchAll(/<g class="graph-comparison-host-launch"><rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/g)].map(match => ({x:Number(match[1]),width:Number(match[2])}));
  expect(before!.match(/class="graph-comparison-host-launch"/g)!.length).toBeGreaterThan(2);
  expect(launches(after!)).toHaveLength(1);
  const first=kernels(before!), replay=kernels(after!), cpu=launches(before!);
  expect(replay.map(({label,width})=>({label,width}))).toEqual(first.map(({label,width})=>({label,width})));
  expect(first.length).toBeGreaterThan(2);
  expect(cpu[1]!.x).toBeLessThan(first[0]!.x+first[0]!.width);
  expect(cpu[1]!.x+cpu[1]!.width).toBeGreaterThan(first[0]!.x);
  first.forEach((kernel,index)=>expect(kernel.x).toBeGreaterThanOrEqual(cpu[index]!.x+cpu[index]!.width));
  expect(replay[1]!.x-replay[0]!.x-replay[0]!.width).toBeGreaterThan(0);
  expect(replay[1]!.x-replay[0]!.x-replay[0]!.width).toBeLessThan(first[1]!.x-first[0]!.x-first[0]!.width);
  expect(markup).toContain('机制示意');
  expect(markup).toContain('逐次提交／启动带来的等待');
  expect(markup).toContain('图内启动／调度开销');
  expect(markup).toContain('FlashRT 每次推理分别重放视觉图与主推理图，各一次');
  expect(markup).not.toContain('graph-comparison-link');
  expect(markup.replace(/<[^>]*>/g, '')).not.toMatch(/\d+(?:\.\d+)?\s*(?:ms|µs|μs|%)/);
});
