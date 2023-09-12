import avro from 'avsc';

/**
 * https://github.com/mtth/avsc/wiki/Advanced-usage#custom-long-types
 */
export const longType = avro.types.LongType.__with({
  compare: (n1: bigint, n2: bigint) => {
    return n1 === n2 ? 0 : (n1 < n2 ? -1 : 1);
  },
  fromBuffer: (buf: Buffer) => buf.readBigInt64LE(),
  fromJSON: BigInt,
  isValid: (n: unknown): n is bigint => typeof n == 'bigint',
  toBuffer: (n: bigint) => {
    const buf = Buffer.alloc(8);
    buf.writeBigInt64LE(n);
    return buf;
  },
  toJSON: Number,
});
