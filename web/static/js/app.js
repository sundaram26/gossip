/**
 * app.js — glue for the voice workspace (/app/).
 *
 * What this file does:
 *   1. Drives the orb through its state machine (idle → recording → processing → idle).
 *   2. Captures audio with AudioRecorder and hands the resulting Blob to htmx,
 *      which POSTs it as multipart/form-data to the speech endpoint.
 *
 * Conventions worth knowing before editing:
 *   - The API URL lives in the markup (`hx-post="/api/v1/stt"` on #stt-form),
 *     not here. Change the endpoint in the HTML.
 *   - JS and htmx communicate through DOM events only:
 *       JS → htmx : `recording-ready` CustomEvent on <body> (see hx-trigger)
 *       htmx → JS : htmx lifecycle events (`htmx:*`) and server-pushed
 *                   triggers (HX-Trigger header → e.g. `voice:audio`).
 *   - The audio File/Blob is injected into the outgoing request through the
 *     `htmx:configRequest` hook.
 *
 * See ../README.md for the full API contract.
 */

import { AudioRecorder, extensionFor } from './audio-recorder.js';
import { toast } from './toast.js';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const MAX_RECORDING_MS = 120_000; // hard cap so a page can't record forever
const MIN_AUDIO_BYTES = 1_000; // anything smaller is almost certainly silence
const EVENT_RECORDING_READY = 'recording-ready'; // triggers the htmx form

const STATUS_TEXT = {
  idle: 'Tap the microphone to speak',
  recording: 'Listening… tap to send',
  processing: 'Transcribing…',
};

/* ------------------------------------------------------------------ */
/* Element handles                                                     */
/* ------------------------------------------------------------------ */

const els = {
  dock: document.getElementById('voiceDock'),
  orb: document.getElementById('orb'),
  meter: document.getElementById('meter'),
  status: document.getElementById('voiceStatus'),
  form: document.getElementById('stt-form'),
  session: document.getElementById('sessionId'),
  connPill: document.getElementById('connPill'),
};

/* ------------------------------------------------------------------ */
/* UI state machine                                                    */
/* ------------------------------------------------------------------ */

let state = 'idle';
let busy = false; // guards rapid orb clicks while awaiting the mic
let pendingAudio = null; // { blob, mime } awaiting the htmx request
let maxTimer = null;
let currentPlaybackAudio = null;

function stopPlayback() {
  if (currentPlaybackAudio) {
    currentPlaybackAudio.pause();
    currentPlaybackAudio.currentTime = 0;
    currentPlaybackAudio = null;
  }
}

/** @param {'idle' | 'recording' | 'processing'} next */
function setState(next) {
  state = next;
  els.dock.dataset.state = next;
  els.status.textContent = STATUS_TEXT[next];

  const recording = next === 'recording';
  const processing = next === 'processing';

  if (recording) {
    els.orb.setAttribute('aria-label', 'Stop and send');
    els.orb.setAttribute('aria-pressed', 'true');
    els.orb.removeAttribute('aria-busy');
    els.orb.disabled = false;
  } else if (processing) {
    els.orb.setAttribute('aria-label', 'Transcribing audio…');
    els.orb.setAttribute('aria-pressed', 'false');
    els.orb.setAttribute('aria-busy', 'true');
    els.orb.disabled = true;
  } else {
    els.orb.setAttribute('aria-label', 'Start recording');
    els.orb.setAttribute('aria-pressed', 'false');
    els.orb.removeAttribute('aria-busy');
    els.orb.disabled = !AudioRecorder.isSupported();
  }
}

/* ------------------------------------------------------------------ */
/* Recording flow                                                      */
/* ------------------------------------------------------------------ */

const recorder = new AudioRecorder();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

async function beginRecording() {
  if (busy || state !== 'idle') return;
  stopPlayback();
  busy = true;
  try {
    await recorder.start();
  } catch (error) {
    toast(describeMicError(error), { type: 'error' });
    return;
  } finally {
    busy = false;
  }
  setState('recording');
  startMeter();
  maxTimer = window.setTimeout(() => void finishRecording(), MAX_RECORDING_MS);
}

async function finishRecording() {
  window.clearTimeout(maxTimer);
  stopMeter();
  setState('processing');

  const result = await recorder.stop();
  if (!result || result.blob.size < MIN_AUDIO_BYTES) {
    setState('idle');
    toast('That was too short to hear anything — try again.');
    return;
  }

  pendingAudio = result;
  // Hand off to htmx: the #stt-form form listens for this event on <body>.
  document.body.dispatchEvent(
    new CustomEvent(EVENT_RECORDING_READY, { bubbles: true }),
  );
}

async function cancelRecording() {
  if (state !== 'recording') return;
  window.clearTimeout(maxTimer);
  stopMeter();
  await recorder.stop();
  pendingAudio = null;
  setState('idle');
  toast('Recording cancelled.');
}

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state === 'recording') {
    event.preventDefault();
    void cancelRecording();
  }
});

