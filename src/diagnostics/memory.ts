/**
 * @returns A memory usage Snapshot in MiB
 */
export const getMemoryUsageStats = (): NodeJS.MemoryUsage => {
  const memoryUsage = process.memoryUsage();

  for (const [key, value] of Object.entries(memoryUsage)) {
    memoryUsage[key as keyof NodeJS.MemoryUsage] = bytesToMiB(value);
  }

  return memoryUsage;
};

export const bytesToMiB = (bytes: number): number => Math.round((bytes / 1024 / 1024) * 100) / 100;
