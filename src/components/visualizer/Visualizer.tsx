import { useEffect, useRef, useState } from "react";
import {
  AudioLines,
  Disc3,
  Download,
  Maximize,
  Minimize,
  Mic,
  Music,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Waves,
} from "lucide-react";
import { AudioEngine, type SourceKind } from "@/components/visualizer/audio-engine";
import { startVisualizer } from "@/components/visualizer/loop";
import { MODES, THEMES, themeById, type Mode } from "@/components/visualizer/themes";

const PREFS_KEY = "lumen-prefs";

const BTN =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium text-white/80 transition-all duration-200 hover:bg-white/10 hover:text-white focus-visible:outline-2 active:scale-95 disabled:opacity-30";

const BTN_ON =
  "!bg-white/20 !text-white border border-white/40 shadow-[0_0_12px_rgba(255,255,255,0.25)] backdrop-blur-md font-semibold";

function isVideoFile(file: File | undefined): boolean {
  if (!file) return false;
  if (file.type.startsWith("video/")) return true;
  return /\.(mp4|mkv|mov|avi|webm|m4v)$/i.test(file.name);
}

function isPlayableMedia(file: File): boolean {
  if (file.type.startsWith("audio/") || file.type.startsWith("video/")) return true;
  return /\.(mp3|wav|ogg|m4a|aac|flac|webm|mp4|mkv|mov|avi|m4v)$/i.test(file.name);
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// MP3 انکوڈر لائبریری کو خود بخود لوڈ کرنے کا فنکشن
function ensureLameLoaded(): Promise<any> {
  return new Promise((resolve, reject) => {
    const win = window as any;
    if (win.lamejs && win.lamejs.Mp3Encoder) {
      return resolve(win.lamejs);
    }
    const existing = document.getElementById("lamejs-cdn");
    if (existing) {
      existing.addEventListener("load", () => resolve((window as any).lamejs));
      return;
    }
    const script = document.createElement("script");
    script.id = "lamejs-cdn";
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.all.min.js";
    script.onload = () => resolve((window as any).lamejs);
    script.onerror = () => reject(new Error("MP3 library load nahi ho saki"));
    document.head.appendChild(script);
  });
}

function audioBufferToMp3(buffer: AudioBuffer, LameInstance: any): Blob {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const mp3encoder = new LameInstance.Mp3Encoder(channels >= 2 ? 2 : 1, sampleRate, 128);
  const mp3Data: Uint8Array[] = [];

  const left = buffer.getChannelData(0);
  const right = channels >= 2 ? buffer.getChannelData(1) : left;

  const sampleCount = left.length;
  const leftInt16 = new Int16Array(sampleCount);
  const rightInt16 = new Int16Array(sampleCount);

  for (let i = 0; i < sampleCount; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    leftInt16[i] = l < 0 ? l * 0x8000 : l * 0x7fff;
    const r = Math.max(-1, Math.min(1, right[i]));
    rightInt16[i] = r < 0 ? r * 0x8000 : r * 0x7fff;
  }

  const chunkSize = 1152;
  for (let i = 0; i < sampleCount; i += chunkSize) {
    const leftChunk = leftInt16.subarray(i, i + chunkSize);
    let mp3buf: Int8Array;
    if (channels >= 2) {
      const rightChunk = rightInt16.subarray(i, i + chunkSize);
      mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
    } else {
      mp3buf = mp3encoder.encodeBuffer(leftChunk);
    }
    if (mp3buf.length > 0) {
      mp3Data.push(new Uint8Array(mp3buf));
    }
  }

  const end = mp3encoder.flush();
  if (end.length > 0) {
    mp3Data.push(new Uint8Array(end));
  }

  return new Blob(mp3Data, { type: "audio/mp3" });
}

export function Visualizer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<AudioEngine | null>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const dockHover = useRef(false);
  const hideTimer = useRef(0);
  const dragDepth = useRef(0);

  const [kind, setKind] = useState<SourceKind>("idle");
  const [mode, setMode] = useState<Mode>("bars");
  const [themeId, setThemeId] = useState("tide");
  const [sensitivity, setSensitivity] = useState(1.2);
  const [playing, setPlaying] = useState(false);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [chromeOn, setChromeOn] = useState(true);
  const [reduced, setReduced] = useState(false);
  const [busy, setBusy] = useState<"mic" | "file" | "sample" | null>(null);
  const [extractingAudio, setExtractingAudio] = useState(false);

  // Playlist Management
  const [playlist, setPlaylist] = useState<File[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const playlistRef = useRef<File[]>([]);
  const currentIndexRef = useRef(0);
  playlistRef.current = playlist;
  currentIndexRef.current = currentIndex;

  const currentFile = playlist[currentIndex];

  const kindRef = useRef(kind);
  const modeRef = useRef(mode);
  const themeRef = useRef(themeId);
  const sensRef = useRef(sensitivity);
  const reducedRef = useRef(reduced);
  kindRef.current = kind;
  modeRef.current = mode;
  themeRef.current = themeId;
  sensRef.current = sensitivity;
  reducedRef.current = reduced;

  const sync = () => {
    const engine = engineRef.current;
    if (!engine) return;
    setKind(engine.kind);
    setPlaying(engine.isPlaying());
    setFileName(engine.fileName);
    setError(engine.error);
    const times = engine.getTimes();
    setTime(times.current);
    setDuration(times.duration);
  };

  const poke = () => {
    setChromeOn(true);
    window.clearTimeout(hideTimer.current);
    if (reducedRef.current || kindRef.current === "idle") return;
    hideTimer.current = window.setTimeout(() => {
      if (!dockHover.current) setChromeOn(false);
    }, 3200);
  };

  const playSongAtIndex = async (index: number) => {
    const files = playlistRef.current;
    if (!files.length || index < 0 || index >= files.length) return;
    setCurrentIndex(index);
    currentIndexRef.current = index;
    const targetFile = files[index];
    setBusy("file");
    try {
      await engineRef.current?.openFile(targetFile);
      sync();
      poke();
    } catch {
      setError("Error playing: " + targetFile.name);
    } finally {
      setBusy(null);
    }
  };

  const nextTrack = async () => {
    if (playlistRef.current.length > 0) {
      const nextIdx = (currentIndexRef.current + 1) % playlistRef.current.length;
      await playSongAtIndex(nextIdx);
    }
  };

  const prevTrack = async () => {
    if (playlistRef.current.length > 0) {
      const prevIdx =
        (currentIndexRef.current - 1 + playlistRef.current.length) % playlistRef.current.length;
      await playSongAtIndex(prevIdx);
    }
  };

  // Video se خالص 100% یونیورسل MP3 میں نکالنا
  const handleDownloadInAudio = async () => {
    if (!currentFile || !isVideoFile(currentFile)) return;
    setExtractingAudio(true);
    try {
      const lameLib = await ensureLameLoaded();
      const arrayBuffer = await currentFile.arrayBuffer();
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const tempAudioCtx = new AudioCtx();
      const decodedBuffer = await tempAudioCtx.decodeAudioData(arrayBuffer);
      
      const mp3Blob = audioBufferToMp3(decodedBuffer, lameLib);
      await tempAudioCtx.close();

      const downloadUrl = URL.createObjectURL(mp3Blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      const baseName = currentFile.name.replace(/\.[^/.]+$/, "");
      a.download = `${baseName}.mp3`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
    } catch (err: any) {
      setError(err?.message || "MP3 extract nahi ho saka.");
    } finally {
      setExtractingAudio(false);
    }
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { mode?: Mode; theme?: string; sensitivity?: number };
      if (saved.mode && MODES.some((item) => item.id === saved.mode)) setMode(saved.mode);
      if (saved.theme && THEMES.some((item) => item.id === saved.theme)) setThemeId(saved.theme);
      if (typeof saved.sensitivity === "number" && saved.sensitivity >= 0.4 && saved.sensitivity <= 2.6) {
        setSensitivity(saved.sensitivity);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ mode, theme: themeId, sensitivity }),
    );
  }, [mode, themeId, sensitivity]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new AudioEngine();
    engineRef.current = engine;
    const stop = startVisualizer(canvas, engine, () => ({
      mode: modeRef.current,
      theme: themeById(themeRef.current),
      sensitivity: sensRef.current,
      reduced: reducedRef.current,
    }));

    const poll = window.setInterval(() => {
      const times = engine.getTimes();
      const isPlay = engine.isPlaying();
      setPlaying((value) => (value === isPlay ? value : isPlay));
      setKind((value) => (value === engine.kind ? value : engine.kind));
      setTime((value) => (Math.abs(value - times.current) < 0.04 ? value : times.current));
      setDuration((value) => (Math.abs(value - times.duration) < 0.04 ? value : times.duration));
      setError((value) => (value === engine.error ? value : engine.error));
      setFileName((value) => (value === engine.fileName ? value : engine.fileName));

      // اٹو پلے نیکسٹ گانا
      if (
        engine.kind === "file" &&
        times.duration > 2 &&
        times.current >= times.duration - 0.25 &&
        playlistRef.current.length > 1
      ) {
        void nextTrack();
      }
    }, 200);

    return () => {
      window.clearInterval(poll);
      stop();
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      if (event.code === "Space" && !typing) {
        event.preventDefault();
        void engineRef.current?.togglePlay().then(sync);
      } else if ((event.key === "f" || event.key === "F") && !typing) {
        event.preventDefault();
        void toggleFullscreen();
      } else if ((event.key === "m" || event.key === "M") && !typing) {
        setMode((current) => {
          const index = MODES.findIndex((item) => item.id === current);
          return MODES[(index + 1) % MODES.length].id;
        });
      }
      poke();
    };
    const onFs = () => setFullscreen(document.fullscreenElement === stageRef.current);
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFs);
      window.clearTimeout(hideTimer.current);
    };
  }, []);

  useEffect(() => {
    if (kind === "idle" || reduced) setChromeOn(true);
  }, [kind, reduced]);

  async function toggleFullscreen() {
    const node = stageRef.current;
    if (!node) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await node.requestFullscreen();
    } catch {
      setError("Fullscreen is not available in this browser.");
    }
  }

  function handleMediaSelect(filesList: FileList | null) {
    if (!filesList || filesList.length === 0) return;
    const mediaFiles = Array.from(filesList)
      .filter((file) => isPlayableMedia(file))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

    if (mediaFiles.length === 0) {
      setError("Koi audio ya video file nahi mili.");
      return;
    }

    setPlaylist(mediaFiles);
    playlistRef.current = mediaFiles;
    setCurrentIndex(0);
    currentIndexRef.current = 0;
    void playSongAtIndex(0);
  }

  async function onMic() {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.kind === "mic") {
      engine.stopMic();
      sync();
      return;
    }
    setBusy("mic");
    try {
      await engine.enableMic();
    } catch {
      /* ignore */
    } finally {
      sync();
      setBusy(null);
      poke();
    }
  }

  async function onSample() {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.kind === "sample" && engine.isPlaying()) {
      await engine.togglePlay();
      sync();
      return;
    }
    setBusy("sample");
    try {
      await engine.playSample();
    } finally {
      sync();
      setBusy(null);
      poke();
    }
  }

  const theme = themeById(themeId);
  const seekPct = duration > 0 ? (time / duration) * 100 : 0;
  const status =
    kind === "mic"
      ? "Microphone"
      : kind === "sample"
        ? "Sample loop"
        : kind === "file"
          ? `${fileName} ${playlist.length > 1 ? `(${currentIndex + 1}/${playlist.length})` : ""}`
          : "Ready";

  return (
    <main
      ref={stageRef}
      className="stage"
      data-chrome={chromeOn ? "on" : "off"}
      data-source={kind}
      data-playing={playing ? "true" : "false"}
      data-mode={mode}
      onPointerMove={poke}
      onPointerDown={poke}
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        const files = event.dataTransfer.files;
        if (files && files.length > 0) {
          handleMediaSelect(files);
        }
      }}
    >
      <canvas ref={canvasRef} aria-hidden="true" />

      {/* ALL-IN-ONE BOTTOM CONTROLLER */}
      <div className="stage-overlay pointer-events-none">
        <div
          ref={dockRef}
          className="fixed bottom-2 left-1/2 -translate-x-1/2 z-50 pointer-events-auto flex flex-col gap-1.5 p-2 rounded-2xl bg-black/45 backdrop-blur-xl border border-white/10 shadow-2xl transition-all duration-300 opacity-80 hover:opacity-100 w-[96%] max-w-lg"
          style={{ transform: "scale(0.88)", transformOrigin: "bottom center" }}
          onPointerEnter={() => {
            dockHover.current = true;
            poke();
          }}
          onPointerLeave={() => {
            dockHover.current = false;
            poke();
          }}
        >
          {/* Status Bar */}
          <div className="flex items-center justify-between px-1 text-xs text-white/70 border-b border-white/5 pb-1">
            <span className="font-semibold tracking-wide text-white text-[11px]">Lumen</span>
            <span className="truncate max-w-[70%] text-right text-[11px] font-mono text-white/90">
              {status}
            </span>
          </div>

          {/* Seekbar */}
          {kind === "file" && duration > 0 ? (
            <div className="flex items-center gap-2 px-1">
              <span className="w-8 text-[10px] text-white/60 tabular-nums">{formatTime(time)}</span>
              <input
                className="seek"
                type="range"
                min={0}
                max={duration}
                step={0.01}
                value={Math.min(time, duration)}
                aria-label="Seek"
                suppressHydrationWarning
                style={{
                  background: `linear-gradient(to right, var(--color-fg) ${seekPct}%, color-mix(in oklab, var(--color-fg) 22%, transparent) ${seekPct}%)`,
                  caretColor: "transparent",
                }}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (duration > 0) engineRef.current?.seek(next / duration);
                  setTime(next);
                }}
              />
              <span className="w-8 text-right text-[10px] text-white/60 tabular-nums">{formatTime(duration)}</span>
            </div>
          ) : null}

          {/* Controls Row */}
          <div className="flex flex-wrap items-center gap-1.5">
            {playlist.length > 1 && (
              <button
                type="button"
                className={`${BTN} px-1.5 min-w-7`}
                aria-label="Previous Track"
                onClick={() => void prevTrack()}
              >
                <SkipBack className="size-3.5" />
              </button>
            )}

            <button
              type="button"
              className={`${BTN} ${playing ? BTN_ON : "bg-white/5"} min-w-8 px-0`}
              aria-label={playing ? "Pause" : "Play"}
              disabled={kind === "idle" || busy !== null}
              onClick={() => void engineRef.current?.togglePlay().then(sync)}
            >
              {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            </button>

            {playlist.length > 1 && (
              <button
                type="button"
                className={`${BTN} px-1.5 min-w-7`}
                aria-label="Next Track"
                onClick={() => void nextTrack()}
              >
                <SkipForward className="size-3.5" />
              </button>
            )}

            <div className="seg" role="group" aria-label="Audio source">
              <button
                type="button"
                className={`${BTN} ${kind === "mic" ? BTN_ON : ""}`}
                aria-pressed={kind === "mic"}
                onClick={() => void onMic()}
                disabled={busy === "mic"}
              >
                <Mic className="size-3.5" />
                {busy === "mic" ? "Asking" : kind === "mic" ? "Live" : "Mic"}
              </button>

              <button
                type="button"
                className={`${BTN} ${kind === "file" ? BTN_ON : ""}`}
                onClick={() => mediaInputRef.current?.click()}
                title="Select Songs or Videos (Ctrl+A for full folder)"
              >
                <Music className="size-3.5" />
                Open Songs / Videos
              </button>

              <button
                type="button"
                className={`${BTN} ${kind === "sample" ? BTN_ON : ""}`}
                onClick={() => void onSample()}
                disabled={busy === "sample"}
              >
                Sample
              </button>
            </div>

            {/* DYNAMIC BUTTON: صرف ویڈیو پر ظاہر ہوگا اور خالص MP3 دے گا */}
            {isVideoFile(currentFile) && (
              <button
                type="button"
                className={`${BTN} !bg-emerald-500/20 !text-emerald-300 border border-emerald-500/40 hover:!bg-emerald-500/30 animate-pulse`}
                disabled={extractingAudio}
                onClick={() => void handleDownloadInAudio()}
                title="Extract and download clean MP3 audio from this video"
              >
                <Download className="size-3.5" />
                {extractingAudio ? "Converting to MP3…" : "Download in Audio"}
              </button>
            )}

            {kind === "mic" ? (
              <span className="inline-flex items-center gap-1 px-1 text-[11px] text-white/60">
                <span className="live-dot" aria-hidden="true" />
                Live
              </span>
            ) : null}
          </div>

          {/* Row 2: Visualizer Modes, Themes, Sens */}
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="seg" role="radiogroup" aria-label="Visualization">
              {MODES.map((item) => {
                const Icon = item.id === "bars" ? AudioLines : item.id === "halo" ? Disc3 : Waves;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={mode === item.id}
                    className={`${BTN} ${mode === item.id ? BTN_ON : ""}`}
                    onClick={() => setMode(item.id)}
                  >
                    <Icon className="size-3.5" />
                    {item.label}
                  </button>
                );
              })}
            </div>

            <div className="seg" role="radiogroup" aria-label="Color theme">
              {THEMES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={themeId === item.id}
                  aria-label={item.label}
                  className="swatch-hit"
                  onClick={() => setThemeId(item.id)}
                >
                  <span className="swatch" data-theme={item.id} />
                </button>
              ))}
            </div>

            <label className="flex h-8 items-center gap-1.5 px-1">
              <span className="text-[11px] text-white/60">Sens</span>
              <input
                className="sens"
                type="range"
                min={0.45}
                max={2.5}
                step={0.01}
                value={sensitivity}
                aria-label="Sensitivity"
                aria-valuetext={sensitivity.toFixed(2)}
                suppressHydrationWarning
                style={{ caretColor: "transparent" }}
                onChange={(event) => setSensitivity(Number(event.target.value))}
              />
            </label>

            <button
              type="button"
              className={`${BTN} ml-auto bg-white/5 px-0 min-w-8`}
              aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
              onClick={() => void toggleFullscreen()}
            >
              {fullscreen ? <Minimize className="size-3.5" /> : <Maximize className="size-3.5" />}
            </button>
          </div>

          {error ? (
            <p role="alert" className="px-1 text-[11px] text-red-400">
              {error}
            </p>
          ) : null}
          <p className="sr-only" aria-live="polite">
            {theme.label}, {MODES.find((item) => item.id === mode)?.label}. {playing ? "Playing" : "Stopped"}.
          </p>
        </div>
      </div>

      {dragging ? <div className="dropveil">Drop audio or video files here</div> : null}

      <input
        ref={mediaInputRef}
        className="sr-only"
        type="file"
        multiple
        accept="audio/*,video/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.webm,.mp4,.mkv,.mov,.avi"
        aria-label="Choose media files"
        suppressHydrationWarning
        style={{ caretColor: "transparent" }}
        onChange={(event) => {
          handleMediaSelect(event.target.files);
          event.target.value = "";
        }}
      />
    </main>
  );
}