import {useState,type ReactNode} from 'react';
import type {OperatorDetail} from '../domain/types';
import {attentionShapeFromDetail} from '../../roofline/presentation/attentionInput';
import {ComputationStepper} from './ComputationStepper';
import {useOperatorAnimation} from './useOperatorAnimation';
import {attentionExample as e} from './attentionComputation';
import './attentionComputation.css';

const number=(value:number)=>Number.isInteger(value)?String(value):value.toFixed(3);
const vector=(values:readonly number[])=>`[${values.map(number).join(', ')}]`;
const steps=[
 {label:'点积',description:'取一个查询行 q，与各个 key 行点积，得到这一行的相关性分数。'},
 {label:'缩放与掩码',description:'分数除以 √dₖ；不可访问的位置设为 −∞。示例屏蔽第 3 个位置。'},
 {label:'行 Softmax',description:'减去行最大值后取指数，再除以该行指数和，得到总和为 1 的权重。'},
 {label:'加权汇总 V',description:'每个权重乘对应的 value 向量，再相加，形成一个输出行 o。'},
];
export function AttentionVisualizer({operator,resetKey}:{operator:OperatorDetail;resetKey:string}) {
 const animation=useOperatorAnimation(steps.length,resetKey),frame=animation.frame;
 const [selected,setSelected]=useState(0);
 const shape=attentionShapeFromDetail(operator);
 const dimensions=shape?[
  {label:'Q 长度',value:shape.queryTokens.toLocaleString()},
  {label:'K/V 长度',value:shape.keyTokens.toLocaleString()},
  {label:'查询头 / K/V 头',value:`${shape.queryHeads} / ${shape.kvHeads}`},
  {label:'dₖ / dᵥ',value:`${shape.qkDimension} / ${shape.valueDimension}`},
 ]:[{label:'当前形状',value:'端口形状待补充'}];
 const row=(label:string,cells:readonly ReactNode[],active:boolean)=> <div className={`attention-example-row${active?' is-active':''}`}>
  <strong>{label}</strong>{cells.map((value,index)=><span key={index} className={`${selected===index?'is-selected ':''}${index===2&&frame>0?'is-masked':''}`}>{value}</span>)}
 </div>;
 const selectedDetail=[
  `q · k${selected+1} = 1 × ${e.keys[selected]![0]} + 1 × ${e.keys[selected]![1]} = ${e.scores[selected]}`,
  selected===2?'第 3 项被屏蔽：0 / √2 → −∞':`${e.scores[selected]} / √2 = ${number(e.scaled[selected]!)}`,
  selected===2?'exp(−∞) = 0，因此这个位置的权重为 0':`p${selected+1} = ${number(e.exponentials[selected]!)} / ${number(e.exponentials.reduce((a,b)=>a+b,0))} = ${number(e.weights[selected]!)}`,
  `p${selected+1} × v${selected+1} = ${number(e.weights[selected]!)} × ${vector(e.values[selected]!)} = ${vector(e.contributions[selected]!)}`,
 ][frame];
 return <ComputationStepper title="Attention：一行查询如何得到输出" formula="O = softmax(QKᵀ / √dₖ + mask) V"
  dimensions={dimensions} steps={steps} animation={animation} className="attention-visualizer attention-computation"
  footnote={<><p>当前尺寸来自 Q/K/V 端口。{shape&&shape.queryHeads!==shape.kvHeads?`每 ${shape.queryHeads/shape.kvHeads} 个查询头共享一组 K/V；各查询头分别计算权重和输出。`:'每个头独立计算注意力。'}</p>
   <p><a href="https://arxiv.org/abs/1706.03762" target="_blank" rel="noreferrer">Attention Is All You Need §3.2.1</a> · <a href="https://docs.pytorch.org/docs/stable/generated/torch.nn.functional.scaled_dot_product_attention.html" target="_blank" rel="noreferrer">PyTorch SDPA 与 GQA 形状约定</a></p></>}>
  <div className="attention-example" aria-label="Attention 示意数值矩阵">
   <div className="attention-example-caption"><strong>示意数值</strong><span>1 个查询 · 3 个 key · dₖ = dᵥ = 2</span></div>
   <p className="attention-example-query">q = <b>{vector(e.query)}</b><span>点击一列，跟踪这个位置的计算。</span></p>
   <div className="attention-example-row attention-example-columns"><span>位置</span>{e.keys.map((_,index)=><button type="button" key={index} aria-pressed={selected===index} onClick={()=>setSelected(index)}>第 {index+1} 项</button>)}</div>
   {row('K 行',e.keys.map(vector),frame===0)}
   {row('q · k',e.scores.map(number),frame===0)}
   {row('缩放 / mask',e.scaled.map((value,index)=>frame<1?'—':index===2?'−∞':number(value)),frame===1)}
   {row('权重 p',e.weights.map((value,index)=>frame<2?'—':<span className="attention-weight"><i style={{width:`${value*100}%`}}/><b>{number(value)}</b>{index===2?<small>屏蔽</small>:null}</span>),frame===2)}
   {row('V 行',e.values.map(vector),frame===3)}
   {row('p × v',e.contributions.map(value=>frame<3?'—':vector(value)),frame===3)}
   <div className="attention-example-detail" aria-live="polite">{selectedDetail}</div>
   <div className={`attention-example-output${frame===3?' is-active':''}`}><span>输出 o = Σ pⱼvⱼ</span><strong>{frame===3?vector(e.output):'[—, —]'}</strong></div>
  </div>
 </ComputationStepper>;
}
