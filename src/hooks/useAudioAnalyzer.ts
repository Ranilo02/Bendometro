import { useRef, useState, useEffect, useCallback } from "react";
import { frequencyToNoteInfo, type NoteInfo } from "../utils/music-theory";
import { analyzeSpectrum } from "../utils/audio-reset-gesture";

// Faixa de frequências aceitas pelo detector de pitch (guitarra: ~82 Hz–1318 Hz).
const MIN_FREQUENCY = 70;
const MAX_FREQUENCY = 1400;
// YIN: valor abaixo deste threshold é considerado pitch confiável.
// 0.1 é conservador (poucos falsos positivos); aumentar aceita mais ruído.
const YIN_THRESHOLD = 0.1;
// Quantos frames de frequência são mediados para suavizar o pitch detectado.
const HISTORY_SIZE = 3;
// Dois frames são considerados "mesma nota" se o drift for menor que este valor.
const STABILITY_WINDOW_CENTS = 35;
// Frames consecutivos na mesma nota antes de emitir onNoteDetected.
const REQUIRED_STABLE_FRAMES = 1;
// Evita disparar setDetectedNote toda frame para variações minúsculas de frequência.
const NOTE_UPDATE_EPSILON_HZ = 0.12;
const CENTS_UPDATE_EPSILON = 1;

// Detecção de ataque (onset): combinação de spike de RMS + energia espectral.
// Todos os thresholds foram calibrados empiricamente para guitarra com microfone.
const ATTACK_RMS_THRESHOLD = 0.016;      // amplitude mínima absoluta
const ATTACK_RMS_SPIKE_FACTOR = 1.45;    // RMS atual deve ser 1.45× o baseline
const ATTACK_RMS_DELTA = 0.01;           // transiente rápido (subida de RMS em 1 frame)
const ATTACK_ENERGY_SPIKE_FACTOR = 1.18; // energia espectral deve ser 1.18× o baseline
const ATTACK_COOLDOWN_MS = 85;           // ignora ataques dentro deste intervalo (debounce)
const ATTACK_CAPTURE_WINDOW_MS = 140;    // nota detectada nesta janela após ataque = isAttack

// Tamanho dos históricos usados para calcular baseline de energia/RMS.
// ~400 ms a 30 fps para energia, ~333 ms para RMS.
const MAX_ENERGY_HISTORY = 12;
const MAX_RMS_HISTORY = 10;

export type AudioNoteDetection = {
    attackAgeMs: number | null;
    detectedAtMs: number;
    isAttack: boolean;
    normalizedEnergy: number;
    rms: number;
};

export type AudioAttackDetection = {
    detectedAtMs: number;
    normalizedEnergy: number;
    rms: number;
};

type AudioAnalyzerOptions = {
    onAttackDetected?: (detail: AudioAttackDetection) => void;
    responsiveness?: "fast" | "stable";
};

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
}

function refinePeriod(
    yinBuffer: ArrayLike<number>,
    tauEstimate: number
): number {
    const x0 = tauEstimate > 1 ? tauEstimate - 1 : tauEstimate;
    const x2 =
        tauEstimate + 1 < yinBuffer.length ? tauEstimate + 1 : tauEstimate;

    if (x0 === tauEstimate || x2 === tauEstimate) return tauEstimate;

    const s0 = yinBuffer[x0];
    const s1 = yinBuffer[tauEstimate];
    const s2 = yinBuffer[x2];
    const denominator = 2 * (2 * s1 - s2 - s0);

    if (denominator === 0) return tauEstimate;

    return tauEstimate + (s2 - s0) / denominator;
}

