import { useId, useState } from 'react';
import type { OperatorDetail } from '../domain/types';
import {GemmVisualizer} from './GemmVisualizer';
import {TilePicker} from './TileMatrix';
import { ComputationStepper } from './ComputationStepper';
import { useOperatorAnimation } from './useOperatorAnimation';
import { patchProjectionShape } from './patchProjectionShape';
import './normalizationPatchComputation.css';

function PatchImageVisualizer({operator,resetKey}:{operator:OperatorDetail;resetKey:string}) {
  const shape=patchProjectionShape(operator);
  const animation=useOperatorAnimation(4,resetKey);
  const clip=useId();
  if (!shape) return <p className="visualizer-empty">当前声明尚不能确定 patch 投影的尺寸。</p>;
  const {height,width,channels,patch,rows,columns,tokens,embedding}=shape;
  const vector=patch*patch*channels;
  const imageWidth=Math.min(160,120*width/height),imageHeight=imageWidth*height/width;
  const imageX=(180-imageWidth)/2,imageY=(140-imageHeight)/2;
  const selectedRow=Math.min(2,rows-1),selectedColumn=Math.min(2,columns-1);
  const selectedIndex=selectedRow*columns+selectedColumn+1;
  const active=(step:number)=>animation.frame===step?'is-active':'';
  const steps=[
    {label:'一幅图像',description:<>一幅 {height}×{width} 图像有 {channels} 个通道，按 {patch}×{patch} patch 划分。</>},
    {label:'选一个 patch',description:<>选中第 {selectedRow+1} 行、第 {selectedColumn+1} 列；取出全部 {channels} 个通道，共 {vector} 个数。</>},
    {label:'投影成向量',description:<>每个输出维度用一组权重，对 patch 的 {vector} 个数乘加；{embedding} 组权重生成 {embedding} 维 token。</>},
    {label:'组成序列',description:<>所有 {tokens} 个位置共享同一组投影权重，按位置组成 {tokens}×{embedding} 的 token 序列。</>},
  ];
  return <ComputationStepper title="patch 如何变成 token" formula="zⱼ = flatten(patchⱼ) · W" animation={animation} steps={steps}
    className="patch-computation"
    dimensions={[{label:'图像',value:`${height} × ${width} × ${channels}`},{label:'patch',value:`${patch} × ${patch} × ${channels}`},{label:'输出',value:`${tokens} × ${embedding}`}]}
    footnote={<><p>当前 patch 投影按不重叠位置展开；等价卷积核大小与步长均为 P。共享投影核形状 P×P×C×D，展平为矩阵 P²C×D。</p><a href="https://arxiv.org/abs/2010.11929">ViT 论文 · §3.1</a></>}>
    <div className="patch-computation-top">
      <div className={`patch-computation-card ${active(0)}`}>
        <strong>一幅图像</strong>
        <svg viewBox="0 0 180 144" role="img" aria-label={`${rows}行${columns}列 patch，选中一个 patch`}>
          <defs><clipPath id={clip}><rect x={imageX} y={imageY} width={imageWidth} height={imageHeight} rx="4"/></clipPath></defs>
          <g clipPath={`url(#${clip})`}>
            <rect x="10" y="10" width="160" height="120" fill="#e1eff5"/>
            <circle cx="137" cy="34" r="13" fill="#efcc77"/>
            <path d="M10 108 L53 51 L105 114 L139 70 L170 103 V130 H10Z" fill="#96b5b1"/>
            {Array.from({length:columns+1},(_,i)=><path key={`c${i}`} d={`M${imageX+i*imageWidth/columns} ${imageY} V${imageY+imageHeight}`} className="patch-computation-grid"/>)}
            {Array.from({length:rows+1},(_,i)=><path key={`r${i}`} d={`M${imageX} ${imageY+i*imageHeight/rows} H${imageX+imageWidth}`} className="patch-computation-grid"/>)}
            <rect x={imageX+selectedColumn*imageWidth/columns} y={imageY+selectedRow*imageHeight/rows} width={imageWidth/columns} height={imageHeight/rows} fill="#f7d17d" stroke="#a66e11" strokeWidth="2"/>
          </g>
        </svg>
        <small>{rows} × {columns} 个位置 · 图像示意</small>
      </div>
      <span className="patch-computation-arrow" aria-hidden="true">→</span>
      <div className={`patch-computation-card ${active(1)}`}>
        <strong>选中的 P×P×C patch</strong>
        <svg viewBox="0 0 180 144" role="img" aria-label="patch 包含全部输入通道">
          {Array.from({length:Math.min(channels,3)},(_,i)=>Math.min(channels,3)-i-1).map(i=><g key={i} transform={`translate(${38+i*14} ${18+i*10})`}>
            <rect width="80" height="80" rx="3" fill={['#ffe4a5','#cbdeda','#cfdfed'][i]} stroke="#688c91"/>
            {[1,2,3].map(j=><path key={j} d={`M${j*20} 0 V80 M0 ${j*20} H80`} stroke="#7d939b" strokeWidth=".6"/>)}</g>)}
          <text x="90" y="136" textAnchor="middle">{patch} × {patch} × {channels}</text>
        </svg>
        <small>取出全部通道 → {vector} 个数</small>
      </div>
    </div>
    <div className={`patch-computation-projection ${active(2)}`}>
      <span><strong>patch 向量</strong><span className="math-expression">1 × {vector}</span></span><b aria-hidden="true">×</b>
      <span className="patch-computation-weight"><strong>共享权重 W</strong><span className="math-expression">{vector} × {embedding}</span></span><b aria-hidden="true">→</b>
      <span><strong>token zⱼ</strong><span className="math-expression">1 × {embedding}</span></span>
    </div>
    <div className={`patch-computation-sequence ${active(3)}`}>
      <strong>按图像位置排列的 token 序列</strong>
      <div><span>z₁</span><span>z₂</span><i>…</i><span className="is-selected">z{selectedIndex}</span><i>…</i><span>z{tokens}</span></div>
      <small>每个 token 都有 {embedding} 维 · 每幅图像 {tokens} 个 token</small>
    </div>
  </ComputationStepper>;
}

