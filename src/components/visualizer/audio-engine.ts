export type SourceKind = "idle" | "file" | "mic" | "sample";

const BASS_NOTES = [55, 0, 55, 82.41, 65.41, 0, 73.42, 98, 55, 0, 65.41, 0, 82.41, 110, 73.42, 0];

function micMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access was blocked. Allow it in the browser, or open a track.";
  }
  if (name === "NotFoundError") return "No microphone was found. Open a track instead.";
  return "The microphone could not be opened.";
}

export class AudioEngine {
  kind: SourceKind = "idle";
  fileName = "";
  error = "";

  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private freq: Uint8Array<ArrayBuffer> | null = null;
  private time: Uint8Array<ArrayBuffer> | null = null;
  private fileAudio: HTMLAudioElement | null = null;
  private fileNode: MediaElementAudioSourceNode | null = null;
  private fileUrl = "";
  private micStream: MediaStream | null = null;
  private micNode: MediaStreamAudioSourceNode | null = null;
  private sampleStop: (() => void) | null = null;
  private noise: AudioBuffer | null = null;

  async openFile(file: File): Promise<void> {
    const ctx = await this.ensure();
    this.stopMic();
    this.haltSample();
    if (!this.fileAudio || !this.fileNode) {
      const audio = new Audio();
      audio.preload = "auto";
      this.fileAudio = audio;
      this.fileNode = ctx.createMediaElementSource(audio);
      audio.addEventListener("ended", () => {
        if (this.kind === "file") this.error = "";
      });
    }
    if (this.fileUrl) URL.revokeObjectURL(this.fileUrl);
    this.fileUrl = URL.createObjectURL(file);
    this.fileAudio.src = this.fileUrl;
    this.fileName = file.name;
    try {
      this.fileNode.disconnect();
    } catch {
      /* not connected yet */
    }
    this.fileNode.connect(this.analyser!);
    this.routeOutput(true);
    this.kind = "file";
    this.error = "";
    try {
      await this.fileAudio.play();
    } catch {
      this.error = "Press play to start the track.";
    }
  }

