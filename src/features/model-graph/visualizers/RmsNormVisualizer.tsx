import type {OperatorDetail} from '../domain/types';
import {ComputationStepper} from './ComputationStepper';
import {useOperatorAnimation} from './useOperatorAnimation';
import './normalizationPatchComputation.css';

const example=[1,-1,3,-3];
const meanSquare=example.reduce((sum,x)=>sum+x*x,0)/example.length;
const scale=1/Math.sqrt(meanSquare);

export function RmsNormVisualizer({operator,resetKey}:{operator:OperatorDetail;resetKey:string}) {
  const animation=useOperatorAnimation(4,resetKey);
  if (operator.definitionId!=='rms-norm') return null;
  const input=operator.inputs.find(port=>port.port==='input')?.tensor;
  const width=input?.shape.at(-1)??null;
  const active=(step:number)=>animation.frame===step?'is-active':'';
  const steps=[
    {label:'逐元素平方',description:<>读取同一个 token 的完整特征行，逐个计算 xᵢ²。</>},
    {label:'行内求平均',description:<>把这一行的 D 个平方值相加，再除以 D，得到一个均方值 m。</>},
    {label:'求缩放系数',description:<>s = rsqrt(m + ε) = 1 / √(m + ε)。整行共用这一个标量 s。</>},
    {label:'逐元素缩放',description:<>原始 xᵢ 分别乘同一个 s，得到 yᵢ；每个 token 行独立计算自己的 s。</>},
  ];
  return <ComputationStepper title="RMSNorm：一行共享一个缩放系数" formula="m = Σᵢxᵢ² / D；s = 1 / √(m + ε)；yᵢ = xᵢ · s"
    className="rms-computation" animation={animation} steps={steps}
    dimensions={[{label:'当前行宽 D',value:width??'未填写'},{label:'归约范围',value:'同一 token 的特征维'}]}
    footnote={<><p>当前逻辑节点只描述 X→Y 的基础归一化。ε 为数值稳定项，示例取 0 便于展示计算。</p><a href="https://arxiv.org/abs/1910.07467">RMSNorm 原论文</a>{' · '}<a href="https://docs.pytorch.org/docs/stable/generated/torch.nn.RMSNorm.html">PyTorch 公式说明</a></>}>
    <figure className="rms-computation-figure">
      <figcaption>独立演算示例：D=4，ε=0</figcaption>
      <div className="rms-computation-row"><strong>输入 x</strong><div>{example.map((x,i)=><span key={i}>{x}</span>)}</div></div>
      <div className={`rms-computation-row ${active(0)}`}><strong>平方 x²</strong><div>{example.map((x,i)=><span key={i}><small>{x<0?`(${x})`:x}²</small>{x*x}</span>)}</div></div>
      <div className={`rms-computation-reduction ${active(1)}`}>
        <svg viewBox="0 0 400 26" aria-hidden="true"><path d="M50 0 V10 H350 V0 M150 0 V10 M250 0 V10 M200 10 V24"/><path d="M195 19 L200 24 L205 19"/></svg>
        <strong>m = (1 + 1 + 9 + 9) / 4 = {meanSquare}</strong>
      </div>
      <div className={`rms-computation-scale ${active(2)}`}><span aria-hidden="true">↓</span><strong>s = rsqrt(5) ≈ {scale.toFixed(3)}</strong><small>同一行共享的缩放系数</small></div>
      <div className={`rms-computation-broadcast ${active(3)}`}>
        <svg viewBox="0 0 400 30" aria-hidden="true"><path d="M200 0 V10 M50 26 V10 H350 V26 M150 10 V26 M250 10 V26"/>{[50,150,250,350].map(x=><path key={x} d={`M${x-5} 21 L${x} 26 L${x+5} 21`}/>)}</svg>
        <div className="rms-computation-row"><strong>输出 y</strong><div>{example.map((x,i)=><span key={i}><small>{x} × s</small>{(x*scale).toFixed(3)}</span>)}</div></div>
      </div>
    </figure>
  </ComputationStepper>;
}
