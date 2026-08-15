/**
 * マイクの取得・ラウンドごとの録音・入力レベル・合図の音。
 */

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',           // iOS / Safari
  'audio/mpeg',
  'audio/ogg;codecs=opus',
];

export function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const type of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported?.(type)) return type;
  }
  return '';
}

export function isRecordingSupported() {
  return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

export function extensionFor(mime = '') {
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('mpeg')) return 'mp3';
  if (mime.includes('ogg')) return 'ogg';
  return 'audio';
}

export class Mic {
  constructor() {
    this.stream = null;
    this.ctx = null;
    this.analyser = null;
    this.recorder = null;
    this.chunks = [];
    this.startedAt = 0;
    this.mime = '';
  }

  get active() {
    return !!this.stream?.getAudioTracks().some(t => t.readyState === 'live');
  }

  /** マイクを 1 回だけ取得してセッション中は使い回す（許可ダイアログを 1 回に抑える）。 */
  async open() {
    if (this.active) return this.stream;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this._setupMeter();
    return this.stream;
  }

  _setupMeter() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = this.ctx || new Ctx();
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.75;
    source.connect(this.analyser);
    this._buf = new Uint8Array(this.analyser.fftSize);
  }

  /** 0〜1 のおおよその入力レベル。 */
  level() {
    if (!this.analyser) return 0;
    this.analyser.getByteTimeDomainData(this._buf);
    let peak = 0;
    for (let i = 0; i < this._buf.length; i++) {
      peak = Math.max(peak, Math.abs(this._buf[i] - 128) / 128);
    }
    return Math.min(1, peak * 1.7);
  }

  startRound() {
    if (!this.stream) throw new Error('mic not open');
    this.mime = pickMimeType();
    this.chunks = [];
    const options = this.mime ? { mimeType: this.mime } : undefined;
    this.recorder = new MediaRecorder(this.stream, options);
    this.recorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(1000);
    this.startedAt = performance.now();
  }

  /** 録音を止めて {blob, mime, durationMs} を返す。録音していなければ null。 */
  stopRound() {
    const rec = this.recorder;
    if (!rec || rec.state === 'inactive') {
      this.recorder = null;
      return Promise.resolve(null);
    }
    return new Promise(resolve => {
      rec.onstop = () => {
        const mime = this.mime || rec.mimeType || 'audio/webm';
        const blob = new Blob(this.chunks, { type: mime });
        const durationMs = Math.round(performance.now() - this.startedAt);
        this.recorder = null;
        this.chunks = [];
        resolve(blob.size > 0 ? { blob, mime, durationMs } : null);
      };
      try {
        rec.stop();
      } catch {
        this.recorder = null;
        resolve(null);
      }
    });
  }

  close() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.analyser = null;
    this.recorder = null;
    this.chunks = [];
  }
}

/** 合図の音。録音に被らないよう短く控えめに鳴らす。 */
export class Chime {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  /** ユーザー操作の中で呼んで AudioContext を起こす（iOS 対策）。 */
  async unlock() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = this.ctx || new Ctx();
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch { /* 無音でも進行は止めない */ }
    }
  }

  _tone(freq, startOffset, duration, gain = 0.12) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + startOffset;
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(amp).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  tick() {
    if (!this.enabled) return;
    this._tone(880, 0, 0.08, 0.06);
  }

  roundEnd() {
    if (!this.enabled) return;
    this._tone(660, 0, 0.28);
    this._tone(990, 0.18, 0.4);
  }

  sessionEnd() {
    if (!this.enabled) return;
    this._tone(523.25, 0, 0.3);
    this._tone(659.25, 0.16, 0.3);
    this._tone(783.99, 0.32, 0.6);
  }
}
