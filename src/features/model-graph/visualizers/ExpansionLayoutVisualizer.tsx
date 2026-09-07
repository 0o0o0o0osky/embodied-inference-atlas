import {useState} from 'react';
import type {OperatorDetail} from '../domain/types';
import {ComputationStepper} from './ComputationStepper';
import {TileMatrix,TilePicker} from './TileMatrix';
import {useOperatorAnimation} from './useOperatorAnimation';
import {expansionLayoutExample} from './layoutLookupComputation';

export function ExpansionLayoutVisualizer({operator,resetKey,kind}:{operator:OperatorDetail;resetKey:string;kind:'zero-pad'|'broadcast'}) {
 const animation=useOperatorAnimation(3,resetKey),[mode,setMode]=useState(0),[selected,setSelected]=useState(0);
 const pad=kind==='zero-pad',copy=pad||mode===1,e=expansionLayoutExample(kind),sourceIndex=e.indices[selected]!;
 const shape=(ports:OperatorDetail['inputs'])=>ports.map(p=>p.tensor?p.tensor.shape.map(n=>n??'?').join('×'):'未填写').join('；');
 const steps=pad?[
  {label:'读取原值',description:'教学输入[3,7]，输出扩展为4个元素。保留原有两个数。'},
  {label:'写入原值',description:'把3和7写入目标前两格。'},
  {label:'填充零值',description:'目标新增两格写入常量0，得到[3,7,0,0]。零值填充不读取额外源元素。'},
 ]:[
  {label:'选择源元素',description:'教学输入是一行[3,7]，目标广播为3行。'},
  {label:'映射重复行',description:'目标(r,c)都映射到源(0,c)。行坐标变化时，源地址保持不变。'},
  {label:copy?'写入重复值':'零步幅视图',description:copy?'将源值重复写入新的3×2目标存储。':'教学输出视图步幅为(0,1)：三行共享同一组源元素。'},
 ];
 return <ComputationStepper title={pad?'补零：保留原值，填充新元素':'广播：多行映射到同一源行'} formula={pad?'Y[i] = X[i]（原有位置）；Y[i] = 0（新增位置）':'Y[r, c] = X[0, c]'} animation={animation} steps={steps} className="layout-computation expansion-layout-computation"
 dimensions={[{label:'当前输入',value:shape(operator.inputs)},{label:'当前输出',value:shape(operator.outputs)}]}
 footnote={<><p>图中数值、维度和地址为独立教学例。</p><a href="https://docs.pytorch.org/docs/stable/tensor_view.html">PyTorch · 视图与广播</a></>}>
 <div className="tile-example"><p>数值例：{pad?'1×2 → 1×4，尾部补零':'1×2 → 3×2，沿行广播'}</p>
 {!pad?<TilePicker selected={mode} onSelect={i=>{setMode(i);animation.reset();}} labels={['零步幅视图','物化重复值']}/>:null}
 <div className="tile-flow"><TileMatrix label="源 S" rows={1} columns={2} values={e.source} selected={sourceIndex===null?[]:[sourceIndex]} onSelect={setSelected}/>
 <TileMatrix label={pad?'目标 T · 扩展后填零':copy?'目标 T · 独立存储':'输出视图 · 共享 S'} rows={e.rows} columns={e.columns} values={e.output.map((value,i)=>animation.frame>=2||pad&&animation.frame>=1&&i<2?value:'·')} selected={[selected]} active={animation.frame===2?(pad?[2,3]:e.output.map((_,i)=>i)):[]} onSelect={setSelected}/></div>
 <div className="tile-stage" aria-live="polite"><strong>目标({Math.floor(selected/e.columns)}, {selected%e.columns})</strong><p>{sourceIndex===null?`常量 0 → T[${selected}]`:copy?`S[${sourceIndex}]=${e.source[sourceIndex]} → T[${selected}]`:`S[${sourceIndex}]=${e.source[sourceIndex]}；行步幅 0，源地址不变`}</p></div>
 <p>{pad?'读取2个原值；写入2个原值与2个零值。':copy?'读取源行，写入6个目标元素。':'0 个元素额外拷贝；输出多行共享源存储。'}</p>
 </div></ComputationStepper>;
}
