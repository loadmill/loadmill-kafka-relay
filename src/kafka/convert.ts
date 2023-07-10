import { Decimal } from 'decimal.js';

import { ClientError } from '../errors';
import { Convertable, ConvertOption, ConvertType, isPrimitive } from '../types';

export const convert = (
  obj: Convertable,
  convertions: ConvertOption[],
): void => {
  if (obj === null || obj === undefined) {
    return;
  } else if (isPrimitive(obj)) {
    return;
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      convert(item, convertions);
    }
  } else if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      if (obj.hasOwnProperty(key)) {
        const convertion = convertions.find((c) => c.key === key);
        if (convertion) {
          switch (convertion.type) {
            case ConvertType.DECIMAL:
              obj[key] = toDecimal(value);
              break;
            default:
              throw new ClientError(400, `Unknown convertion type ${convertion.type}`);
          }
        }
      }
      convert(value as { [key: string]: unknown }, convertions);
    }
  }
};

const toDecimal = (value: unknown): Decimal => {
  if (typeof value !== 'string' || typeof value !== 'number') {
    throw new ClientError(400, `Convertion value must be a string or a number, got ${typeof value}`);
  }
  return new Decimal(value);
};
