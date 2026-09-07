import type { OperatorDetail } from "../domain/types";
import { evaluateExpression } from "../domain/expression";

interface SlicePresentation {
  formula: string;
  explanation: string;
  axis: number | null;
  start: number | null;
  stop: number | null;
  step: number | null;
}
const missing: SlicePresentation = {
  axis: null, start: null, stop: null, step: null,
  formula: "Y = slice(X, axis=a, start=s, stop=e, step=k)",
  explanation: "范围待补充：当前声明未提供与输入输出一致的 axis、起止位置或步长；输入输出形状可在张量信息中查看。",
};

/** Resolve declared indexing against the current scope, independent of model/ref names. */
export function slicePresentation(operator: OperatorDetail): SlicePresentation | null {
  if (operator.definitionId !== "slice") return null;
  const declaration=operator.slice;
  if (!declaration) return missing;
  const shape=operator.inputs[0]?.tensor?.shape ?? [];
  const output=operator.outputs[0]?.tensor?.shape ?? [];
  try {
    const [axis,start,stop,step]=[declaration.axis,declaration.start,declaration.stop,declaration.step]
      .map(expr=>evaluateExpression(expr,operator.scopeBindings)) as [number,number,number,number];
    if (![axis,start,stop,step].every(Number.isSafeInteger) || axis<0 || axis>=shape.length
      || start<0 || stop<start || step<=0 || shape.some(size=>size===null)
      || stop>shape[axis]! || (declaration.drop_axis && (stop!==start+1 || step!==1))) return missing;
    const expected=[...shape];
    if (declaration.drop_axis) expected.splice(axis,1);
    else expected[axis]=Math.ceil((stop-start)/step);
    if (output.length!==expected.length || output.some((size,index)=>size!==expected[index])) return missing;
    const indices=shape.map((_,index)=>index!==axis ? ":" : declaration.drop_axis
      ? String(start) : `${start}:${stop}${step===1 ? "" : `:${step}`}`);
    const interpolate=(text:string)=>text.replace(/\{([A-Za-z_][A-Za-z_0-9]*)\}/g,(_match,key:string)=>{
      const value=operator.scopeBindings[key];
      if (value===null || value===undefined) throw new Error('Unresolved slice description');
      return String(value);
    });
    const identity=!declaration.drop_axis && start===0 && stop===shape[axis] && step===1;
    return {axis,start,stop,step,formula:`${declaration.output_symbol} = X[${indices.join(", ")}]`,
      explanation:interpolate(declaration.explanation)+(identity && declaration.identity_explanation ? interpolate(declaration.identity_explanation) : "")};
  } catch {return missing;}
}
