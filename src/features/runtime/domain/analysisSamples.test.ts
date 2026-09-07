import { expect, it } from 'vitest';
import { summarizeSamples } from './analysisSamples';

it('keeps E2E sample statistics without removing outliers', () => {
  expect(summarizeSamples([1,2,3,4])?.median).toBe(2.5);
  expect(summarizeSamples([1,2,3])?.cv).toBe(0.5);
  expect(summarizeSamples([100,100,100,100,100,100,100,100,100,200])?.stable).toBe(false);
});
