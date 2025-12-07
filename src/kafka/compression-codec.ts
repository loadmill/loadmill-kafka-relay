import { CompressionTypes } from '@confluentinc/kafka-javascript/types/kafkajs';

import log from '../log';

export const isLZ4Enabled = (): boolean => {
  return !!process.env.LOADMILL_KAFKA_LZ4_COMPRESSION_CODEC;
};

export const getCompressionCodec = (): CompressionTypes | undefined => {
  if (isLZ4Enabled()) {
    log.info('LZ4 compression codec is enabled');
    return 'lz4' as CompressionTypes.LZ4;
  }
};

export const compressionCodec = getCompressionCodec();
