import {useState} from 'react';
import type {OperatorDetail} from '../domain/types';
import {ComputationStepper} from './ComputationStepper';
import {TileMatrix,TilePicker} from './TileMatrix';
import {useOperatorAnimation} from './useOperatorAnimation';
import {lookupIds,lookupTable,lookupDimensionTile} from './layoutLookupComputation';

export function EmbeddingLookupVisualizer({operator,resetKey}:{operator:OperatorDetail;resetKey:string}) {
 const animation=useOperatorAnimation(5,resetKey),[token,setToken]=useState(0),[inspected,setInspected]=useState(8);
 const id=lookupIds[token]!,block=animation.frame>=3?1:0,values=lookupDimensionTile(token,block),row=lookupTable[id]!;
 const shape=(ports:OperatorDetail['inputs'])=>ports.map(p=>p.tensor?p.tensor.shape.map(n=>n??'?').join('×'):'未填写').join('；');
 const selectToken=(i:number)=>{setToken(i);setInspected(lookupIds[i]!*4);animation.reset();};
 const steps=[{label:'id定位行',description:`ids=[2,0]；当前输出第${token+1}行读取embedding表的第${id}行（从0计）。`},
 {label:'读取维度块1',description:'读取这一行的第0–1维，值保持不变。'},
 {label:'写出维度块1',description:'把读出的两个元素写到当前输出行的第0–1维。'},
 {label:'读取维度块2',description:'沿同一表行继续读取第2–3维。'},
 {label:'完成输出行',description:'写入第2–3维，得到完整4维向量。切换id可查看另一输出行。'}];
 const visible=animation.frame>=4?4:animation.frame>=2?2:0;
 return <ComputationStepper title="Embedding：按 id 查表，分块读取一行" formula="Y[i, d] = table[ids[i], d]" animation={animation} steps={steps} className="lookup-computation"
 dimensions={[{label:'当前索引输入',value:shape(operator.inputs)},{label:'当前输出',value:shape(operator.outputs)}]}
 footnote={<><p>6×4表和ids=[2,0]为数值教学例；维度tile大小2。这里演示查表读取与输出写入。</p><a href="https://docs.pytorch.org/docs/stable/generated/torch.nn.Embedding.html">PyTorch · Embedding</a></>}>
 <div className="tile-example"><p>输入 ids=[2,0] · 点击 id 或表格位置查看读取</p>
 <TilePicker selected={token} onSelect={selectToken} labels={lookupIds.map((v,i)=>`输出行${i} · id=${v}`)}/>
 <TileMatrix label="Embedding表 · 行0–5，维度0–3" rows={6} columns={4} values={lookupTable.flat()} selected={Array.from({length:4},(_,d)=>id*4+d)} active={animation.frame>0?[id*4+block*2,id*4+block*2+1]:[]} onSelect={i=>{setInspected(i);const next=lookupIds.indexOf(Math.floor(i/4));if(next>=0){setToken(next);animation.seek(i%4<2?1:3);}}}/>
 <p aria-live="polite">table[{Math.floor(inspected/4)}, {inspected%4}] = {lookupTable.flat()[inspected]}{lookupIds.includes(Math.floor(inspected/4))?'':' · 当前ids未查询此行'}</p>
 <div className="tile-flow"><TileMatrix label={`读入维度块 ${block+1}`} rows={1} columns={2} values={animation.frame>0?values:['·','·']} active={animation.frame>0?[0,1]:[]}/>
 <TileMatrix label="输出 Y · 两个id对应两行" rows={2} columns={4} values={Array.from({length:8},(_,i)=>Math.floor(i/4)===token&&i%4<visible?row[i%4]!:'·')} selected={Array.from({length:4},(_,i)=>token*4+i)} onSelect={i=>{setToken(Math.floor(i/4));setInspected(lookupIds[Math.floor(i/4)]!*4+i%4);animation.seek(i%4<2?2:4);}}/></div>
 <p>同一行的向量元素原样写出，使用 id 作为行地址。</p>
 </div></ComputationStepper>;
}