  async enableMic(): Promise<void> {
    const ctx = await this.ensure();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      this.error = micMessage(err);
      throw err;
    }
    this.fileAudio?.pause();
    try {
      this.fileNode?.disconnect();
    } catch {
      /* idle */
    }
    this.haltSample();
    this.stopMic();
    this.micStream = stream;
    this.micNode = ctx.createMediaStreamSource(stream);
    this.micNode.connect(this.analyser!);
    this.routeOutput(false);
    this.kind = "mic";
    this.fileName = "";
    this.error = "";
  }

  async playSample(): Promise<void> {
    await this.ensure();
    this.fileAudio?.pause();
    try {
      this.fileNode?.disconnect();
    } catch {
      /* idle */
    }
    this.stopMic();
    this.haltSample();
    this.beginSample();
    this.kind = "sample";
    this.fileName = "Sample loop";
    this.error = "";
  }

  stopMic(): void {
    this.micStream?.getTracks().forEach((track) => track.stop());
    try {
      this.micNode?.disconnect();
    } catch {
      /* already stopped */
    }
    this.micNode = null;
    this.micStream = null;
    if (this.kind === "mic") this.kind = "idle";
  }

  async togglePlay(): Promise<void> {
    if (this.kind === "mic") {
      this.stopMic();
      return;
    }
    if (this.kind === "sample") {
      if (this.sampleStop) this.haltSample();
      else await this.playSample();
      return;
    }
    if (this.kind === "file" && this.fileAudio) {
      if (this.fileAudio.paused) {
        try {
          await this.ensure();
          this.routeOutput(true);
          try {
            this.fileNode?.disconnect();
          } catch {
            /* reconnect below */
          }
          this.fileNode?.connect(this.analyser!);
          await this.fileAudio.play();
          this.error = "";
        } catch {
          this.error = "This browser could not play that file.";
        }
      } else {
        this.fileAudio.pause();
      }
    }
  }

  seek(ratio: number): void {
    const audio = this.fileAudio;
    if (!audio || this.kind !== "file" || !Number.isFinite(audio.duration)) return;
    const next = Math.min(Math.max(ratio, 0), 1) * audio.duration;
    audio.currentTime = next;
  }

  isPlaying(): boolean {
    if (this.kind === "mic") return this.micStream !== null;
    if (this.kind === "sample") return this.sampleStop !== null;
    if (this.kind === "file") return !!this.fileAudio && !this.fileAudio.paused;
    return false;
  }

  getTimes(): { current: number; duration: number } {
    if (this.kind !== "file" || !this.fileAudio) return { current: 0, duration: 0 };
    const duration = Number.isFinite(this.fileAudio.duration) ? this.fileAudio.duration : 0;
    return { current: this.fileAudio.currentTime || 0, duration };
  }

  /** Writes unsmoothed 0..1 bar targets and -1..1 waveform samples. */
  read(bars: Float32Array, count: number, wave: Float32Array, sensitivity: number): boolean {
    if (!this.analyser || !this.freq || !this.time || this.kind === "idle") return false;
    this.analyser.getByteFrequencyData(this.freq);
    this.analyser.getByteTimeDomainData(this.time);
    const freq = this.freq;
    const usable = Math.max(8, Math.floor(freq.length * 0.72));
    const logLow = Math.log(2);
    const logHigh = Math.log(usable);
    for (let i = 0; i < count; i++) {
      const start = Math.exp(logLow + ((logHigh - logLow) * i) / count);
      const end = Math.exp(logLow + ((logHigh - logLow) * (i + 1)) / count);
      let i0 = Math.floor(start);
      let i1 = Math.ceil(end);
      if (i1 <= i0) i1 = i0 + 1;
      if (i0 < 1) i0 = 1;
      if (i1 > usable) i1 = usable;
      let peak = 0;
      for (let j = i0; j < i1; j++) if (freq[j] > peak) peak = freq[j];
      let mag = peak / 255;
      mag = Math.max(0, (mag - 0.035) / 0.965);
      bars[i] = Math.min(1, Math.pow(mag, 0.7) * sensitivity);
    }
    const td = this.time;
    const gain = Math.min(sensitivity, 1.7);
    for (let i = 0; i < wave.length; i++) {
      const idx = Math.min(td.length - 1, Math.floor((i / wave.length) * td.length));
      wave[i] = Math.max(-1, Math.min(1, ((td[idx] - 128) / 128) * gain));
    }
    return true;
  }

  dispose(): void {
    this.stopMic();
    this.haltSample();
    if (this.fileAudio) {
      this.fileAudio.pause();
      this.fileAudio.src = "";
    }
    if (this.fileUrl) URL.revokeObjectURL(this.fileUrl);
    this.fileUrl = "";
    this.kind = "idle";
    void this.ctx?.close();
    this.ctx = null;
    this.analyser = null;
  }

  private async ensure(): Promise<AudioContext> {
    if (!this.ctx || this.ctx.state === "closed") {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.62;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -18;
      this.ctx = ctx;
      this.analyser = analyser;
      this.freq = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      this.time = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      this.fileAudio = null;
      this.fileNode = null;
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    return this.ctx;
  }

  private routeOutput(monitor: boolean): void {
    const analyser = this.analyser;
    const ctx = this.ctx;
    if (!analyser || !ctx) return;
    try {
      analyser.disconnect();
    } catch {
      /* not connected */
    }
    if (monitor) analyser.connect(ctx.destination);
  }

  private haltSample(): void {
    this.sampleStop?.();
    this.sampleStop = null;
    if (this.kind === "sample") {
      /* kind stays sample so pause can resume; caller sets idle when leaving */
    }
  }

  private beginSample(): void {
    const ctx = this.ctx;
    const analyser = this.analyser;
    if (!ctx || !analyser) return;
    const master = ctx.createGain();
    master.gain.value = 0.62;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 10;
    comp.ratio.value = 3;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    master.connect(comp);
    comp.connect(analyser);
    this.routeOutput(true);

    if (!this.noise) {
      const length = ctx.sampleRate;
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buffer;
    }
    const noise = this.noise;

    const padGain = ctx.createGain();
    padGain.gain.value = 0.045;
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = "lowpass";
    padFilter.frequency.value = 900;
    padGain.connect(padFilter);
    padFilter.connect(master);
    const pads: OscillatorNode[] = [];
    for (const freq of [220, 261.63, 329.63]) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;
      osc.connect(padGain);
      osc.start();
      pads.push(osc);
    }

    const stepDur = 60 / 96 / 2;
    let next = ctx.currentTime + 0.06;
    let step = 0;

    const kick = (time: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(170, time);
      osc.frequency.exponentialRampToValueAtTime(46, time + 0.09);
      gain.gain.setValueAtTime(0.9, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.24);
      osc.connect(gain);
      gain.connect(master);
      osc.start(time);
      osc.stop(time + 0.26);
    };

    const hat = (time: number, accent: boolean) => {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const filter = ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = 7000;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(accent ? 0.16 : 0.05, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      src.start(time);
      src.stop(time + 0.05);
    };

    const snare = (time: number) => {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 1800;
      filter.Q.value = 0.7;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.35, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.16);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      src.start(time);
      src.stop(time + 0.18);
      const osc = ctx.createOscillator();
      const og = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = 180;
      og.gain.setValueAtTime(0.2, time);
      og.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
      osc.connect(og);
      og.connect(master);
      osc.start(time);
      osc.stop(time + 0.12);
    };

    const bass = (time: number, freq: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.001, time);
      gain.gain.exponentialRampToValueAtTime(0.42, time + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.28);
      osc.connect(gain);
      gain.connect(master);
      osc.start(time);
      osc.stop(time + 0.3);
    };

    const tick = () => {
      const horizon = ctx.currentTime + 0.28;
      while (next < horizon) {
        const slot = step % 16;
        hat(next, slot % 2 === 1);
        if (slot === 0 || slot === 8 || slot === 11) kick(next);
        if (slot === 4 || slot === 12) snare(next);
        const note = BASS_NOTES[slot];
        if (note) bass(next, note);
        next += stepDur;
        step += 1;
      }
    };
    tick();
    const timer = window.setInterval(tick, 90);
    this.sampleStop = () => {
      window.clearInterval(timer);
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setTargetAtTime(0.0001, now, 0.03);
      for (const osc of pads) {
        try {
          osc.stop(now + 0.08);
        } catch {
          /* already stopped */
        }
      }
      window.setTimeout(() => {
        try {
          master.disconnect();
        } catch {
          /* gone */
        }
      }, 120);
    };
  }
}
