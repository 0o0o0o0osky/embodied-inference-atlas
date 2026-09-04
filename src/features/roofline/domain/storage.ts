function valueCount(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative safe integer`);
  }
  return value;
}

export function rawBytes(values: number, bitsPerValue: number): number {
  valueCount(values, "values");
  if (![4, 8, 16, 32].includes(bitsPerValue)) {
    throw new Error("bitsPerValue must be a supported storage width");
  }
  return Math.ceil((values * bitsPerValue) / 8);
}

export function rawEncodingBytes(
  values: number,
  bitsPerValue: number,
  tensorScaleBytes = 0,
): number {
  return rawBytes(values, bitsPerValue) + valueCount(tensorScaleBytes, "tensorScaleBytes");
}

export function blockEncodingBytes(
  values: number,
  blockValues: number,
  packedDataBytes: number,
  scaleBytes: number,
  zeroPointBytes: number,
  tensorScaleBytes = 0,
): number {
  valueCount(values, "values");
  if (!Number.isSafeInteger(blockValues) || blockValues <= 0) {
    throw new Error("blockValues must be a positive safe integer");
  }
  const bytesPerBlock = [packedDataBytes, scaleBytes, zeroPointBytes]
    .map((value, index) => valueCount(value, ["packedDataBytes", "scaleBytes", "zeroPointBytes"][index]!))
    .reduce((sum, value) => sum + value, 0);
  return Math.ceil(values / blockValues) * bytesPerBlock
    + valueCount(tensorScaleBytes, "tensorScaleBytes");
}

export const q8_0Bytes = (values: number) => blockEncodingBytes(values, 32, 32, 2, 0);
export const w8Group32Bytes = (values: number) => blockEncodingBytes(values, 32, 32, 2, 0);
export const w4Group32Bytes = (values: number) => blockEncodingBytes(values, 32, 16, 2, 0);
export const nvfp4Bytes = (values: number) => blockEncodingBytes(values, 16, 8, 1, 0, 4);
