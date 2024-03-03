
import { EncodeProduceOptions, ProduceMessage } from '../types';

import { deepModifyObjectAsync } from './deep-modify-object';
import { encode } from './schema-registry';

export const encodeHeaders = async (headers: ProduceMessage['headers'], encodeOptions?: EncodeProduceOptions): Promise<void> => {
  if (headers && encodeOptions?.headers) {
    await deepModifyObjectAsync(
      headers,
      async (key: string, value: unknown, obj: { [key: string]: unknown }) => {
        await _encodeHeaders(key, value, obj, encodeOptions);
      },
    );
  }
};

const _encodeHeaders = async (
  key: string,
  value: unknown,
  obj: { [key: string]: unknown },
  encodeOptions?: EncodeProduceOptions,
) => {
  if (encodeOptions?.headers?.[key]) {
    const { subject, version } = encodeOptions.headers[key];
    obj[key] = await encode(value, { subject, version });
  }
};
