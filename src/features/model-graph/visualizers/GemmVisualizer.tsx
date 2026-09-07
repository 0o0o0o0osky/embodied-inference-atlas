import {useState} from 'react';
import type {OperatorDetail} from '../domain/types';
import {ComputationStepper} from './ComputationStepper';
import {TileMatrix} from './TileMatrix';
import {useOperatorAnimation} from './useOperatorAnimation';
import {gemmTile,gemmX,gemmW} from './gemmComputation';
import './gemmComputation.css';

function dimensions(operator: OperatorDetail) {
  const { M, N, K } = operator.bindings;
  if ([M, N, K].every((value) => typeof value === "number")) return { M, N, K };
  const input = operator.inputs[0]?.tensor?.shape;
  const output = operator.outputs[0]?.tensor?.shape;
  if (!input || !output || input.includes(null) || output.includes(null)) {
    return { M: null, N: null, K: null };
  }
  const concreteInput = input as number[];
  const concreteOutput = output as number[];
  return {
    M: concreteInput.slice(0, -1).reduce((total, value) => total * value, 1),
    N: concreteOutput.at(-1) ?? null,
    K: concreteInput.at(-1) ?? null,
  };
}


export function GemmVisualizer({operator,resetKey,title="GEMM：沿 K 块累加一个输出 tile",context}:{operator:OperatorDetail;resetKey:string;title?:string;context?:string}) {
 const animation=useOperatorAnimation(7,resetKey),[selected,setSelected]=useState(0);
 const row=Math.floor(selected/2)*2,column=(selected%2)*2;
 const states=gemmTile(row,column),block=Math.min(1,Math.floor(animation.frame/3)),phase=animation.frame===6?3:animation.frame%3,state=states[block]!;
 const dims=dimensions(operator);
 const steps=[0,1].flatMap(b=>[
  {label:`K块${b+1}·加载`,description:`选定输出块的2行×2列；沿K读取第${b*2+1}–${b*2+2}项对应的X块与W块。`},
  {label:`K块${b+1}·相乘`,description:'每个块内输出计算2对元素乘加，得到2×2局部乘积。'},
  {label:`K块${b+1}·累加`,description:'C_acc ← C_acc + X_tile × W_tile；保留同一输出块累加器，继续下一段K。'},
 ]).concat([{label:'写出输出块',description:'K块全部遍历后，累加器就是选中2×2输出块；其它输出块按同样方法计算。'}]);
 const selectedCells=Array.from({length:4},(_,i)=>(row+Math.floor(i/2))*4+column+i%2);
 const xActive=Array.from({length:4},(_,i)=>(row+Math.floor(i/2))*4+state.k+i%2);
 const wActive=Array.from({length:4},(_,i)=>(state.k+Math.floor(i/2))*4+column+i%2);
 return <ComputationStepper title={title} formula="C_tile = Σₖ X_tile,k · W_k,tile" animation={animation} steps={steps} className="gemm-computation"
 dimensions={[{label:'当前 M',value:dims.M??'未填写'},{label:'当前 N',value:dims.N??'未填写'},{label:'当前 K',value:dims.K??'未填写'}]}
 footnote={<><p>4×4教学矩阵，tile为2×2；所示分块独立于实际Kernel配置。</p></>}>
 {context?<p>{context}</p>:null}
 <p>4×4 数值例 · 点击 C 的任意格，选择所在的 2×2 输出块。</p>
 <div className="gemm-tile-sources">
  <TileMatrix label="X · 当前K块" rows={4} columns={4} values={gemmX.flat()} active={xActive}/>
  <TileMatrix label="W · 当前K块" rows={4} columns={4} values={gemmW.flat()} active={wActive}/>
  <TileMatrix label="C · 选择输出块" rows={4} columns={4} values={Array.from({length:16},(_,i)=>selectedCells.includes(i)&&animation.frame===6?states[1]!.accumulator[selectedCells.indexOf(i)]!:'·')} selected={selectedCells} onSelect={i=>{setSelected(Math.floor(Math.floor(i/4)/2)*2+Math.floor((i%4)/2));animation.reset();}}/>
 </div>
 <p>输出块：第{row+1}–{row+2}行、第{column+1}–{column+2}列 · 当前K块 {block+1}/2</p>
 <div className="gemm-tile-product">
  <TileMatrix label="X tile" rows={2} columns={2} values={state.a}/><b>×</b>
  <TileMatrix label="W tile" rows={2} columns={2} values={state.b}/><b>→</b>
  <TileMatrix label="局部乘积" rows={2} columns={2} values={phase>=1?state.product:['—','—','—','—']}/>
 </div>
 <div className="gemm-tile-product">
  <TileMatrix label="原累加器" rows={2} columns={2} values={state.before}/><b>+</b>
  <TileMatrix label="本块贡献" rows={2} columns={2} values={phase>=1?state.product:['—','—','—','—']}/><b>→</b>
  <TileMatrix label={animation.frame===6?'最终输出 tile':'新累加器'} rows={2} columns={2} values={phase>=2?state.accumulator:['—','—','—','—']} active={phase>=2?[0,1,2,3]:[]}/>
 </div>
 </ComputationStepper>;
}
