import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { atlasSnapshot as atlasDocument } from '../../../testSupport/atlasSnapshot';
import type { AtlasData } from '../../../types/atlas';
import { readRoute } from '../../../app/routes';
import { resolveAnalysisContext } from '../domain/resolveAnalysisContext';
import { KernelNcuMetrics } from './KernelNcuMetrics';

const data = atlasDocument as unknown as AtlasData;
const model = data.datasets.models.find(item => item.model_id === 'pi0')!;
const record = data.datasets.model_graphs.find(item => item.model_id === 'pi0')!;
const run = data.datasets.runs.find(item => item.run_id === 'run-pi0-flashrt-nsys-node-001')!;
const route = readRoute(`?model=pi0&runtime=flashrt&hardware=${run.device_id}&runtimePrecision=${run.precision.precision_id}&workload=${run.configuration_id}&timelineCapture=capture-pi0-flashrt-nsys-node-001`);
const context = resolveAnalysisContext({ data, model, record, route });

it('shows one selectable NCU replay at a time with counter provenance folded', () => {
  const rows = context.kernels.rows.filter(row => row.signature.kernelSignatureId === 'kernel-signature-pi0-encoder-large-gemm' && row.capture.tool === 'ncu');
  expect(rows.length).toBeGreaterThan(1);
  const markup = renderToStaticMarkup(<KernelNcuMetrics rows={rows} />);
  expect(markup.match(/data-capture-id=/g)).toHaveLength(1);
  expect(markup).toContain(`data-capture-id="${rows[0]!.capture.captureId}"`);
  for (const row of rows) expect(markup).toContain(`<option value="${row.observation.observationId}"`);
  expect(markup).toContain('选择独立回放');
  expect(markup).toContain('83.97%');
  expect(markup).toContain('10.18%');
  expect(markup).toContain('0.11 warp');
  expect(markup).toContain('独立回放');
  expect(markup).toContain('单次 launch');
  expect(markup).toContain('L2 sysmem');
  expect(markup).toContain('原始计数器');
  expect(markup).not.toContain('<details open');
  expect(markup).not.toContain('DRAM 利用率');
});

it('keeps measured zero, omits unavailable summary metrics, and handles no matching replay', () => {
  const row = context.kernels.rows.find(row => row.signature.kernelSignatureId === 'kernel-signature-pi0-encoder-geglu' && row.capture.tool === 'ncu')!;
  expect(row).toBeDefined();
  const markup = renderToStaticMarkup(<KernelNcuMetrics rows={[row]} />);
  const summary = markup.split('<details class="kernel-ncu-raw">')[0]!;
  expect(summary).toContain('Tensor 活跃');
  expect(summary).toContain('0%');
  expect(summary).not.toContain('Scoreboard');
  expect(summary).not.toContain('DRAM');
  expect(markup).toContain('未采集该指标组');
  expect(renderToStaticMarkup(<KernelNcuMetrics rows={[]} />)).toContain('暂无同一 Kernel 签名的 NCU 回放');
});
