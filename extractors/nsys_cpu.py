"""Preserve CPU samples and OSRT intervals with explicit source classification policy."""
from collections import defaultdict
from extractors.nsys import target_thread_role


def sample_label(symbol, unresolved, frame_rules=()):
    if unresolved:
        return 'unresolved'
    for substring, label in frame_rules:
        if substring in symbol:
            return label
    if any(value in symbol for value in ('pthread_cond_wait', 'futex_wait', 'sem_timedwait')):
        return 'thread-wait'
    return 'cuda-runtime' if symbol.startswith(('cuda', 'cuLaunch')) else 'other'


def prepare_cpu_metadata(connection, symbols, frame_rules=()):
    """Read collection-wide names and callchains once for all prediction windows."""
    tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    samples = {'COMPOSITE_EVENTS', 'SAMPLING_CALLCHAINS'} <= tables
    scheduler = 'SCHED_EVENTS' in tables and bool(connection.execute('SELECT 1 FROM SCHED_EVENTS LIMIT 1').fetchone())
    names = dict(connection.execute('SELECT t.globalTid,s.value FROM ThreadNames t JOIN StringIds s ON t.nameId=s.id')) if {'ThreadNames', 'StringIds'} <= tables else {}
    frames = defaultdict(list)
    if samples:
        for row in connection.execute('SELECT * FROM SAMPLING_CALLCHAINS ORDER BY id,stackDepth'):
            frames[row['id']].append(dict(label_sanitized=sample_label(symbols.get(row['symbol'], ''), row['unresolved'], frame_rules), depth=row['stackDepth']))
    return dict(tables=tables, samples=samples, scheduler=scheduler, names=names, frames=frames)


def supplement_cpu(connection, capture, timeline, symbols, target, start, end, *,
                   api_names, metadata=None, lane_resolver=None):
    source = metadata if metadata is not None else prepare_cpu_metadata(connection, symbols)
    tables, names, frames = source['tables'], source['names'], source['frames']
    capture['cpu_capabilities'] = dict(scheduler_running=source['scheduler'], thread_states=False,
        function_samples=source['samples'], task_markers=False, association_events=False)
    # The parser's unique target-main track denotes this exact NVTX thread.
    mains = [lane for lane in timeline['lanes'] if lane['kind'] == 'cpu_thread' and lane['role'] == 'target-main']
    lanes = {(target, 'cpu_thread'): mains[0]['lane_id']} if len(mains) == 1 else {}

    def lane(tid, kind):
        if lane_resolver is not None:
            return lane_resolver(tid, kind)
        if (tid, kind) not in lanes:
            ordinal = max((int(item['lane_id'].split('-')[-1]) for item in timeline['lanes']), default=0) + 1
            identity = f'lane-{ordinal:03d}'
            lanes[tid, kind] = identity
            timeline['lanes'].append(dict(lane_id=identity, kind=kind,
                role=target_thread_role(tid, target, names.get(tid)), ordinal=len(timeline['lanes']), coverage='complete'))
        return lanes[tid, kind]

    if source['samples']:
        timeline['cpu_samples'] = []
        for row in connection.execute('SELECT * FROM COMPOSITE_EVENTS WHERE start>=? AND start<? ORDER BY start', (start, end)):
            if row['globalTid'] >> 24 != target >> 24:
                continue
            timeline['cpu_samples'].append(dict(sample_id=f'sample-{len(timeline["cpu_samples"])+1:05d}',
                lane_id=lane(row['globalTid'], 'cpu_thread'), time_ns=row['start']-start,
                frames=frames.get(row['id'], []), weight=1))
    if 'OSRT_API' in tables:
        for row in connection.execute('SELECT * FROM OSRT_API WHERE start<? AND end>? ORDER BY start,end', (end, start)):
            if row['globalTid'] >> 24 != target >> 24:
                continue
            name = symbols.get(row['nameId'], '')
            timeline['events'].append(dict(event_id=f'event-{len(timeline["events"])+1:05d}',
                lane_id=lane(row['globalTid'], 'osrt'), event_kind='osrt', label='osrt-call',
                api_name=name if name in api_names else 'unknown', start_ns=max(start, row['start'])-start,
                duration_ns=min(end, row['end'])-max(start, row['start']), count=1,
                kernel_signature_id=None, bytes=None, copy_direction=None, evidence_semantics='exact_interval'))
