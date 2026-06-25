import {
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { midiToName, type NoteInfo } from "../utils/music-theory";
import { cn } from "../utils/tailwind-classes";

const COMPACT_BEND_RANGE_CENTS = 220;
const LARGE_BEND_RANGE_CENTS = 620;
const ACTIVE_THRESHOLD_CENTS = 10;
const RESET_GAP_MS = 280;
const RESET_JUMP_CENTS = 80;
const RESET_RANGE_MARGIN_CENTS = 90;
const EASING = 0.16;
const LARGE_INDICATOR_COLORS = [
  "#0F766E", // verde petróleo
  "#65A30D", // oliva
  "#2563EB", // azul
  "#DC2626", // vermelho
  "#16A34A", // verde
  "#CA8A04", // amarelo
  "#9333EA", // roxo
  "#EA580C", // laranja
  "#0891B2", // ciano
  "#4F46E5", // índigo
  "#DB2777", // rosa
  "#B45309", // âmbar
  "#7C3AED", // violeta
];

type BendAnchor = {
  frequency: number;
  midi: number;
  previousAtMs: number;
  previousFrequency: number;
};

type BendDisplay = {
  anchorMidi: number;
  active: boolean;
  cents: number;
  currentLabel: string;
  direction: -1 | 0 | 1;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function centsBetween(currentFrequency: number, referenceFrequency: number) {
  if (
    !isFinite(currentFrequency) ||
    !isFinite(referenceFrequency) ||
    currentFrequency <= 0 ||
    referenceFrequency <= 0
  ) {
    return 0;
  }

  return 1200 * Math.log2(currentFrequency / referenceFrequency);
}

function formatNote(midi: number) {
  const note = midiToName(midi);
  return `${note.name}${note.octave}`;
}

function formatCents(cents: number) {
  if (Math.abs(cents) < 1) return "0c";
  return `${cents > 0 ? "+" : ""}${cents.toFixed(0)}c`;
}

function createAnchor(detectedNote: NoteInfo, now: number): BendAnchor {
  return {
    frequency: detectedNote.frequency,
    midi: detectedNote.midi,
    previousAtMs: now,
    previousFrequency: detectedNote.frequency,
  };
}

function getNearestMarkerIndex(cents: number, markerValues: number[]) {
  return markerValues.reduce((closestIndex, marker, index) => {
    const currentDistance = Math.abs(cents - marker);
    const closestDistance = Math.abs(cents - markerValues[closestIndex]);
    return currentDistance < closestDistance ? index : closestIndex;
  }, 0);
}

interface BendMeterProps {
  detectedNote: NoteInfo | null;
  onOpen?: () => void;
  variant?: "compact" | "large";
}

export default function BendMeter({
  detectedNote,
  onOpen,
  variant = "compact",
}: BendMeterProps) {
  const anchorRef = useRef<BendAnchor | null>(null);
  const targetCentsRef = useRef(0);
  const [animatedCents, setAnimatedCents] = useState(0);
  const [compactEnabled, setCompactEnabled] = useState(false);
  const [display, setDisplay] = useState<BendDisplay | null>(null);
  const isLarge = variant === "large";
  const isCompactDisabled = !isLarge && !compactEnabled;
  const effectiveDetectedNote = isCompactDisabled ? null : detectedNote;
  const bendRangeCents = isLarge
    ? LARGE_BEND_RANGE_CENTS
    : COMPACT_BEND_RANGE_CENTS;
  const maxTrackedBendCents = bendRangeCents + RESET_RANGE_MARGIN_CENTS;

  useEffect(() => {
    if (!effectiveDetectedNote) {
      anchorRef.current = null;
      targetCentsRef.current = 0;
      setDisplay(null);
      return;
    }

    const now = window.performance.now();
    let anchor = anchorRef.current;

    if (!anchor) {
      anchor = createAnchor(effectiveDetectedNote, now);
      anchorRef.current = anchor;
    }

    const frameDriftCents = centsBetween(
      effectiveDetectedNote.frequency,
      anchor.previousFrequency,
    );
    const bendCents = centsBetween(
      effectiveDetectedNote.frequency,
      anchor.frequency,
    );
    const elapsedMs = now - anchor.previousAtMs;
    const shouldResetAnchor =
      elapsedMs > RESET_GAP_MS ||
      Math.abs(bendCents) > maxTrackedBendCents ||
      (Math.abs(frameDriftCents) >= RESET_JUMP_CENTS &&
        Math.abs(bendCents) >= ACTIVE_THRESHOLD_CENTS);

    if (shouldResetAnchor) {
      anchor = createAnchor(effectiveDetectedNote, now);
      anchorRef.current = anchor;
      targetCentsRef.current = 0;
      setDisplay({
        anchorMidi: effectiveDetectedNote.midi,
        active: false,
        cents: 0,
        currentLabel: `${effectiveDetectedNote.name}${effectiveDetectedNote.octave}`,
        direction: 0,
      });
      return;
    }

    anchor.previousAtMs = now;
    anchor.previousFrequency = effectiveDetectedNote.frequency;

    const clampedCents = clamp(bendCents, -bendRangeCents, bendRangeCents);
    const direction =
      Math.abs(clampedCents) < ACTIVE_THRESHOLD_CENTS
        ? 0
        : clampedCents > 0
          ? 1
          : -1;

    targetCentsRef.current = clampedCents;
    setDisplay({
      anchorMidi: anchor.midi,
      active: Math.abs(clampedCents) >= ACTIVE_THRESHOLD_CENTS,
      cents: Math.round(clampedCents),
      currentLabel: `${effectiveDetectedNote.name}${effectiveDetectedNote.octave}`,
      direction,
    });
  }, [bendRangeCents, effectiveDetectedNote, maxTrackedBendCents]);

  useEffect(() => {
    let animationFrameId = 0;

    function animate() {
      setAnimatedCents((current) => {
        const target = targetCentsRef.current;
        const delta = target - current;

        if (Math.abs(delta) < 0.18) {
          return target;
        }

        return current + delta * EASING;
      });
      animationFrameId = window.requestAnimationFrame(animate);
    }

    animationFrameId = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(animationFrameId);
  }, []);

  const markerValues = isLarge
    ? [-600, -500, -400, -300, -200, -100, 0, 100, 200, 300, 400, 500, 600]
    : [-200, -100, 0, 100, 200];
  const markerLabels = isLarge
    ? [
        "-6",
        "-5",
        "-4",
        "-3",
        "-2",
        "-1",
        "0",
        "+1",
        "+2",
        "+3",
        "+4",
        "+5",
        "+6",
      ]
    : ["-2", "-1", "0", "+1", "+2"];
  const activeMarkerIndex = getNearestMarkerIndex(
    display?.cents ?? 0,
    markerValues,
  );
  const activeIndicatorColor = LARGE_INDICATOR_COLORS[activeMarkerIndex];
  const rawNotePosition =
    ((clamp(animatedCents, -bendRangeCents, bendRangeCents) + bendRangeCents) /
      (bendRangeCents * 2)) *
    100;
  const notePosition = clamp(rawNotePosition, 8, 92);
  const centsLabel = display ? formatCents(display.cents) : isLarge ? "--" : "";
  const anchorLabel = display ? formatNote(display.anchorMidi) : "--";
  const currentLabel = display?.currentLabel ?? "--";
  const directionGlyph = !display
    ? isLarge
      ? "--"
      : ""
    : display.direction === 1
      ? "UP"
      : display.direction === -1
        ? "DN"
        : "MID";
  const containerClassName = cn(
    "relative rounded-[0.9rem] border border-[rgba(85,199,223,0.13)] [background:linear-gradient(180deg,rgba(85,199,223,0.07)_0%,transparent_100%),var(--app-readout)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),inset_0_-2px_4px_rgba(0,0,0,0.24),0_0_18px_rgba(85,199,223,0.06)]",
    isLarge
      ? "h-[16rem] min-h-[16rem] w-full px-9 py-5"
      : "h-[3.55rem] min-h-[3.55rem] w-[18.75rem] min-w-[18.75rem] max-w-[18.75rem] px-3 py-[0.38rem] max-[900px]:w-full max-[900px]:min-w-0 max-[900px]:max-w-full",
    onOpen &&
      "cursor-pointer text-left transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-0.5 hover:border-[rgba(242,179,76,0.34)] focus-visible:outline-none focus-visible:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),inset_0_0_0_1px_rgba(85,199,223,0.18),0_0_0_2px_rgba(224,159,83,0.35),0_6px_16px_rgba(0,0,0,0.32),0_0_18px_rgba(85,199,223,0.1)]",
    display?.active &&
      !isCompactDisabled &&
      "border-[rgba(242,179,76,0.26)] shadow-[inset_0_1px_0_rgba(255,255,255,0.07),inset_0_-2px_4px_rgba(0,0,0,0.24),0_0_20px_rgba(242,179,76,0.12)]",
    isCompactDisabled && "opacity-70",
  );
  const headerClassName = cn(
    "font-mono font-bold uppercase leading-none text-[var(--color-text-secondary)]",
    isLarge
      ? "text-[0.82rem] tracking-[0.24em]"
      : "text-[0.58rem] tracking-[0.18em]",
  );
  const noteMetaClassName = cn(
    "flex min-w-0 items-center gap-1.5 font-mono leading-none",
    isLarge ? "text-[1.18rem]" : "text-[0.62rem]",
  );
  const noteClassName = cn(
    "font-bold",
    isLarge ? "min-w-[4.5rem]" : "min-w-[2.55rem]",
  );
  const directionClassName = cn(
    "ml-0.5 text-right text-[rgba(244,219,192,0.38)]",
    isLarge
      ? "min-w-[3.2rem] text-[0.95rem]"
      : "min-w-[1.85rem] text-[0.56rem]",
    display?.active && "text-[#f2b34c]",
  );
  const trackClassName = cn(
    "relative overflow-hidden rounded-full border border-[rgba(244,219,192,0.1)] bg-[linear-gradient(90deg,rgba(198,91,109,0.16)_0%,rgba(85,199,223,0.1)_50%,rgba(145,191,95,0.18)_100%)] shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)]",
    isLarge ? "mt-8 h-20" : "mt-1 h-5",
  );
  const markerClassName = cn(
    "absolute top-1/2 w-px -translate-y-1/2 bg-[rgba(244,219,192,0.18)]",
    isLarge ? "h-10" : "h-2.5",
  );
  const bubbleClassName = cn(
    "absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border font-mono font-bold leading-none transition-[box-shadow,border-color,color] duration-150",
    isLarge
      ? "h-[3.9rem] min-w-[7rem] px-4 text-[1.65rem]"
      : "h-[1.16rem] min-w-[2.55rem] px-1.5 text-[0.62rem]",
    display?.active && isLarge
      ? "text-[#1d1208]"
      : display?.active
        ? "border-[rgba(242,179,76,0.54)] bg-[linear-gradient(180deg,#f1c875_0%,#ad6e22_100%)] text-[#1d1208] shadow-[0_0_16px_rgba(242,179,76,0.34)]"
        : "border-[rgba(244,219,192,0.22)] bg-[linear-gradient(180deg,#5d5046_0%,#2a211a_100%)] text-[var(--color-text-primary)] shadow-[0_5px_10px_rgba(0,0,0,0.28)]",
  );
  const markerLabelClassName = cn(
    "grid items-center font-mono leading-none text-[rgba(244,219,192,0.38)]",
    isLarge ? "grid-cols-[repeat(13,minmax(0,1fr))]" : "grid-cols-5",
    isLarge ? "mt-3 text-[0.82rem]" : "mt-[0.28rem] text-[0.5rem]",
  );
  const centsClassName = cn(
    "absolute font-mono font-bold leading-none text-[var(--color-text-secondary)]",
    isLarge
      ? "bottom-5 right-7 text-[1.2rem]"
      : "bottom-[0.28rem] right-3 text-[0.56rem]",
    display?.active && "text-[#f2b34c]",
  );
  function toggleCompactEnabled(event: MouseEvent | KeyboardEvent) {
    event.stopPropagation();
  }

  function handleOpenKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!onOpen) return;

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen();
    }
  }

  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={headerClassName}>Bend</span>
          {!isLarge && (
            <label
              className="relative inline-flex h-[0.62rem] w-[2.1rem] cursor-pointer items-center rounded-full border border-[rgba(244,219,192,0.15)] bg-[linear-gradient(90deg,rgba(198,91,109,0.18),rgba(145,191,95,0.2))] shadow-[inset_0_1px_3px_rgba(0,0,0,0.55)]"
              aria-label={
                compactEnabled
                  ? "Desativar bend compacto"
                  : "Ativar bend compacto"
              }
              onClick={toggleCompactEnabled}
              onKeyDown={toggleCompactEnabled}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={compactEnabled}
                onChange={(event) => setCompactEnabled(event.target.checked)}
              />
              <span
                className={cn(
                  "absolute left-[0.1rem] h-[0.42rem] w-[0.86rem] rounded-full border border-[rgba(255,255,255,0.14)] bg-[linear-gradient(180deg,#625246_0%,#332821_100%)] shadow-[0_1px_4px_rgba(0,0,0,0.55)] transition-transform duration-150",
                  compactEnabled && "translate-x-[0.96rem]",
                )}
              />
            </label>
          )}
        </div>
        <div className={noteMetaClassName}>
          <span className={cn(noteClassName, "text-right text-[#c8e58d]")}>
            {anchorLabel}
          </span>
          <span className="text-[rgba(244,219,192,0.28)]">/</span>
          <span
            className={cn(
              noteClassName,
              "text-left text-[var(--color-tech-warm)]",
            )}
          >
            {currentLabel}
          </span>
          <span className={directionClassName}>{directionGlyph}</span>
        </div>
      </div>

      <div className={trackClassName}>
        <span className="absolute left-1/2 top-0 h-full w-px bg-[rgba(244,219,192,0.4)] shadow-[0_0_10px_rgba(244,219,192,0.14)]" />
        {markerValues.map((mark) => {
          const markerPosition =
            ((mark + bendRangeCents) / (bendRangeCents * 2)) * 100;

          return (
            <span
              key={mark}
              className={markerClassName}
              style={{ left: `${markerPosition}%` }}
            />
          );
        })}
        <span
          className={bubbleClassName}
          style={{
            background:
              display?.active && isLarge ? activeIndicatorColor : undefined,
            borderColor:
              display?.active && isLarge
                ? `${activeIndicatorColor}cc`
                : undefined,
            boxShadow:
              display?.active && isLarge
                ? `0 0 18px ${activeIndicatorColor}66`
                : undefined,
            left: `${notePosition}%`,
          }}
        >
          {display ? currentLabel : "--"}
        </span>
      </div>

      <div className={markerLabelClassName}>
        {markerLabels.map((label, index) => (
          <span
            key={label}
            className={cn(
              "text-center",
              index === Math.floor(markerLabels.length / 2) && "font-bold",
            )}
          >
            {label}
          </span>
        ))}
      </div>

      <span className={centsClassName}>{centsLabel}</span>
    </>
  );

  if (onOpen) {
    return (
      <div
        onClick={onOpen}
        onKeyDown={handleOpenKeyDown}
        className={containerClassName}
        role="button"
        tabIndex={0}
        aria-label="Abrir medidor de bend ampliado"
        title="Abrir medidor de bend"
      >
        {content}
      </div>
    );
  }

  return (
    <div className={containerClassName} aria-label="Bendômetro">
      {content}
    </div>
  );
}
