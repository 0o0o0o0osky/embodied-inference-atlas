import {concatCostFromDetail} from '../domain/concatCost';
import {ExpansionLayoutVisualizer} from './ExpansionLayoutVisualizer';
import {useState} from 'react';
import type {OperatorDetail} from '../domain/types';
import {ComputationStepper} from './ComputationStepper';
import {TileMatrix,TilePicker} from './TileMatrix';
import {useOperatorAnimation} from './useOperatorAnimation';
import {layoutExample,type LayoutExampleKind} from './layoutLookupComputation';
import {slicePresentation} from '../presentation/slicePresentation';

function BasicLayoutVisualizer({operator,resetKey}:{operator:OperatorDetail;resetKey:string}) {
 const kind=operator.definitionId as LayoutExampleKind;
 const slice=slicePresentation(operator);
 const shapeRank=operator.inputs[0]?.tensor?.shape.length ?? 0;
 const lastWidth=operator.inputs[0]?.tensor?.shape.at(-1);
 const columnSlice=slice?.axis===shapeRank-1&&slice.start!=null&&slice.stop!=null&&lastWidth!=null&&lastWidth>0;
 const e=layoutExample(kind,columnSlice?{axis:'column',start:slice.start!,stop:slice.stop!,size:lastWidth!}:undefined);
 const [mode,setMode]=useState(0),[selected,setSelected]=useState(e.indices[0]??0);
 const animation=useOperatorAnimation(3,resetKey);
 if(!['concat','reshape','slice','permute-rearrange'].includes(kind))return null;
 const position=e.indices.indexOf(selected),copy=mode===1;
 const shape=(ports:OperatorDetail['inputs'])=>ports.map(p=>p.tensor?p.tensor.shape.map(n=>n??'?').join('×'):'未填写').join('；');
 const mapping=kind==='concat'?'A的2行后接B的1行，元素身份与各自行内次序保留。':kind==='reshape'?'2×3改为3×2，线性元素顺序保持1、2、3、4、5、6。':kind==='slice'?(e.columnSlice?`教学例：3×3 输入保留全部行，取列范围 [${e.sliceStart}, ${e.sliceStop})，输出为 3×${e.outputColumns}。`:'教学例：3×3 输入只选第2行，输出为[4,5,6]。'):'2×3转置为3×2，输出(i,j)对应输入(j,i)。';
 const condition=kind==='concat'?'生产者已直接写入同一目标buffer的相邻分区。':kind==='reshape'?'输入连续且所需shape与步幅兼容。':kind==='slice'?`选中${e.columnSlice?'列':'行'}可由原存储的偏移和步幅访问。`:'输出转置视图以步幅(1,3)访问原2×3存储。';
 const address=(source:number)=>kind==='concat'&&copy?(source<6?`A[${source}]`:`B[${source-6}]`):`S[${source}]`;
 const steps=[{label:'选定元素',description:'点击输入或输出格，追踪同一个元素的身份。'},
  {label:'映射位置',description:mapping},
  {label:copy?'写入新buffer':'使用视图',description:copy?'读取输出所需的源元素，按输出顺序写到新buffer T。':condition}];
 return <ComputationStepper title="布局变换：元素去哪里" formula={slice?.formula??operator.formula} animation={animation} steps={steps} className="layout-computation"
 dimensions={[{label:'当前输入',value:shape(operator.inputs)},{label:'当前输出',value:shape(operator.outputs)}]}
 footnote={<><p>小矩阵与地址S/T是独立教学例，实际stride和buffer布局由实现决定。</p></>}>
 {slice?<p>{slice.explanation}</p>:null}
 <div className="tile-example">
 <p>独立数值示例 · 格内数字是元素身份</p>
 {kind==='slice'?<p>{mapping}</p>:null}
 <TilePicker selected={mode} onSelect={value=>{setMode(value);animation.reset();}} labels={[kind==='concat'?'相邻预布局':'兼容视图','物化拷贝']}/>
 <div className="tile-flow">
 {kind==='concat'?<div><TileMatrix label="输入 A · 2×3" rows={2} columns={3} values={e.source.slice(0,6)} selected={selected<6?[selected]:[]} onSelect={setSelected}/><TileMatrix label="输入 B · 1×3" rows={1} columns={3} values={e.source.slice(6)} selected={selected>=6?[selected-6]:[]} onSelect={i=>setSelected(i+6)}/></div>
 :<TileMatrix label="输入 S" rows={e.inputRows} columns={e.inputColumns} values={e.source} selected={[selected]} muted={kind==='slice'?e.source.map((_,i)=>i).filter(i=>!e.indices.includes(i)):[]} onSelect={setSelected}/>}
 <TileMatrix label={copy?'输出 T · 新存储':'输出视图 · 同一存储'} rows={e.outputRows} columns={e.outputColumns} values={animation.frame>=1?e.output:e.output.map(()=> '·')} selected={position>=0?[position]:[]} active={animation.frame===2?e.indices.map((_,i)=>i):[]} onSelect={i=>setSelected(e.indices[i]!)}/>
 </div>
 <div className={`tile-stage${animation.frame===1?' is-active':''}`} aria-live="polite"><strong>选中元素 {e.source[selected]}</strong><p>{position<0?`该元素不属于本次选取的目标${e.columnSlice?'列':'行'}。`:`${address(selected)} → 输出(${Math.floor(position/e.outputColumns)}, ${position%e.outputColumns}) → ${copy?`T[${position}]`:address(selected)}`}</p></div>
 <p>{copy?`物化路径：读取并写入 ${e.output.length} 个目标元素。`:`0 个元素额外拷贝 · 条件：${condition}`}</p>
 </div>
 </ComputationStepper>;
}

export function LayoutVisualizer({operator,resetKey}:{operator:OperatorDetail;resetKey:string}) {
 // Equal byte width is used only to classify changes in element count.
 const kind=concatCostFromDetail(operator,8)?.operation;
 if(kind==='zero-pad'||kind==='broadcast')return <ExpansionLayoutVisualizer operator={operator} resetKey={resetKey} kind={kind}/>;
 if(kind==='expanded-layout')return <p className="visualizer-empty">输出元素增加，当前布局扩展规则待说明。</p>;
 return <BasicLayoutVisualizer operator={operator} resetKey={resetKey}/>;
}
