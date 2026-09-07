import type {OperatorDetail} from '../domain/types';
import {attentionShapeFromDetail} from '../../roofline/presentation/attentionInput';
import {ComputationStepper} from './ComputationStepper';
import {TileMatrix} from './TileMatrix';
import {useOperatorAnimation} from './useOperatorAnimation';
import {attentionTileInput,attentionTileWalkthrough} from './attentionComputation';
import './attentionComputation.css';
const number=(n:number)=>n===-Infinity?'−∞':Number.isInteger(n)?String(n):n.toFixed(3);
export function AttentionVisualizer({operator,resetKey}:{operator:OperatorDetail;resetKey:string}) {
 const shape=attentionShapeFromDetail(operator),animation=useOperatorAnimation(11,resetKey);
 const {blocks,output}=attentionTileWalkthrough(),block=Math.min(1,Math.floor(animation.frame/5)),phase=animation.frame===10?5:animation.frame%5,state=blocks[block]!;
 const steps=[0,1].flatMap(b=>[
  {label:`块${b+1}·载入`,description:`固定2×2 Q tile，加载第${b*2+1}–${b*2+2}行K/V；保留每个查询行的m、l和输出累加器A。`},
  {label:`块${b+1}·QK`,description:'Q tile × K tileᵀ 得到2×2分数块：每个格对应一个query与key的点积。'},
  {label:`块${b+1}·mask`,description:'分数除以√2，屏蔽格设为−∞，其指数权重为0。这里使用演示mask。'},
  {label:`块${b+1}·softmax`,description:'m′=max(m,行最大值)，α=exp(m−m′)，P̃=exp(S−m′)；l′=αl+行和(P̃)。P̃尚未归一化。'},
  {label:`块${b+1}·PV`,description:'A′=αA+P̃V：历史输出累加器与分母一起重缩放，再加入本块贡献。'},
 ]).concat([{label:'归一化输出',description:'两个KV块遍历完毕，逐查询行 O=A/l。与一次性计算完整masked softmax得到同样结果。'}]);
 const activeRows=[state.start*2,state.start*2+1,(state.start+1)*2,(state.start+1)*2+1];
 const matrix=(label:string,values:readonly (string|number)[]) => <TileMatrix label={label} rows={2} columns={2} values={values}/>;
 const show=(values:number[][],visible:boolean)=>visible?values.flat().map(number):['—','—','—','—'];
 return <ComputationStepper title="Attention：固定 Q tile，遍历 K/V 块" formula="m′=max(m,max S)；l′=αl+ΣP̃；A′=αA+P̃V；O=A/l" animation={animation} steps={steps} className="attention-computation"
 dimensions={[{label:'当前 Q 长度',value:shape?.queryTokens??'未填写'},{label:'当前 K/V 长度',value:shape?.keyTokens??'未填写'},{label:'当前 dₖ / dᵥ',value:shape?`${shape.qkDimension} / ${shape.valueDimension}`:'未填写'}]}
 footnote={<><p>教学例：2个query、4个key，dₖ=dᵥ=2，KV块大小2。分块与mask用于数学演算；当前实际形状另列。</p><p>自然指数与教程的exp2缩放形式等价。当前头数{shape?` ${shape.queryHeads} Q / ${shape.kvHeads} KV`:'待填写'}。</p><a href="https://triton-lang.org/main/getting-started/tutorials/06-fused-attention.html">Triton · 在线分块 Attention</a></>}>
 <p>2×2 Q tile 驻留 · K/V 块 {block+1}/2 · 数值教学例</p>
 <div className="attention-tile-sources">
  <TileMatrix label="Q · 固定查询块" rows={2} columns={2} values={attentionTileInput.q.flat()} selected={[0,1,2,3]}/>
  <TileMatrix label="K · 当前2行" rows={4} columns={2} values={attentionTileInput.k.flat()} active={activeRows}/>
  <TileMatrix label="V · 对应2行" rows={4} columns={2} values={attentionTileInput.v.flat()} active={activeRows}/>
 </div>
 <div className="attention-tile-pair">{matrix('QKᵀ 分数块',show(state.scores,phase>=1))}{matrix('S · 缩放与mask',show(state.scaled,phase>=2))}</div>
 <div className="attention-tile-state">
  <TileMatrix label="每行状态 · m → m′" rows={2} columns={1} values={state.before.m.map((m,i)=>`${number(m)} → ${phase>=3?number(state.m[i]!):'—'}`)}/>
  <TileMatrix label="历史重缩放 α" rows={2} columns={1} values={phase>=3?state.alpha.map(number):['—','—']}/>
  <TileMatrix label="分母 l → l′" rows={2} columns={1} values={state.before.l.map((l,i)=>`${number(l)} → ${phase>=3?number(state.l[i]!):'—'}`)}/>
 </div>
 <div className="attention-tile-pair">{matrix('P̃ · 未归一化指数',show(state.p,phase>=3))}{matrix('P̃ × V · 本块贡献',show(state.pv,phase>=4))}</div>
 <div className="attention-tile-pair">{matrix('历史 A · 先乘 α',show(state.before.acc.map((row,i)=>row.map(x=>x*state.alpha[i]!)),phase>=3))}{matrix('A′ · 累积输出',show(state.acc,phase>=4))}</div>
 {animation.frame===10?<TileMatrix label="O=A/l · 最终输出 tile" rows={2} columns={2} values={output.flat().map(number)} active={[0,1,2,3]}/>:null}
 </ComputationStepper>;
}
