import { Decimal } from 'decimal.js';

import { ClientError } from '../errors';
import log from '../log';
import {
  Convertable,
  ConvertOption,
  ConvertType,
  isPrimitive,
} from '../types';

import { deepModifyObject } from './deep-modify-object';

export const convert = async (obj: Convertable, conversions: ConvertOption[]): Promise<void> => {
  await deepModifyObject(
    obj as { [key: string]: unknown },
    async (key: string, value: unknown, obj: { [key: string]: unknown }) => {
      if (isPrimitive(value)) {
        await _convert(key, value, obj, conversions);
      }
    },
  );
};

const _convert = async (
  key: string,
  value: unknown,
  obj: { [key: string]: unknown },
  conversions: ConvertOption[],
) => {
  const convertion = conversions.find((c) => c.key === key);
  if (convertion) {
    switch (convertion.type) {
      case ConvertType.DECIMAL:
        convertToDecimal(key, value, obj);
        break;
      case ConvertType.BYTES:
        convertToBytes(value, obj, key);
        break;
      default:
        throw new ClientError(400, `Unknown convertion type ${convertion.type}`);
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

const convertToBytes = (value: unknown, obj: { [key: string]: unknown }, key: string) => {
  if (typeof value === 'string') {
    obj[key] = base64ToBytes(value);
  } else {
    log.debug(`Cannot convert ${key} to Buffer, value is not a string`);
  }
};

const base64ToBytes = (based64Value: string): Buffer => {
  return Buffer.from(based64Value, 'base64');
};
