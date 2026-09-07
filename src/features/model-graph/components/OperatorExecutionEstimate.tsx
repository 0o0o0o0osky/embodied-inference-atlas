import {remainingOperatorKinds,remainingOperatorWork} from '../../roofline/domain/remainingOperatorEstimate';
import {RemainingOperatorRooflinePanel} from './RemainingOperatorRooflinePanel';
import {localOperatorWork,localOperatorKinds} from '../../roofline/domain/localOperatorEstimate';
import {LocalOperatorRooflinePanel} from './LocalOperatorRooflinePanel';
import type {OperatorDetail} from '../domain/types';
import type {RooflineScenarioRecord,RooflineCeilingRecord,PrecisionSegment} from '../../roofline/domain/types';
import {attentionShapeFromDetail,operationPrecision,plainAttentionStorage} from '../../roofline/presentation/attentionInput';
import {rmsNormFromOperator} from "../../roofline/domain/rmsNormFromOperator";
import {NormalizationRooflinePanel} from "../../roofline/components/NormalizationRooflinePanel";
import {resolveAttentionHardwareProfile,resolveNormalizationHardwareProfile,resolveRemainingHardwareProfile} from '../../roofline/domain/operatorHardwareProfile';
import {AttentionRooflinePanel} from '../../roofline/components/AttentionRooflinePanel';
import {ConcatCostPanel} from './ConcatCostPanel';
import {concatCostFromDetail} from '../domain/concatCost';
import {AnalysisPlaceholder} from '../../../components/AnalysisPlaceholder';

const needsWeightEncodingModel=(segment:PrecisionSegment)=>{
 const weight=segment.weight;
 return weight.padding!=='none'||weight.tensor_scale_bytes!==0||weight.scale_bytes_per_block!==0||weight.zero_point_bytes_per_block!==0
  ||segment.dequantization.floating_flop_per_weight>0||segment.dequantization.integer_op_per_weight>0;
};

