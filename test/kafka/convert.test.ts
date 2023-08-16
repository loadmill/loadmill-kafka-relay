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
});
