import { Decimal } from 'decimal.js';

import { ClientError } from '../errors';
import log from '../log';
import { Convertable, ConvertOption, ConvertType, isPrimitive } from '../types';

export const convert = (
  obj: Convertable,
  conversions: ConvertOption[],
): void => {
  if (obj === null || obj === undefined) {
    return;
  } else if (isPrimitive(obj)) {
    return;
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      convert(item, conversions);
    }
  } else if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      if (obj.hasOwnProperty(key)) {
        const convertion = conversions.find((c) => c.key === key);
        if (convertion) {
          switch (convertion.type) {
            case ConvertType.DECIMAL:
              convertToDecimal(key, value, obj);
              break;
            default:
              throw new ClientError(400, `Unknown convertion type ${convertion.type}`);
          }
        }
      }
      convert(value as { [key: string]: unknown }, conversions);
    }
  }
};

const convertToDecimal = (key: string, value: unknown, obj: { [key: string]: unknown }) => {
  if (typeof value === 'string' || typeof value === 'number') {
    obj[key] = new Decimal(value);
  } else {
    log.debug(`Cannot convert ${key} to Decimal, value is not a string or number`);
  }
};