function detectPitchYin(
    buf: Float32Array,
    sampleRate: number,
    yinBuffer: Float32Array
): number {
    let rms = 0;
    for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / buf.length);
    if (rms < 0.01) return -1;

    const tauMin = Math.max(2, Math.floor(sampleRate / MAX_FREQUENCY));
    const tauMax = Math.min(
        Math.floor(sampleRate / MIN_FREQUENCY),
        Math.floor(buf.length / 2)
    );

    if (tauMax <= tauMin) return -1;

    if (yinBuffer.length < tauMax + 1) return -1;

    for (let tau = 1; tau <= tauMax; tau++) {
        let sum = 0;
        for (let i = 0; i < tauMax; i++) {
            const delta = buf[i] - buf[i + tau];
            sum += delta * delta;
        }
        yinBuffer[tau] = sum;
    }

    yinBuffer[0] = 1;
    let runningSum = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
        runningSum += yinBuffer[tau];
        yinBuffer[tau] =
            runningSum === 0 ? 1 : (yinBuffer[tau] * tau) / runningSum;
    }

    let tauEstimate = -1;
    for (let tau = tauMin; tau <= tauMax; tau++) {
        if (yinBuffer[tau] < YIN_THRESHOLD) {
            while (tau + 1 <= tauMax && yinBuffer[tau + 1] < yinBuffer[tau]) tau++;
            tauEstimate = tau;
            break;
        }
    }

    if (tauEstimate === -1) {
        let bestTau = -1;
        let bestValue = Number.POSITIVE_INFINITY;
        for (let tau = tauMin; tau <= tauMax; tau++) {
            if (yinBuffer[tau] < bestValue) {
                bestValue = yinBuffer[tau];
                bestTau = tau;
            }
        }
        if (bestTau === -1 || bestValue > 0.2) return -1;
        tauEstimate = bestTau;
    }

    const refinedTau = refinePeriod(yinBuffer, tauEstimate);
    if (!isFinite(refinedTau) || refinedTau <= 0) return -1;

    return sampleRate / refinedTau;
}

function measureRms(buffer: Float32Array): number {
    let total = 0;
    for (let i = 0; i < buffer.length; i++) {
        total += buffer[i] * buffer[i];
    }

    return Math.sqrt(total / Math.max(buffer.length, 1));
}

