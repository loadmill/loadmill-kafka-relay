
import { EncodeProduceOptions, ProduceMessageHeaders } from '../types';

import { deepModifyObject } from './deep-modify-object';
import { encode } from './schema-registry';

/**
 * Encodes the headers of a Kafka message using the provided encoding options.
 * @modifies `headers`. At the end of the procedure the headers will be IHeaders.
 */
export const encodeHeaders = async (
  headers: ProduceMessageHeaders,
  encodeOptions?: EncodeProduceOptions,
): Promise<void> => {
  if (headers && encodeOptions?.headers) {
    await deepModifyObject(
      headers,
      async (
        key: string,
        value: ProduceMessageHeaders[keyof ProduceMessageHeaders],
        obj: ProduceMessageHeaders,
      ) => {
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
