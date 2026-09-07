import type {CSSProperties} from 'react';
import './tileComputation.css';

/** Shared cells for small, explicitly labelled mathematical tile examples. */
export function TileMatrix({label,rows,columns,values=[],active=[],selected=[],muted=[],onSelect}: {
 label:string;rows:number;columns:number;values?:readonly (string|number)[];
 active?:readonly number[];selected?:readonly number[];muted?:readonly number[];onSelect?:(index:number)=>void;
}) {
 return <figure className="tile-matrix">
  <figcaption>{label}</figcaption>
  <div className="tile-matrix-grid" style={{'--tile-columns':columns} as CSSProperties}>
   {Array.from({length:rows*columns},(_,index)=>{
    const className=['tile-cell',active.includes(index)?'is-active':'',selected.includes(index)?'is-selected':'',muted.includes(index)?'is-muted':''].filter(Boolean).join(' ');
    const value=values[index]??'·';
    return onSelect?<button key={index} type="button" className={className} aria-label={`${label} 第 ${Math.floor(index/columns)+1} 行第 ${index%columns+1} 列`}
     aria-pressed={selected.includes(index)} onClick={()=>onSelect(index)}>{value}</button>
     :<span key={index} className={className}>{value}</span>;
   })}
  </div>
 </figure>;
}

export function TilePicker({selected,onSelect,labels=['数据块 1','数据块 2']}: {
 selected:number;onSelect:(index:number)=>void;labels?:readonly string[];
}) {
 return <div className="tile-picker" role="group" aria-label="选择演示数据块">
  {labels.map((label,index)=><button key={label} type="button" aria-pressed={selected===index} onClick={()=>onSelect(index)}>{label}</button>)}
 </div>;
}

export const tileIndices=(offset:number,length:number)=>Array.from({length},(_,i)=>offset+i);
export const tileNumber=(value:number)=>Number.isInteger(value)?String(value):value.toFixed(3);
