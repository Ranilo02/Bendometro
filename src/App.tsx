import BendMeter from "./components/BendMeter";
import { useAudioAnalyzer } from "./hooks/useAudioAnalyzer";
import { cn } from "./utils/tailwind-classes";

export default function App() {
  const { detectedNote, error, running, startAudio, stopAudio } =
    useAudioAnalyzer(undefined, { responsiveness: "fast" });

  function toggleAudio() {
    if (running) {
      stopAudio();
      return;
    }

    void startAudio();
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1280px] flex-col justify-center gap-4 px-4 py-4">
      <header className="flex min-h-14 items-center justify-between gap-3 rounded-[1rem] border border-[var(--app-panel-border)] [background:var(--app-panel)] px-4 shadow-[inset_0_1px_0_var(--app-panel-highlight),0_10px_24px_rgba(0,0,0,0.25)]">
        <div className="min-w-0">
          <h1 className="m-0 truncate font-mono text-[0.92rem] font-bold uppercase tracking-[0.2em] text-[var(--color-text-primary)]">
            Bendometro
          </h1>
          {error ? (
            <p className="m-0 mt-1 truncate text-[0.72rem] text-[#ffd8cc]">
              {error}
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={toggleAudio}
          className={cn(
            "min-h-10 shrink-0 rounded-[0.75rem] border px-4 font-mono text-[0.76rem] font-bold uppercase tracking-[0.12em] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_6px_12px_rgba(0,0,0,0.24)] transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-0.5",
            running
              ? "border-[rgba(186,80,56,0.42)] bg-[linear-gradient(180deg,#8d4a3a_0%,#4e241b_100%)] text-[#ffe2d8]"
              : "border-[rgba(242,179,76,0.34)] bg-[linear-gradient(180deg,#6f4e29_0%,#3a2617_100%)] text-[#ffe2a7]",
          )}
        >
          {running ? "Desligar" : "Ligar"}
        </button>
      </header>

      <BendMeter detectedNote={detectedNote} variant="large" />
    </main>
  );
}
