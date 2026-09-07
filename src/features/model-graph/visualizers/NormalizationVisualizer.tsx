import type {OperatorDetail} from '../domain/types';
import {ComputationStepper} from './ComputationStepper';
import {TileMatrix,tileIndices,tileNumber as n} from './TileMatrix';
import {useOperatorAnimation} from './useOperatorAnimation';
import {normalizeExample} from './blockExamples';

const x=[1,2,3,4,5,6,7,8];
export function NormalizationVisualizer({operator,resetKey}:{operator:OperatorDetail;resetKey:string}) {
 const layer=operator.definitionId==='layer-norm';
 const e=normalizeExample(x,layer),width=operator.inputs[0]?.tensor?.shape.at(-1);
 const steps=layer?[
  {label:'块内求和',description:'同一特征行分成两个数据块，分别计算局部和。'},
  {label:'合并均值',description:'合并两个局部和，再除以完整行宽 D。所有块共享同一个均值。'},
  {label:'中心平方',description:'每个元素减去完整行均值后平方，再分别求块内平方和。'},
  {label:'合并方差',description:'合并两个平方和并除以 D，得到整行方差。'},
  {label:'归一化输出',description:'计算 rsqrt(方差 + ε)，将各块的中心化元素乘同一 scale 系数，写出 Y。'},
 ]:[
  {label:'处理块 1',description:'加载前半个特征行，平方后在块内求和。'},
  {label:'处理块 2',description:'继续处理同一行的后半块，得到第二个平方和。'},
  {label:'合并均方',description:'合并两块的平方和并除以完整行宽 D，得到整行均方。'},
  {label:'共享 scale',description:'用 rsqrt(均方 + ε) 得到整行共享的一个 scale 系数。'},
  {label:'归一化输出',description:'各块读取原始元素，乘这个 scale 系数，写出对应位置。'},
 ];
 const animation=useOperatorAnimation(steps.length,resetKey),f=animation.frame;
 const partial=(values:readonly number[])=>[values.slice(0,4).reduce((s,v)=>s+v,0),values.slice(4).reduce((s,v)=>s+v,0)];
 const squaresVisible=layer?f>=2:true,statsVisible=layer?f>=3:f>=2;
 const sums=partial(layer&&f<2?x:e.squares);
 const active=layer?tileIndices(0,8):f===0?tileIndices(0,4):f===1?tileIndices(4,4):tileIndices(0,8);
 return <ComputationStepper title={`${layer?'LayerNorm':'RMSNorm'}：分块归约，整行共享统计量`}
  formula={layer?'μ = mean(x)；v = mean((x − μ)²)；y = (x − μ) · rsqrt(v + ε)':'m = mean(x²)；y = x · rsqrt(m + ε)'}
  dimensions={[{label:'当前行宽 D',value:width?.toLocaleString()??'未填写'},{label:'归约范围',value:'单个 token 的全部特征'}]}
  steps={steps} animation={animation} className={layer?'layer-norm-computation':'rms-computation'}
  footnote={<><p>基础归一化模型；示例 D=8、每块 4 个元素、ε=10⁻⁵。中间统计量采用 FP32。</p>
   </>}>
  <div className="tile-example">
   <p>演示：同一特征行的 8 个元素，上下两行分别表示一个数据块。</p>
   <TileMatrix label="输入 X：块 1 / 块 2" rows={2} columns={4} values={x} active={active}/>
   {layer?<div className={`tile-stage${f===1?' is-active':''}`}><strong>整行均值 μ</strong><p>{f>=1?'(10 + 26) / 8 = 4.5':'合并两个块的局部和后可得'}</p></div>:null}
   <TileMatrix label={layer?'中心平方 (x − μ)²':'逐元素平方 x²'} rows={2} columns={4}
    values={e.squares.map((v,i)=>squaresVisible&&(layer||f>0||i<4)?n(v):'·')} active={active}/>
   <dl className="tile-statistics">
    {sums.map((v,i)=><div key={i}><dt>块 {i+1} {layer&&f<2?'元素和':'平方和'}</dt><dd>{!layer&&f===0&&i===1?'·':n(v)}</dd></div>)}
    <div><dt>{layer?'整行方差 v':'整行均方 m'}</dt><dd>{statsVisible?n(e.variance):'·'}</dd></div>
   </dl>
   <div className={`tile-stage${f===(layer?4:3)?' is-active':''}`}><strong>共享 scale 系数</strong><p>rsqrt({statsVisible?n(e.variance):'…'} + ε) = {f>=(layer?4:3)?n(e.scale):'·'}</p></div>
   <TileMatrix label="输出 Y：各块使用相同统计量" rows={2} columns={4} values={e.output.map(v=>f===4?n(v):'·')} active={f===4?tileIndices(0,8):[]}/>
  </div>
 </ComputationStepper>;
}