export function useAudioAnalyzer(
    onNoteDetected?: (frequency: number, midi: number, detail: AudioNoteDetection) => void,
    options: AudioAnalyzerOptions = {}
) {
    const responsiveness = options.responsiveness ?? "stable";
    const onAttackDetected = options.onAttackDetected;
    const [running, setRunning] = useState(false);
    const [detectedNote, setDetectedNote] = useState<NoteInfo | null>(null);
    const [error, setError] = useState<string | null>(null);

    const audioCtxRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const bufferRef = useRef<Float32Array<ArrayBuffer> | null>(null);
    const frequencyDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
    const rafRef = useRef<number | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const frequencyHistoryRef = useRef<number[]>([]);
    const rmsHistoryRef = useRef<number[]>([]);
    const spectralEnergyHistoryRef = useRef<number[]>([]);
    const yinBufferRef = useRef<Float32Array | null>(null);
    const lastAttackAtRef = useRef<number | null>(null);
    const previousRmsRef = useRef(0);
    const runningRef = useRef(false);
    const detectedNoteRef = useRef<NoteInfo | null>(null);
    const lastStableNoteRef = useRef<{ midi: number; frames: number; info: NoteInfo | null }>({
        midi: -1,
        frames: 0,
        info: null,
    });

    useEffect(() => {
        runningRef.current = running;
    }, [running]);

    useEffect(() => {
        detectedNoteRef.current = detectedNote;
    }, [detectedNote]);

    const updateLoop = useCallback(() => {
        const analyser = analyserRef.current;
        const buffer = bufferRef.current;
        const frequencyData = frequencyDataRef.current;
        const audioCtx = audioCtxRef.current;

        if (!analyser || !buffer || !frequencyData || !audioCtx) {
            if (runningRef.current) {
                rafRef.current = requestAnimationFrame(updateLoop);
            }
            return;
        }

        analyser.getFloatTimeDomainData(buffer);
        analyser.getByteFrequencyData(frequencyData);

        const spectrumStats = analyzeSpectrum(frequencyData);
        const rms = measureRms(buffer);
        const energyHistory = spectralEnergyHistoryRef.current;
        const rmsHistory = rmsHistoryRef.current;
        const baselineEnergy =
            energyHistory.length > 0
                ? energyHistory.reduce((sum, value) => sum + value, 0) / energyHistory.length
                : spectrumStats.normalizedEnergy;
        const now = window.performance.now();
        const baselineRms =
            rmsHistory.length > 0
                ? rmsHistory.reduce((sum, value) => sum + value, 0) / rmsHistory.length
                : rms;
        const previousRms = previousRmsRef.current;
        const hasAttackCooldownExpired =
            lastAttackAtRef.current === null ||
            now - lastAttackAtRef.current >= ATTACK_COOLDOWN_MS;
        const hasRmsSpike =
            rms >= ATTACK_RMS_THRESHOLD &&
            rms >= Math.max(ATTACK_RMS_THRESHOLD, baselineRms * ATTACK_RMS_SPIKE_FACTOR);
        const hasEnergySpike =
            spectrumStats.normalizedEnergy >=
            Math.max(0.028, baselineEnergy * ATTACK_ENERGY_SPIKE_FACTOR);
        const hasFastTransient = rms - previousRms >= ATTACK_RMS_DELTA;
        const isAttack = hasAttackCooldownExpired && hasEnergySpike && (hasRmsSpike || hasFastTransient);

        energyHistory.push(spectrumStats.normalizedEnergy);
        if (energyHistory.length > MAX_ENERGY_HISTORY) {
            energyHistory.shift();
        }

        rmsHistory.push(rms);
        if (rmsHistory.length > MAX_RMS_HISTORY) {
            rmsHistory.shift();
        }
        previousRmsRef.current = rms;

        if (isAttack) {
            lastAttackAtRef.current = now;
            onAttackDetected?.({
                detectedAtMs: now,
                normalizedEnergy: spectrumStats.normalizedEnergy,
                rms,
            });
        }

        const historySize = responsiveness === "fast" ? 1 : HISTORY_SIZE;
        const tauMax = Math.min(
            Math.floor(audioCtx.sampleRate / MIN_FREQUENCY),
            Math.floor(buffer.length / 2)
        );

        if (!yinBufferRef.current || yinBufferRef.current.length < tauMax + 1) {
            yinBufferRef.current = new Float32Array(tauMax + 1);
        }

        const freq = detectPitchYin(buffer, audioCtx.sampleRate, yinBufferRef.current);

        if (freq !== -1) {
            const history = frequencyHistoryRef.current;
            history.push(freq);
            if (history.length > historySize) history.shift();

            const resolvedFreq =
                responsiveness === "fast" || (isAttack && history.length > 0)
                    ? history[history.length - 1]
                    : median(history);
            const info = frequencyToNoteInfo(resolvedFreq);

            if (info) {
                const lastStable = lastStableNoteRef.current;
                const centsDrift =
                    lastStable.info === null
                        ? 0
                        : Math.abs(
                              1200 * Math.log2(info.frequency / lastStable.info.frequency)
                          );

                if (info.midi === lastStable.midi || centsDrift <= STABILITY_WINDOW_CENTS) {
                    lastStable.frames += 1;
                } else {
                    lastStable.midi = info.midi;
                    lastStable.frames = 1;
                }

                lastStable.info = info;

                if (lastStable.frames >= REQUIRED_STABLE_FRAMES) {
                    const previousDetected = detectedNoteRef.current;
                    const shouldUpdateDetectedNote =
                        previousDetected === null ||
                        previousDetected.midi !== info.midi ||
                        Math.abs(previousDetected.frequency - info.frequency) >=
                            NOTE_UPDATE_EPSILON_HZ ||
                        Math.abs(previousDetected.cents - info.cents) >=
                            CENTS_UPDATE_EPSILON;

                    if (shouldUpdateDetectedNote) {
                        detectedNoteRef.current = info;
                        setDetectedNote(info);
                    }
                    const attackAgeMs =
                        lastAttackAtRef.current === null ? null : now - lastAttackAtRef.current;
                    onNoteDetected?.(info.frequency, info.midi, {
                        attackAgeMs,
                        detectedAtMs: now,
                        isAttack:
                            attackAgeMs !== null &&
                            attackAgeMs >= 0 &&
                            attackAgeMs <= ATTACK_CAPTURE_WINDOW_MS,
                        normalizedEnergy: spectrumStats.normalizedEnergy,
                        rms,
                    });
                }
            }
        } else {
            frequencyHistoryRef.current = [];
            rmsHistoryRef.current = [];
            lastStableNoteRef.current = { midi: -1, frames: 0, info: null };
            if (detectedNoteRef.current !== null) {
                detectedNoteRef.current = null;
                setDetectedNote(null);
            }
        }

        if (runningRef.current) {
            rafRef.current = requestAnimationFrame(updateLoop);
        }
    }, [onAttackDetected, onNoteDetected, responsiveness]);

    const startAudio = useCallback(async () => {
        if (running) return;
        try {
            const AudioCtxClass =
                window.AudioContext ??
                (window as typeof window & { webkitAudioContext?: typeof AudioContext })
                    .webkitAudioContext;

            if (!AudioCtxClass) {
                throw new Error("AudioContext indisponivel");
            }

            const audioCtx = new AudioCtxClass({
                latencyHint: responsiveness === "fast" ? "interactive" : "playback",
            } as AudioContextOptions);
            audioCtxRef.current = audioCtx;
            await audioCtx.resume();

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    autoGainControl: false,
                    channelCount: 1,
                    echoCancellation: false,
                    noiseSuppression: false,
                } as MediaTrackConstraints,
            });
            streamRef.current = stream;

            const source = audioCtx.createMediaStreamSource(stream);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = responsiveness === "fast" ? 1024 : 2048;
            analyser.smoothingTimeConstant = responsiveness === "fast" ? 0.08 : 0.18;
            source.connect(analyser);

            analyserRef.current = analyser;
            bufferRef.current = new Float32Array(
                new ArrayBuffer(analyser.fftSize * Float32Array.BYTES_PER_ELEMENT)
            );
            frequencyDataRef.current = new Uint8Array(
                new ArrayBuffer(analyser.frequencyBinCount * Uint8Array.BYTES_PER_ELEMENT)
            );
            rmsHistoryRef.current = [];
            spectralEnergyHistoryRef.current = [];
            yinBufferRef.current = null;
            lastAttackAtRef.current = null;
            previousRmsRef.current = 0;

            setRunning(true);
            setError(null);
        } catch (err) {
            console.error(err);
            setError("Erro ao acessar microfone. Cheque permissões.");
        }
    }, [responsiveness, running]);

    const stopAudio = useCallback(() => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;

        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        audioCtxRef.current?.close().catch(() => { });
        audioCtxRef.current = null;
        frequencyHistoryRef.current = [];
        rmsHistoryRef.current = [];
        spectralEnergyHistoryRef.current = [];
        frequencyDataRef.current = null;
        yinBufferRef.current = null;
        lastAttackAtRef.current = null;
        previousRmsRef.current = 0;
        detectedNoteRef.current = null;
        lastStableNoteRef.current = { midi: -1, frames: 0, info: null };

        setRunning(false);
        setDetectedNote(null);
    }, []);

    useEffect(() => {
        if (running) {
            rafRef.current = requestAnimationFrame(updateLoop);
        }
        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        }
    }, [running, updateLoop]);

    useEffect(() => {
        return () => stopAudio();
    }, [stopAudio]);

    return { running, detectedNote, startAudio, stopAudio, error };
}
