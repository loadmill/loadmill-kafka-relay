import { isPrimitive } from '../types';

export const deepModifyObject = async <T extends object>(
  obj: T,
  callback: (key: string, value: T[keyof T], obj: T) => void | Promise<void>,
): Promise<void> => {
  if (obj == null) {
    return;
  } else if (isPrimitive(obj)) {
    return;
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      await deepModifyObject(item, callback);
    }
  } else if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      await callback(key, value, obj);

      if (value !== null && !isPrimitive(value)) {
        await deepModifyObject(value, callback);
      }
    }
  }
};