function describeMicError(error) {
  switch (error?.name) {
    case 'NotAllowedError':
      return 'Microphone access was denied — allow it in your browser settings to talk.';
    case 'NotFoundError':
      return 'No microphone found on this device.';
    case 'NotReadableError':
      return 'The microphone is busy in another app.';
    case 'SecurityError':
      return 'Voice capture needs a secure origin (localhost or HTTPS).';
    default:
      return 'Could not start the microphone.';
  }
}

els.orb.addEventListener('click', () => {
  if (busy || state === 'processing') return;
  if (state === 'idle') void beginRecording();
  else if (state === 'recording') void finishRecording();
});

/* ------------------------------------------------------------------ */
/* Level meter (cosmetic; skipped for reduced-motion users)            */
/* ------------------------------------------------------------------ */

let meterRaf = null;

function startMeter() {
  if (reducedMotion) return;
  const tick = () => {
    if (state !== 'recording') {
      meterRaf = null;
      return;
    }
    els.meter.style.setProperty('--level', recorder.level.toFixed(3));
    meterRaf = requestAnimationFrame(tick);
  };
  meterRaf = requestAnimationFrame(tick);
}

function stopMeter() {
  if (meterRaf) cancelAnimationFrame(meterRaf);
  meterRaf = null;
  els.meter?.style.setProperty('--level', '0');
}

/* ------------------------------------------------------------------ */
/* htmx integration                                                    */
/* ------------------------------------------------------------------ */

/* Attach the captured audio to the outgoing multipart request. */
document.addEventListener('htmx:configRequest', (event) => {
  if (event.target !== els.form || !pendingAudio) return;

  const ext = extensionFor(pendingAudio.mime);
  const filename = `take-${Date.now()}.${ext}`;

  let file;
  try {
    file = new File([pendingAudio.blob], filename, {
      type: pendingAudio.mime || 'audio/webm',
    });
  } catch {
    file = pendingAudio.blob;
  }

  // HTMX 2 parameters is a Proxy around the underlying FormData
  if (event.detail?.parameters) {
    event.detail.parameters.audio = file;
  }
  if (event.detail?.formData) {
    event.detail.formData.set('audio', file, filename);
  }

  // Request timeout safeguard (30 seconds)
  if (event.detail && !event.detail.timeout) {
    event.detail.timeout = 30_000;
  }
});

/* Guard: never fire an empty request. */
els.form.addEventListener('htmx:beforeRequest', (event) => {
  if (!pendingAudio) {
    event.preventDefault();
    setState('idle');
  }
});

els.form.addEventListener('htmx:afterRequest', (event) => {
  pendingAudio = null;
  setState('idle');
  if (event.detail.successful) {
    setServiceHealth(true);
  } else {
    setServiceHealth(false);
    toast(describeHttpError(event), { type: 'error' });
  }
});

els.form.addEventListener('htmx:sendError', () => {
  pendingAudio = null;
  setState('idle');
  setServiceHealth(false);
  toast('The speech API is unreachable — is the backend running?', { type: 'error' });
});

els.form.addEventListener('htmx:timeout', () => {
  pendingAudio = null;
  setState('idle');
  setServiceHealth(false);
  toast('Request timed out while waiting for the speech service.', { type: 'error' });
});

/* Smooth auto-scroll when new messages are added to the conversation */
document.body.addEventListener('htmx:afterSwap', (event) => {
  const target = event.detail?.target;
  if (target?.id === 'conversation' || target?.closest?.('#conversation')) {
    const conversation = document.getElementById('conversation');
    if (conversation) {
      conversation.scrollTo({
        top: conversation.scrollHeight,
        behavior: reducedMotion ? 'auto' : 'smooth',
      });
    }
  }
});

function describeHttpError(event) {
  const status = event.detail?.xhr?.status ?? 0;
  if (status === 0) return 'The speech API is unreachable — is the backend running?';
  if (status === 404) return 'The speech endpoint was not found (the API is not implemented yet?).';
  if (status >= 500) return `The speech service failed (HTTP ${status}).`;
  return `The speech API rejected the request (HTTP ${status}).`;
}

/** Reflect the last request outcome in the header pill. */
function setServiceHealth(ok) {
  if (!els.connPill) return;
  els.connPill.dataset.tone = ok ? '' : 'warn';
  const label = els.connPill.querySelector('[data-label]');
  if (label) label.textContent = ok ? 'service ready' : 'service unreachable';
}

/*
 * Server push: the API can return
 *   HX-Trigger: {"voice:audio": {"url": "/api/v1/audio/<id>.wav"}}
 * to have the client play the spoken reply once this becomes voice-to-voice.
 */
document.body.addEventListener('voice:audio', (event) => {
  const url = event.detail?.url;
  if (!url) return;
  stopPlayback();
  currentPlaybackAudio = new Audio(url);
  currentPlaybackAudio.play().catch(() => {
    toast('Audio playback was blocked — tap anywhere on the page, then try again.');
  });
});

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

function init() {
  // One opaque session id per page load; lets the API thread conversations.
  els.session.value =
    globalThis.crypto?.randomUUID?.() ?? `s-${Date.now()}`;

  if (!AudioRecorder.isSupported()) {
    els.orb.disabled = true;
    els.status.textContent = 'Voice capture is not supported in this browser.';
  }
}

init();
