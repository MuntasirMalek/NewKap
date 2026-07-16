// Aperture-node does not expose recording duration yet: https://github.com/wulkano/aperture-node/issues/29
let overallDuration = 0;
let currentDurationStart = 0;

export const getOverallDuration = (): number => overallDuration;

export const getCurrentDurationStart = (): number => currentDurationStart;

export const setOverallDuration = (duration: number): void => {
  overallDuration = duration;
};

export const setCurrentDurationStart = (duration: number): void => {
  currentDurationStart = duration;
};
