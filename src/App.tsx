import { useEffect, useState } from "react";
import BendMeter from "./components/BendMeter";
import { useAudioAnalyzer } from "./hooks/useAudioAnalyzer";
import { cn } from "./utils/tailwind-classes";

export default function App() {
  const [manualScreenRotated, setManualScreenRotated] = useState(false);
  const [autoScreenRotated, setAutoScreenRotated] = useState(() =>
    window.matchMedia("(max-width: 799px)").matches,
  );
  const { detectedNote, error, running, startAudio, stopAudio } =
    useAudioAnalyzer(undefined, { responsiveness: "fast" });
  const screenRotated = autoScreenRotated || manualScreenRotated;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 799px)");

    function updateAutoRotation() {
      setAutoScreenRotated(mediaQuery.matches);
    }

    updateAutoRotation();
    mediaQuery.addEventListener("change", updateAutoRotation);
    return () => mediaQuery.removeEventListener("change", updateAutoRotation);
  }, []);

  function toggleAudio() {
    if (running) {
      stopAudio();
      return;
    }

    void startAudio();
  }

  return (
    <div
      className={cn(
        "min-h-screen",
        screenRotated && "fixed inset-0 overflow-hidden",
      )}
    >
      <main
        className={cn(
          "mx-auto flex min-h-screen w-full max-w-[1280px] flex-col justify-center gap-4 px-4 py-4",
          screenRotated &&
            "absolute left-1/2 top-1/2 !h-[100dvw] !min-h-[100dvw] !w-[100dvh] !max-w-none -translate-x-1/2 -translate-y-1/2 rotate-90 overflow-hidden",
        )}
      >
        <header className="flex min-h-14 items-center justify-between gap-3 rounded-[1rem] border border-[var(--app-panel-border)] [background:var(--app-panel)] px-4 shadow-[inset_0_1px_0_var(--app-panel-highlight),0_10px_24px_rgba(0,0,0,0.25)]">
          <div className="min-w-0">
            <h1 className="m-0 truncate font-mono text-[0.92rem] font-bold uppercase tracking-[0.2em] text-[var(--color-text-primary)]">
              Bendômetro
            </h1>
            {error ? (
              <p className="m-0 mt-1 truncate text-[0.72rem] text-[#ffd8cc]">
                {error}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setManualScreenRotated((current) => !current)}
              className="min-h-10 rounded-[0.75rem] border border-[rgba(244,219,192,0.18)] bg-[linear-gradient(180deg,#51443a_0%,#2b221d_100%)] px-3 font-mono text-[0.7rem] font-bold uppercase tracking-[0.1em] text-[var(--color-text-secondary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_6px_12px_rgba(0,0,0,0.22)] transition-[transform,border-color,color] duration-150 hover:-translate-y-0.5 hover:border-[rgba(242,179,76,0.34)] hover:text-[#f2b34c] max-[799px]:hidden"
              aria-pressed={screenRotated}
              title={screenRotated ? "Voltar tela ao normal" : "Girar tela"}
            >
              {screenRotated ? "Normal" : "Girar"}
            </button>

            <button
              type="button"
              onClick={toggleAudio}
              className={cn(
                "min-h-10 rounded-[0.75rem] border px-4 font-mono text-[0.76rem] font-bold uppercase tracking-[0.12em] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_6px_12px_rgba(0,0,0,0.24)] transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-0.5",
                running
                  ? "border-[rgba(186,80,56,0.42)] bg-[linear-gradient(180deg,#8d4a3a_0%,#4e241b_100%)] text-[#ffe2d8]"
                  : "border-[rgba(242,179,76,0.34)] bg-[linear-gradient(180deg,#6f4e29_0%,#3a2617_100%)] text-[#ffe2a7]",
              )}
            >
              {running ? "Desligar" : "Ligar"}
            </button>
          </div>
        </header>

        <BendMeter detectedNote={detectedNote} variant="large" />
      </main>
    </div>
  );
}
