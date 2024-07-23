import { isPrimitive } from '../types';

export const deepModifyObject = async (
  obj: unknown,
  callback: (key: string, value: unknown, obj: { [key: string]: unknown }) => void | Promise<void>,
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
      if (value !== null && (typeof value === 'object' || Array.isArray(value))) {
        await deepModifyObject(value, callback);
      } else {
        await callback(key, value, obj as { [key: string]: unknown });
      }
    }
  }
};
