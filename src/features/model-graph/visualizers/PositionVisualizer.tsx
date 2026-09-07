import {useState} from 'react';
import type {OperatorDetail} from '../domain/types';
import {ComputationStepper} from './ComputationStepper';
import {TileMatrix,TilePicker,tileIndices,tileNumber as n} from './TileMatrix';
import {useOperatorAnimation} from './useOperatorAnimation';
import {rotatePair,vectorShape} from './blockExamples';

const pairs=[[1,0],[0,1],[1,1],[2,-1]] as const;
const angles=[0,Math.PI/2,Math.PI/4,Math.PI];
const frequencies=[1,2,4,8];
export function PositionVisualizer({operator,resetKey}:{operator:OperatorDetail;resetKey:string}) {
 const rope=operator.definitionId==='rope';
 const count=(shape:readonly (number|null)[]|undefined)=>shape&&shape.every(n=>n!==null&&Number.isSafeInteger(n)&&n>0)?shape.reduce<number>((p,n)=>p*n!,1):null;
 const times=count(operator.inputs[0]?.tensor?.shape),outputShape=operator.outputs[0]?.tensor?.shape;
 const outputRows=outputShape?count(outputShape.slice(0,-1)):null;
 const broadcasts=times!==null&&outputRows!==null&&outputRows>times&&outputRows%times===0;
 const [block,setBlock]=useState(0),indices=tileIndices(block*2,2),cells=indices.flatMap(i=>[2*i,2*i+1]);
 const steps=rope?[
  {label:'读取特征块',description:'将特征维成对分组，一次处理两对元素；每对共享同一旋转角。'},
  {label:'读取位置系数',description:'按位置与特征对索引读取已准备好的 cosθ、sinθ。'},
  {label:'成对旋转',description:'每对 (a,b) 变为 (a·cosθ − b·sinθ, a·sinθ + b·cosθ)。'},
  {label:'写回特征块',description:'将旋转结果写到同一位置，继续处理下一组特征对。'},
 ]:[
  {label:'读取频率块',description:'同一个时间 t 与各个频率相乘；示例每次处理两个频率。'},
  {label:'计算相位',description:'φᵢ = t·ωᵢ。频率表已包含所需周期系数。'},
  {label:'计算 sin/cos',description:'逐相位计算 sinφᵢ、cosφᵢ，分别写入时间向量的两半。'},
  {label:broadcasts?'广播到位置':'写出时间向量',description:broadcasts?'本频率块的结果沿动作位置广播。其他频率块填入向量的其余维度。':'写出本频率块的sin/cos结果，其他块写入向量的其余维度；每个时间值输出一份向量。'},
 ];
 const animation=useOperatorAnimation(steps.length,resetKey),f=animation.frame;
 const output=pairs.map(([a,b],i)=>rotatePair(a,b,angles[i]!));
 const phase=frequencies.map(w=>.5*w),timeOutput=[...phase.map(Math.sin),...phase.map(Math.cos)];
 const outputCells=[...indices,...indices.map(i=>i+4)];
 return <ComputationStepper title={rope?'RoPE：按特征对分块旋转':'时间嵌入：按频率分块，生成共享向量'}
  formula={rope?'(a′, b′) = (a cosθ − b sinθ, a sinθ + b cosθ)':'φ = t · ω；embedding = [sinφ, cosφ]'}
  dimensions={[{label:'当前输入',value:vectorShape(operator.inputs[0]?.tensor?.shape)},{label:'当前输出',value:vectorShape(operator.outputs[0]?.tensor?.shape)}]}
  animation={animation} steps={steps} className={rope?'rope-computation':'time-embedding-computation'}
  footnote={<>{rope?<><p>完整偶数维旋转模型，演示采用相邻配对和给定角度。</p><a href="https://arxiv.org/abs/2104.09864" target="_blank" rel="noreferrer">RoFormer · 二维旋转公式</a></>
   :<><p>演示 t=0.5、ω=[1,2,4,8]；实际频率间距由模型定义。</p><a href="https://arxiv.org/abs/1706.03762" target="_blank" rel="noreferrer">正弦与余弦编码</a></>}</>}>
  <div className="tile-example">
   <p>{rope?'演示：4 对特征，每块处理两对。':'演示：4 个频率，每块生成两组 sin/cos。'}</p>
   <TilePicker selected={block} onSelect={i=>{setBlock(i);animation.reset();}}/>
   {rope?<>
    <div className="tile-flow">
     <TileMatrix label="输入特征对 (a,b)" rows={4} columns={2} values={pairs.flat()} active={cells}/>
     <TileMatrix label="位置系数 (cosθ,sinθ)" rows={4} columns={2} values={angles.flatMap(a=>[n(Math.cos(a)),n(Math.sin(a))])} active={f>=1?cells:[]}/>
    </div>
    <div className={`tile-stage${f===2?' is-active':''}`}><strong>当前块的第一对特征</strong><p className="math-expression">{f>=2?`(${pairs[indices[0]!]!.join(', ')}) → (${output[indices[0]!]!.map(n).join(', ')})`:'取出对应特征与旋转系数'}</p></div>
    <TileMatrix label="输出特征对 (a′,b′)" rows={4} columns={2} values={output.flatMap((v,i)=>v.map(x=>f===3&&indices.includes(i)?n(x):'·'))} active={f===3?cells:[]}/>
   </>:<>
    <TileMatrix label="共享频率表 ω" rows={1} columns={4} values={frequencies} active={indices}/>
    <TileMatrix label="相位 φ = 0.5 × ω" rows={1} columns={4} values={phase.map((v,i)=>f>=1&&indices.includes(i)?n(v):'·')} active={f===1?indices:[]}/>
    <TileMatrix label="时间向量：上半 sin / 下半 cos" rows={2} columns={4} values={timeOutput.map((v,i)=>f>=2&&outputCells.includes(i)?n(v):'·')} active={f>=2?outputCells:[]}/>
    <div className={`tile-stage${f===3?' is-active':''}`}><strong>{broadcasts?'广播到动作位置':'写出时间向量'}</strong><p>{f===3?(broadcasts?'当前频率块 → 位置 1、位置 2、…；各位置沿用相同数值。':'将本块sin/cos结果写入对应维度，保留一份时间向量。'):'处理各频率块后组成完整时间向量。'}</p></div>
   </>}
  </div>
 </ComputationStepper>;
}
