/**
 * audio-recorder.js — thin promise-based wrapper around
 * getUserMedia + MediaRecorder.
 *
 * Deliberately free of any DOM / htmx knowledge so it can be reused
 * (pages, tests, a future WebSocket streaming client, ...). Callers
 * drive it with `start()` / `stop()` and may poll `level` (0..1)
 * to animate a UI meter.
 */

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
];

/** Pick the best container/codec this browser can record. */
function pickMimeType() {
  if (!window.MediaRecorder?.isTypeSupported) return '';
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

/** Map a mime type to a sane file extension for multipart filenames. */
export function extensionFor(mime) {
  if (!mime || typeof mime !== 'string') return 'webm';
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('wav')) return 'wav';
  return 'webm';
}

export class AudioRecorder {
  #stream = null;
  #recorder = null;
  #mime = '';
  #chunks = [];
  #audioCtx = null;
  #analyser = null;
  #levelData = null;

  static isSupported() {
    return Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  }

  /**
   * Current microphone input level in the range 0..1.
   * Returns 0 when not recording or when metering is unavailable.
   */
  get level() {
    if (!this.#analyser || !this.#levelData) return 0;
    this.#analyser.getByteTimeDomainData(this.#levelData);
    let peak = 0;
    for (let i = 0; i < this.#levelData.length; i++) {
      const v = Math.abs(this.#levelData[i] - 128) / 128;
      if (v > peak) peak = v;
    }
    // soft compression so quiet speech still animates the meter
    return Math.min(1, peak * 2.2);
  }

  /**
   * Start capturing. Resolves once the recorder is running.
   * Rejects with the underlying getUserMedia error (callers should
   * map `error.name` to a friendly message).
   */
  async start() {
    this.#stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    try {
      this.#mime = pickMimeType();
      this.#recorder = new MediaRecorder(
        this.#stream,
        this.#mime ? { mimeType: this.#mime } : undefined,
      );
      if (this.#recorder.mimeType) {
        this.#mime = this.#recorder.mimeType;
      }
      this.#chunks = [];

      this.#recorder.addEventListener('dataavailable', (event) => {
        if (event.data?.size) this.#chunks.push(event.data);
      });

      this.#setupMeter();

      try {
        this.#recorder.start(250); // chunk periodically so a long take loses little
      } catch {
        this.#recorder.start();
      }
    } catch (err) {
      this.#teardown();
      throw err;
    }
  }

  /**
   * Stop capturing.
   * @returns {Promise<{ blob: Blob, mime: string } | null>}
   *   The assembled take, or null when nothing was captured.
   */
  stop() {
    return new Promise((resolve) => {
      const recorder = this.#recorder;
      if (!recorder || recorder.state === 'inactive') {
        this.#teardown();
        resolve(null);
        return;
      }

      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(fallbackTimer);
        const resolvedMime = this.#mime || recorder.mimeType || 'audio/webm';
        const blob = this.#chunks.length
          ? new Blob(this.#chunks, { type: resolvedMime })
          : null;
        const result = blob ? { blob, mime: resolvedMime } : null;
        this.#teardown();
        resolve(result);
      };

      // Fallback timer in case the stop event fails to fire
      const fallbackTimer = setTimeout(finish, 3000);
      recorder.addEventListener('stop', finish, { once: true });

      try {
        recorder.stop();
      } catch {
        finish();
      }
    });
  }

  /** Best-effort level meter. Never routed to speakers. */
  #setupMeter() {
    try {
      const Ctx = window.AudioContext ?? window.webkitAudioContext;
      if (!Ctx || !this.#stream) return;
      this.#audioCtx = new Ctx();
      if (this.#audioCtx.state === 'suspended') {
        this.#audioCtx.resume().catch(() => {});
      }
      const source = this.#audioCtx.createMediaStreamSource(this.#stream);
      this.#analyser = this.#audioCtx.createAnalyser();
      this.#analyser.fftSize = 256;
      source.connect(this.#analyser);
      this.#levelData = new Uint8Array(this.#analyser.fftSize);
    } catch {
      this.#analyser = null; // metering is optional
    }
  }

  #teardown() {
    this.#stream?.getTracks().forEach((track) => track.stop());
    this.#audioCtx?.close().catch(() => {});
    this.#stream = null;
    this.#recorder = null;
    this.#analyser = null;
    this.#audioCtx = null;
    this.#chunks = [];
  }
}
