import {expect,it} from 'vitest';
import {gemmTile,gemmX,gemmW} from './gemmComputation';
it('accumulates two K tiles into each selectable GEMM output tile',()=>{
 for(const row of [0,2])for(const column of [0,2]) {
  const tiles=gemmTile(row,column);
  expect(tiles[1]!.before).toEqual(tiles[0]!.accumulator);
  for(let i=0;i<4;i++)expect(tiles[1]!.accumulator[i]).toBe(gemmX[row+Math.floor(i/2)]!.reduce((s,x,k)=>s+x*gemmW[k]![column+i%2]!,0));
 }
});
