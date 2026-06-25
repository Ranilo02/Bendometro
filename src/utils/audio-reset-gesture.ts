const RESET_GESTURE_ENERGY_THRESHOLD = 0.16;
const RESET_GESTURE_ACTIVE_BINS_THRESHOLD = 0.22;
const RESET_GESTURE_DOMINANT_BIN_SHARE_THRESHOLD = 0.2;
const RESET_GESTURE_ENERGY_SPIKE_FACTOR = 1.45;
const RESET_GESTURE_STRONG_ATTACK_THRESHOLD = 0.24;
const RESET_GESTURE_STRONG_ACTIVE_BINS_THRESHOLD = 0.3;

export type SpectrumStats = {
  normalizedEnergy: number;
  activeBinRatio: number;
  dominantBinShare: number;
};

export function analyzeSpectrum(frequencyData: Uint8Array): SpectrumStats {
  let total = 0;
  let activeBins = 0;
  let dominant = 0;

  for (let i = 0; i < frequencyData.length; i++) {
    const normalizedValue = frequencyData[i] / 255;
    total += normalizedValue;

    if (normalizedValue >= 0.18) {
      activeBins += 1;
    }

    if (normalizedValue > dominant) {
      dominant = normalizedValue;
    }
  }

  const normalizedEnergy = total / Math.max(frequencyData.length, 1);

  return {
    normalizedEnergy,
    activeBinRatio: activeBins / Math.max(frequencyData.length, 1),
    dominantBinShare: total > 0 ? dominant / total : 0,
  };
}

export function shouldTriggerResetGesture(
  spectrumStats: SpectrumStats,
  baselineEnergy: number
) {
  const hasBroadSpectrum =
    spectrumStats.activeBinRatio >= RESET_GESTURE_ACTIVE_BINS_THRESHOLD &&
    spectrumStats.dominantBinShare <= RESET_GESTURE_DOMINANT_BIN_SHARE_THRESHOLD;
  const hasEnergySpike =
    spectrumStats.normalizedEnergy >= RESET_GESTURE_ENERGY_THRESHOLD &&
    spectrumStats.normalizedEnergy >=
      Math.max(
        RESET_GESTURE_ENERGY_THRESHOLD,
        baselineEnergy * RESET_GESTURE_ENERGY_SPIKE_FACTOR
      );
  const isStrongBroadAttack =
    spectrumStats.normalizedEnergy >= RESET_GESTURE_STRONG_ATTACK_THRESHOLD &&
    spectrumStats.activeBinRatio >= RESET_GESTURE_STRONG_ACTIVE_BINS_THRESHOLD;

  return (hasBroadSpectrum && hasEnergySpike) || isStrongBroadAttack;
}
