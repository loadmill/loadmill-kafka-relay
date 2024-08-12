export const isMultiInstance = (): boolean => {
  return !!process.env.REDIS_URL;
};
