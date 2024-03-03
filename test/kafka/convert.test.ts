import Decimal from 'decimal.js';

import { convert } from '../../src/kafka/convert';
import { ConvertType } from '../../src/types';

describe('convert', () => {
  it('should convert a number to a Decimal', () => {
    const obj = {
      bar: 1,
      foo: 2,
    };
    convert(obj, [{ key: 'foo', type: ConvertType.DECIMAL }]);
    expect(obj.bar).toBe(1);
    expect((obj.foo as unknown as Decimal).toNumber()).toBe(2);
    expect(obj.foo).toBeInstanceOf(Decimal);
  });

  it('should convert a string to a Decimal', () => {
    const obj = {
      bar: 1,
      foo: '2',
    };
    convert(obj, [{ key: 'foo', type: ConvertType.DECIMAL }]);
    expect(obj.bar).toBe(1);
    expect((obj.foo as unknown as Decimal).toNumber()).toBe(2);
    expect(obj.foo).toBeInstanceOf(Decimal);
  });

  it('should convert a nested object', () => {
    const obj = {
      bar: 1,
      foo: {
        bar: 1,
        foo: '2',
      },
    };
    convert(obj, [{ key: 'foo', type: ConvertType.DECIMAL }]);
    expect(obj.bar).toBe(1);
    expect(obj.foo.bar).toBe(1);
    expect((obj.foo.foo as unknown as Decimal).toNumber()).toBe(2);
    expect(obj.foo.foo).toBeInstanceOf(Decimal);
  });

  it('should convert an array', () => {
    const obj = {
      bar: 1,
      foo: [
        {
          bar: 1,
          foo: '2',
        },
      ],
    };
    convert(obj, [{ key: 'foo', type: ConvertType.DECIMAL }]);
    expect(obj.bar).toBe(1);
    expect(obj.foo[0].bar).toBe(1);
    expect((obj.foo[0].foo as unknown as Decimal).toNumber()).toBe(2);
    expect(obj.foo[0].foo).toBeInstanceOf(Decimal);
  });

  it('should convert an array of arrays', () => {
    const obj = {
      bar: 1,
      foo: [
        [
          {
            bar: 1,
            foo: '2',
          },
        ],
      ],
    };
    convert(obj, [{ key: 'foo', type: ConvertType.DECIMAL }]);
    expect(obj.bar).toBe(1);
    expect(obj.foo[0][0].bar).toBe(1);
    expect((obj.foo[0][0].foo as unknown as Decimal).toNumber()).toBe(2);
    expect(obj.foo[0][0].foo).toBeInstanceOf(Decimal);
  });

  it('should convert an array of objects', () => {
    const obj = {
      bar: 1,
      foo: [
        {
          bar: 1,
          foo: '2',
        },
        {
          bar: 1,
          foo: '2',
        },
      ],
    };
    convert(obj, [{ key: 'foo', type: ConvertType.DECIMAL }]);
    expect(obj.bar).toBe(1);
    expect(obj.foo[0].bar).toBe(1);
    expect((obj.foo[0].foo as unknown as Decimal).toNumber()).toBe(2);
    expect(obj.foo[0].foo).toBeInstanceOf(Decimal);
    expect(obj.foo[1].bar).toBe(1);
    expect((obj.foo[1].foo as unknown as Decimal).toNumber()).toBe(2);
    expect(obj.foo[1].foo).toBeInstanceOf(Decimal);
  });

  it('should throw an error when the convertion type is unknown', () => {
    const obj = {
      bar: 1,
      foo: '2',
    };
    expect(() => convert(obj, [{ key: 'foo', type: 'foo' as ConvertType }])).toThrow('Unknown convertion type foo');
  });

  it('should convert a number array to a Buffer', async () => {
    const obj = {
      request: {
        byteArrayField: [
          226, 235, 214, 168, 130, 62, 38, 137, 105, 40,
          45, 9, 232, 206, 202, 8, 239, 53, 114, 23,
          3, 75, 135, 65, 92, 250, 148, 171, 157, 162,
          52, 96, 37, 156, 139, 123, 128, 190, 203, 48,
          68, 173, 243, 179, 125, 142, 211, 50, 219, 22,
        ],
      },
      response: {
        byteArrayField: [
          115, 95, 154, 149, 111, 114, 133, 102, 123, 98,
          191, 221, 242, 209, 145, 237, 5, 147, 14, 255,
          215, 16, 242, 209, 173, 142, 255, 231, 207, 1,
          171, 176, 205, 84, 151, 190, 202, 3, 141, 177,
          172, 89, 152, 215, 115, 162, 69, 101, 39, 59,
        ],
      },
    };
    convert(obj, [{ key: 'byteArrayField', type: ConvertType.BYTES }]);
    expect(obj.request.byteArrayField).toBeInstanceOf(Buffer);
    expect(obj.response.byteArrayField).toBeInstanceOf(Buffer);
  });
});
