import type { KernelLaunch, TimelineEvent, TimelineRecord } from '../../profiler/domain/types';

export interface ExecutionHotspot {
  id: string;
  captureId: string;
  label: string;
  category: string;
  durationNs: number;
  count: number;
  events: TimelineEvent[];
  kernelSignatureId: string | null;
  timeMeaning: string;
}

/** A missing launch is its own unverified population, never merged with a known launch. */
export function kernelLaunchKey(launch: KernelLaunch | undefined): string {
  return launch ? JSON.stringify([launch.grid,launch.block,launch.registersPerThread,launch.staticSharedMemoryBytes,launch.dynamicSharedMemoryBytes]) : 'launch-unrecorded';
}

function category(event: TimelineEvent): string {
  if (event.eventKind === 'scheduler') return 'CPU 调度执行';
  if (event.eventKind === 'kernel') return 'GPU Kernel';
  if (event.eventKind === 'memcpy') return '拷贝';
  if (event.eventKind === 'cuda_sync') return 'CUDA 同步记录';
  if (event.eventKind === 'osrt') {
    const name=event.apiName ?? event.label;
    if (/wait|poll|select|sleep|futex|pthread_(?:cond|mutex|join)|sem_/i.test(name)) return 'OS 等待调用';
    if (/malloc|calloc|realloc|free|mmap|munmap|brk/i.test(name)) return 'OS 分配调用';
    return 'OS 系统调用';
  }
  // These are recorded API names, not inferred CPU function attribution.
  const name=event.apiName ?? event.label;
  if (/synchronize/i.test(name)) return '同步调用';
  if (/launch/i.test(name)) return '提交调用';
  if (/malloc|alloc|free/i.test(name)) return '分配调用';
  return 'CUDA API';
}

/** A single trace, no replay durations or graph envelopes in the ranking. */
export function buildExecutionHotspots(timeline: TimelineRecord | null): ExecutionHotspot[] {
  if (!timeline) return [];
  const groups = new Map<string, ExecutionHotspot>();
  const allowed = new Set(['scheduler', 'kernel', 'memcpy', 'cuda_api', 'cuda_sync', 'osrt']);
  for (const event of timeline.events) {
    const lane = timeline.lanes.find(item => item.laneId === event.laneId);
    if (!allowed.has(event.eventKind) || event.evidenceSemantics === 'aggregated_interval'
      || lane?.coverage === 'excluded' || lane?.kind === 'cpu_aggregate') continue;
    const key = `${event.eventKind}|${event.kernelSignatureId ?? event.apiName ?? event.label}|${event.eventKind === 'scheduler' ? event.laneId : event.eventKind === 'kernel' ? kernelLaunchKey(event.launch) : ''}`;
    const row = groups.get(key) ?? {
      id: key, captureId: timeline.captureId, label: event.eventKind === 'scheduler' ? `线程 ${lane?.ordinal ?? event.laneId} · 已调度运行` : event.apiName ?? event.label,
      category: category(event), durationNs: 0, count: 0, events: [], kernelSignatureId: event.kernelSignatureId,
      timeMeaning: event.eventKind === 'osrt' ? 'OS 调用墙钟累计时间，不是 CPU 调度运行时间；可与 CUDA API 重叠'
        : event.eventKind === 'cuda_sync' ? '独立同步记录的累计时间，不能与 API 同步调用相加'
        : event.eventKind === 'scheduler' ? '此线程已记录的调度运行累计时间'
        : event.eventKind === 'cuda_api' ? 'API 调用墙钟累计时间，可与 CPU/GPU 工作重叠'
          : '已记录执行区间的累计时间；并发区间可能重叠',
    };
    const start = Math.max(timeline.window.startNs, event.startNs);
    const end = Math.min(timeline.window.startNs + timeline.window.durationNs, event.startNs + event.durationNs);
    if (end <= start) continue;
    row.durationNs += end - start;
    row.count += event.count;
    row.events.push(event);
    groups.set(key, row);
  }
  return [...groups.values()].sort((a,b)=>b.durationNs-a.durationNs || a.id.localeCompare(b.id));
}
