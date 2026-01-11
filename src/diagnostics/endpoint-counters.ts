let consumeCalls = 0;
let subscribeCalls = 0;

export const incrementConsumeCalls = (): void => {
  consumeCalls += 1;
};

export const incrementSubscribeCalls = (): void => {
  subscribeCalls += 1;
};

export const getEndpointsCallsCounters = (): { consumeCalls: number; subscribeCalls: number } => {
  return {
    consumeCalls,
    subscribeCalls,
  };
};
