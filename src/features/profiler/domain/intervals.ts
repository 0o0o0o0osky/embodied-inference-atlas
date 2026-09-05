export interface Interval {
  startNs: number;
  endNs: number;
}

export function interval(startNs: number, durationNs: number): Interval {
  return { startNs, endNs: startNs + durationNs };
}

export function clipInterval(value: Interval, bounds: Interval): Interval | null {
  const startNs = Math.max(value.startNs, bounds.startNs);
  const endNs = Math.min(value.endNs, bounds.endNs);
  return endNs > startNs ? { startNs, endNs } : null;
}

export function mergeIntervals(values: readonly Interval[]): Interval[] {
  const ordered = values
    .filter((value) => value.endNs > value.startNs)
    .map((value) => ({ ...value }))
    .sort((left, right) => left.startNs - right.startNs || left.endNs - right.endNs);
  const merged: Interval[] = [];
  ordered.forEach((value) => {
    const previous = merged.at(-1);
    if (!previous || value.startNs > previous.endNs) {
      merged.push(value);
    } else {
      previous.endNs = Math.max(previous.endNs, value.endNs);
    }
  });
  return merged;
}

export function measureIntervals(values: readonly Interval[]): number {
  return mergeIntervals(values).reduce((total, value) => total + value.endNs - value.startNs, 0);
}

export function intersectIntervals(
  left: readonly Interval[],
  right: readonly Interval[],
): Interval[] {
  const a = mergeIntervals(left);
  const b = mergeIntervals(right);
  const result: Interval[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < a.length && rightIndex < b.length) {
    const overlap = clipInterval(a[leftIndex]!, b[rightIndex]!);
    if (overlap) result.push(overlap);
    if (a[leftIndex]!.endNs <= b[rightIndex]!.endNs) leftIndex += 1;
    else rightIndex += 1;
  }
  return result;
}

export function intersectionDuration(
  left: readonly Interval[],
  right: readonly Interval[],
): number {
  return measureIntervals(intersectIntervals(left, right));
}
