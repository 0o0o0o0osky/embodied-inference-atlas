import { expect, it } from 'vitest';
import type { KernelRow } from '../../performance/domain/buildKernelRows';
import type { RuntimeRealizationRecord } from './types';
import { groupKernelRows } from './groupKernelRows';

it('retains a shared population in both groups without allocating its duration',()=>{
  const realization = {realizationId:'stack',executionGroups:[]} as unknown as RuntimeRealizationRecord;
  const row = {signature:{kernelSignatureId:'shared'},observation:{calls:197,duration:{valueNs:2974784}},links:[{
    realizationId:'stack',status:'partial',reasonCode:'ambiguous_attribution',executionGroupIds:['prefix','action'],
  }]} as unknown as KernelRow;
  for (const id of ['prefix','action']) expect(groupKernelRows([row],realization,[id])).toEqual([row]);
  expect(groupKernelRows([row],realization,['unrelated'])).toEqual([]);
  expect(groupKernelRows([row],{...realization,realizationId:'other-stack'},['prefix'])).toEqual([]);
});

it('does not turn ambiguous or unknown associations into clickable measurements',()=>{
  const realization = {realizationId:'stack',executionGroups:[]} as unknown as RuntimeRealizationRecord;
  for (const status of ['ambiguous','unknown']) {
    const row = {signature:{kernelSignatureId:'unknown'},links:[{realizationId:'stack',status,executionGroupIds:['prefix']}]} as unknown as KernelRow;
    expect(groupKernelRows([row],realization,['prefix'])).toEqual([]);
  }
});