export function OperatorExecutionEstimate({detail,scenario,ceiling,bandwidth}:{
 detail:OperatorDetail;scenario:RooflineScenarioRecord;ceiling:RooflineCeilingRecord;bandwidth:number|null;
}) {
 const segment=operationPrecision(detail,scenario);
 if(!segment) return <AnalysisPlaceholder state="unlinked" title="当前算子的精度待关联" detail="需要该算子输入、输出及计算路径的精度记录。"/>;
 if(detail.definitionId==='concat'||detail.definitionId==='reshape'||detail.definitionId==='slice'||detail.definitionId==='permute-rearrange') {
  const compatible=segment.activation.bits_per_value===segment.output.bits_per_value && plainAttentionStorage(segment);
  if(!compatible) return <AnalysisPlaceholder state="not_recorded" title="当前存储路径待补充" detail="需要输入、输出的存储编码及转换方式。"/>;
  const cost=concatCostFromDetail(detail,segment.activation.bits_per_value);
  return cost?<ConcatCostPanel {...cost} precisionLabel={segment.activation.format.toUpperCase()} bandwidthBytesPerSecond={bandwidth}/>:null;
 }
 if(localOperatorKinds.some(kind=>kind===detail.definitionId)) {
  const patch=detail.definitionId==='patch-embedding';
  const weight=segment.weight;
  const encodedWeight=patch&&needsWeightEncodingModel(segment);
  if(!plainAttentionStorage(segment)||encodedWeight)return <AnalysisPlaceholder state="not_recorded" title="当前算子的存储与转换成本待补充" detail="需要该精度路径的量化元数据、解量化与输出转换公式。"/>;
  const work=localOperatorWork(detail,segment.activation.bits_per_value/8,segment.output.bits_per_value/8,weight.bits_per_value/8);
  if(!work)return <AnalysisPlaceholder state="not_recorded" title="当前算子的形状待补充" detail="需要一致的输入、输出与广播维度，图块投影还需完整图块尺寸。"/>;
  const scalarRate=resolveNormalizationHardwareProfile(ceiling).rates.scalarOp;
  const rate=patch?ceiling.compute.find(c=>c.compute_class===segment.compute_class)?.flop_per_second??null:scalarRate===null?null:scalarRate*(work.resource==='fma'?2:1);
  return <LocalOperatorRooflinePanel work={work} rate={rate} bandwidth={bandwidth} precisionLabel={segment.activation.format.toUpperCase()}/>;
 }
 if(remainingOperatorKinds.some(kind=>kind===detail.definitionId)) {
  if(!plainAttentionStorage(segment)||detail.definitionId==='token-embedding'&&needsWeightEncodingModel(segment))return <AnalysisPlaceholder state="not_recorded" title="当前编码成本待补充" detail="需要存储编码与转换方式。"/>;
  const work=remainingOperatorWork(detail,segment.activation.bits_per_value/8,segment.output.bits_per_value/8,segment.weight.bits_per_value/8);
  if(!work)return <AnalysisPlaceholder state="not_recorded" title="当前算子的形状待补充" detail="需要匹配的输入输出及归一化或旋转维度。"/>;
  const profile=resolveRemainingHardwareProfile(ceiling);
  return <RemainingOperatorRooflinePanel work={work} precisionLabel={segment.activation.format.toUpperCase()} rates={{...profile.rates,globalByte:bandwidth}}/>;
 }
 if(detail.definitionId==='rms-norm') {
  if(!plainAttentionStorage(segment)) return <AnalysisPlaceholder state="not_recorded" title="当前量化归一化路径待补充" detail="需要输入、输出转换与缩放元数据。"/>;
  const profile=resolveNormalizationHardwareProfile(ceiling);
  const estimate=rmsNormFromOperator(detail,{input:segment.activation.bits_per_value/8,output:segment.output.bits_per_value/8},{...profile.rates,globalByte:bandwidth});
  return estimate?<NormalizationRooflinePanel estimate={estimate} bandwidth={bandwidth} precisionLabel={segment.activation.format.toUpperCase()}/>
   :<AnalysisPlaceholder state="not_recorded" title="RMSNorm 形状待补充" detail="需要输入和输出的归一化维度。"/>;
 }
 const shape=attentionShapeFromDetail(detail);
 if(!shape) return <AnalysisPlaceholder state="not_recorded" title="Attention 形状待补充" detail="需要一致的 Q、K、V 头数、长度和维度。"/>;
 if(!plainAttentionStorage(segment)) return <AnalysisPlaceholder state="not_recorded" title="当前量化路径的 Attention 成本待补充" detail="需要量化元数据和转换方式；BF16、FP16 路径已可比较分项与融合。"/>;
 const profile=resolveAttentionHardwareProfile(ceiling);
 const matmul=ceiling.compute.find(c=>c.compute_class===segment.compute_class)?.flop_per_second??null;
 return <AttentionRooflinePanel key={`${detail.ref}|${scenario.precision_path.precision_path_id}`} input={{shape,
  bytes:{query:segment.activation.bits_per_value/8,key:segment.activation.bits_per_value/8,value:segment.activation.bits_per_value/8,score:segment.output.bits_per_value/8,probability:segment.activation.bits_per_value/8,output:segment.output.bits_per_value/8},
  mask:{kind:'none'},rates:{...profile.rates,matmulFlop:matmul,globalByte:bandwidth}}}
  precisionLabel={segment.activation.format.toUpperCase()} ceilingLabel={ceiling.operating_point.gpu_clock_hz?`${(ceiling.operating_point.gpu_clock_hz/1e6).toLocaleString('zh-CN')} MHz 理论频率`:'硬件频率待补充'}/>
}
export const supportsExecutionEstimate=(detail:OperatorDetail)=>['attention-core','concat','reshape','slice','rms-norm','permute-rearrange',...remainingOperatorKinds,...localOperatorKinds].includes(detail.definitionId);
