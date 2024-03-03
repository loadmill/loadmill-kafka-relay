import { isPrimitive } from '../types';

export const deepModifyObjectAsync = async (
  obj: unknown,
  callback: (key: string, value: unknown, obj: { [key: string]: unknown }) => Promise<void>,
): Promise<void> => {
  if (obj == null) {
    return;
  } else if (isPrimitive(obj)) {
    return;
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      await deepModifyObjectAsync(item, callback);
    }
  } else if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      if (obj.hasOwnProperty(key)) {
        await callback(key, value, obj as { [key: string]: unknown });
        await deepModifyObjectAsync(value as { [key: string]: unknown }, callback);
      }
    }
  }
};

export const deepModifyObject = (
  obj: unknown,
  callback: (key: string, value: unknown, obj: { [key: string]: unknown }) => void,
): void => {
  if (obj == null) {
    return;
  } else if (isPrimitive(obj)) {
    return;
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      deepModifyObject(item, callback);
    }
  } else if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      if (obj.hasOwnProperty(key)) {
        callback(key, value, obj as { [key: string]: unknown });
        deepModifyObject(value as { [key: string]: unknown }, callback);
      }
    }
  }
};
