import {useState} from 'react';
import type {OperatorDetail} from '../domain/types';
import {ComputationStepper,type ComputationStep} from './ComputationStepper';
import {TileMatrix,TilePicker,tileIndices,tileNumber as n} from './TileMatrix';
import {useOperatorAnimation} from './useOperatorAnimation';
import {exampleVector as x,exampleRight as b,sigmoid,geluPolynomial,geluTanh,vectorShape} from './blockExamples';

const titles:Record<string,string>={'gelu':'GELU（tanh 近似）','silu':'SiLU','residual-add':'残差相加','elementwise-multiply':'逐元素乘法','euler-update':'Euler 更新','scalar-scale':'标量 scale'};
export function ElementwiseVisualizer({operator,resetKey}:{operator:OperatorDetail;resetKey:string}) {
 const kind=operator.definitionId,activation=kind==='gelu'||kind==='silu',gelu=kind==='gelu';
 const [block,setBlock]=useState(0),indices=tileIndices(block*4,4);
 const steps:ComputationStep[]=activation?[
  {label:'读取数据块',description:'选取连续的 4 个元素，每个元素沿相同公式独立计算。'},
  {label:gelu?'三次多项式':'指数与分母',description:gelu?'逐元素计算 z = √(2/π) · (x + 0.044715x³)。':'逐元素求 exp(−x)，再加 1 得到 sigmoid 的分母。'},
  {label:'Gate 系数',description:gelu?'g = (1 + tanh(z))/2，也可写成 1/(1 + exp(−2z))。':'g = 1/(1 + exp(−x))。本块每个元素有自己的 Gate 系数。'},
  {label:'相乘并写回',description:'将原始 x 乘 Gate 系数 g，写到输出的对应位置。其他数据块执行同一过程。'},
 ]:[
  {label:'读取数据块',description:kind==='scalar-scale'?'读取一块输入；本块共用一个预先确定的 α。':'读取输出块所需的两个输入块，对齐相应元素。'},
  {label:kind==='euler-update'?'乘加更新':'逐元素计算',description:kind==='euler-update'?'x_next = x + Δt·v 可合并为一次乘加；演示 Δt = −0.1。':kind==='scalar-scale'?'本块每个元素乘相同标量；演示 α=2。':kind==='residual-add'?'相同位置的 residual 和 update 相加，得到对应输出。':'相同位置的 A 和 B 相乘；广播输入按输出索引取得对应值。'},
  {label:'写回输出块',description:'将结果写到对应输出位置，再处理其他数据块。'},
 ];
 const animation=useOperatorAnimation(steps.length,resetKey),f=animation.frame,last=steps.length-1;
 const output=x.map((v,i)=>gelu?geluTanh(v):kind==='silu'?v*sigmoid(v):kind==='residual-add'?v+b[i]!:kind==='elementwise-multiply'?v*b[i]!:kind==='euler-update'?v-.1*b[i]!:v*2);
 const formula=gelu?'z = √(2/π)(x + 0.044715x³)；y = x · (1 + tanh(z))/2':operator.formula;
 const gate=x.map(v=>sigmoid(gelu?2*geluPolynomial(v):v));
 const sampleFormula=kind==='residual-add'?`${x[block*4]} + ${b[block*4]} = ${n(output[block*4]!)}`:kind==='elementwise-multiply'?`${x[block*4]} × ${b[block*4]} = ${n(output[block*4]!)}`:kind==='euler-update'?`${x[block*4]} − 0.1 × ${b[block*4]} = ${n(output[block*4]!)}`:`${x[block*4]} × 2 = ${n(output[block*4]!)}`;
 return <ComputationStepper title={`${titles[kind]}：逐块处理连续元素`} formula={formula} animation={animation} steps={steps}
  className={`elementwise-computation ${kind}-computation`}
  dimensions={[{label:'当前输入形状',value:vectorShape(operator.inputs[0]?.tensor?.shape)},{label:'当前输出形状',value:vectorShape(operator.outputs[0]?.tensor?.shape)}]}
  footnote={<>{!activation?<p>同一输出索引确定所需的输入元素；广播通过索引映射取得数值。</p>:null}
   <p>演示用 8 个元素、每块 4 个；当前模型的张量尺寸见上方。</p></>}>
  <div className="tile-example">
   <p>演示：每行一个 4 元素数据块；可切换查看另一块。</p>
   <TilePicker selected={block} onSelect={i=>{setBlock(i);animation.reset();}}/>
   <div className="tile-flow">
    <TileMatrix label={kind==='euler-update'?'当前状态 x':'输入 X'} rows={2} columns={4} values={x} active={indices}/>
    {!activation&&kind!=='scalar-scale'?<TileMatrix label={kind==='euler-update'?'速度 v':'第二输入'} rows={2} columns={4} values={b} active={indices}/>:null}
   </div>
   {activation?<>
    <TileMatrix label={gelu?'当前块 z：三次多项式结果':'当前块分母：1 + exp(−x)'} rows={1} columns={4}
     values={indices.map(i=>f>=1?n(gelu?geluPolynomial(x[i]!):1+Math.exp(-x[i]!)):'·')} active={f===1?tileIndices(0,4):[]}/>
    <TileMatrix label="当前块 Gate 系数 g" rows={1} columns={4} values={indices.map(i=>f>=2?n(gate[i]!):'·')} active={f===2?tileIndices(0,4):[]}/>
   </>:<div className={`tile-stage${f===1?' is-active':''}`}><strong>当前块的第一个输出元素</strong><p className="math-expression">{f>=1?sampleFormula:'选取输入后计算'}</p></div>}
   <TileMatrix label="输出 Y" rows={2} columns={4} values={output.map((v,i)=>f===last&&indices.includes(i)?n(v):'·')} active={f===last?indices:[]}/>
  </div>
 </ComputationStepper>;
}
