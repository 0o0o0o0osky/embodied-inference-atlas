import type { TimelineEvent, TimelineLane } from "../../profiler/domain/types";

export function timeLabel(ns: number) {
  return ns >= 1e6 ? `${(ns / 1e6).toFixed(3)} ms` : ns >= 1e3 ? `${(ns / 1e3).toFixed(2)} µs` : `${ns.toFixed(0)} ns`;
}

export function eventTitle(event: TimelineEvent) {
  if (event.apiName) return event.apiName;
  if (event.eventKind === "scheduler") return "线程调度运行";
  const names: Record<string, string> = {
    "vision-graph": "视觉编码", "encoder-action-graph": "前缀编码 + 动作生成",
    "cuda-graph-launch": "cudaGraphLaunch", "cuda-device-synchronize": "cudaDeviceSynchronize",
    "cuda-stream-synchronize": "cudaStreamSynchronize", "cuda-sync":"CUDA 同步记录", "cuda-api-call":"CUDA API 调用", "osrt-call":"CPU 系统调用", memcpy: "数据拷贝", kernel: "Kernel 执行",
  };
  return names[event.label] ?? event.label;
}

export function laneTitle(lane: TimelineLane) {
  if (lane.kind==='osrt') return `系统调用 · 线程 ${lane.ordinal}`;
  if (lane.kind === "cpu_thread") return lane.role === "target-main" ? "主线程" : lane.role === "target-worker" ? `工作线程 ${lane.ordinal}` : "CUDA 事件线程";
  const names: Record<string, string> = { cpu_aggregate: "非采集器线程汇总", cuda_api: "目标线程 / CUDA API", cuda_sync:"同步记录（独立于 API）", cuda_graph: "CUDA Graph", gpu_memcpy: "GPU 拷贝", gpu_kernel: "已记录 Kernel", profiler_overhead: "采集器活动" };
  return names[lane.kind] ?? lane.kind;
}