/** Logical matrix dimensions only; the input patches can be loaded implicitly. */
export function patchGemmOperator(operator:OperatorDetail):OperatorDetail|null {
 const shape=patchProjectionShape(operator);if(!shape)return null;
 const elements=(port:OperatorDetail['inputs'][number]|undefined)=>port?.tensor&&port.tensor.shape.every(n=>n!==null&&Number.isSafeInteger(n)&&n>0)?port.tensor.shape.reduce<number>((p,n)=>p*n!,1):null;
 const input=elements(operator.inputs.find(p=>p.port==='image')),output=elements(operator.outputs.find(p=>p.port==='output'));
 if(input===null||output===null)return null;
 const M=output/shape.embedding,K=shape.patch**2*shape.channels,N=shape.embedding;
 if(!Number.isSafeInteger(M)||M<=0||input!==M*K)return null;
 return {...operator,bindings:{...operator.bindings,M,N,K},formula:'token = flatten(patch) × W'};
}

export function PatchVisualizer({operator,resetKey}:{operator:OperatorDetail;resetKey:string}) {
 const [mode,setMode]=useState(0);
 const projection=patchGemmOperator(operator);
 return <div className="patch-calculation-views">
  <TilePicker selected={mode} onSelect={setMode} labels={['图像到token','投影分块计算']}/>
  {mode===0?<PatchImageVisualizer operator={operator} resetKey={resetKey}/>:projection?
   <GemmVisualizer operator={projection} resetKey={`${resetKey}:projection`} title="patch 投影：沿像素与通道块乘加" context="M=B×V×T 个 patch，K=P²C，N=D；可直接从原图隐式读取 patch 元素。下方4×4为独立数值示例。"/>
   :<p className="visualizer-empty">patch 总数或输入／输出尺寸待补充。</p>}
 </div>;
}
