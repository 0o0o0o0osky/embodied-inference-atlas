export interface AttentionShape {
  batch: number;
  queryHeads: number;
  kvHeads: number;
  queryLength: number;
  keyLength: number;
  headWidth: number;
  additiveMask?: boolean;
}

export interface AttentionMetrics {
  scoreFlop: number;
  valueFlop: number;
  scaleScalarFlop: number;
  maskScalarFlop: number;
  softmaxScalarFlop: number;
  comparisonOps: number;
  transcendentalOps: number;
  atomicByte: number;
  fusedBoundaryByte: number;
}

export function attentionMetrics(shape: AttentionShape, bytesPerValue: number): AttentionMetrics {
  const dimensions = [
    shape.batch,
    shape.queryHeads,
    shape.kvHeads,
    shape.queryLength,
    shape.keyLength,
    shape.headWidth,
  ];
  if (dimensions.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new Error("attention dimensions must be positive safe integers");
  }
  if (!Number.isFinite(bytesPerValue) || bytesPerValue <= 0) {
    throw new Error("attention bytes per value must be positive");
  }
  const scores = shape.batch * shape.queryHeads * shape.queryLength * shape.keyLength;
  const rows = shape.batch * shape.queryHeads * shape.queryLength;
  const scoreFlop = 2 * scores * shape.headWidth;
  const valueFlop = scoreFlop;
  const qByte = shape.batch * shape.queryHeads * shape.queryLength * shape.headWidth * bytesPerValue;
  const kByte = shape.batch * shape.kvHeads * shape.keyLength * shape.headWidth * bytesPerValue;
  const vByte = kByte;
  const oByte = qByte;
  const scoreByte = scores * bytesPerValue;
  const probabilityByte = scoreByte;
  const maskByte = shape.additiveMask ? scoreByte : 0;
  return {
    scoreFlop,
    valueFlop,
    scaleScalarFlop: scores,
    maskScalarFlop: shape.additiveMask ? scores : 0,
    softmaxScalarFlop: 3 * scores - rows,
    comparisonOps: scores - rows,
    transcendentalOps: scores + rows,
    atomicByte: qByte + kByte + scoreByte
      + scoreByte + probabilityByte + maskByte
      + probabilityByte + vByte + oByte,
    fusedBoundaryByte: qByte + kByte + vByte + oByte + maskByte,
  };
}
