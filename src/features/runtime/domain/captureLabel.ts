import type {ProfilerCapture} from '../../profiler/domain/types';
type CaptureMetadataOption={capture:ProfilerCapture};

/** Describe coverage, without turning independent captures into sample counts. */
export function captureLabel(option:CaptureMetadataOption,_options:readonly CaptureMetadataOption[]=[]) {
  const capture=option.capture;
  if(capture.nsys?.reportMode==='graph')return 'Graph范围（不含逐Kernel）';
  return capture.nsys?.schedulerTracePresent?'逐Kernel + CPU调度':'逐Kernel（未采CPU调度）';
}
