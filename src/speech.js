/**
 * 端末の音声認識による文字起こし（任意・ベータ）。
 * 対応していない端末では静かに無効になる。
 */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export function isSpeechSupported() {
  return !!SR;
}

export class Transcriber {
  constructor(lang = 'en-US') {
    this.lang = lang;
    this.recognition = null;
    this.finalText = '';
    this.interim = '';
    this.running = false;
    this.onUpdate = null;
  }

  start() {
    if (!SR) return false;
    this.finalText = '';
    this.interim = '';
    this.running = true;
    this._spawn();
    return true;
  }

  _spawn() {
    const rec = new SR();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = event => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) {
          this.finalText += (this.finalText ? ' ' : '') + text.trim();
        } else {
          interim += text;
        }
      }
      this.interim = interim.trim();
      this.onUpdate?.(this.finalText, this.interim);
    };

    // 認識エンジンは無音などで勝手に終わるので、ラウンド中は繋ぎ直す。
    rec.onend = () => {
      if (!this.running) return;
      setTimeout(() => { if (this.running) this._spawn(); }, 250);
    };

    rec.onerror = event => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.running = false;
      }
    };

    try {
      rec.start();
      this.recognition = rec;
    } catch {
      // 直前のインスタンスがまだ終了していない場合など。少し待って再試行。
      setTimeout(() => { if (this.running) this._spawn(); }, 400);
    }
  }

  /** 認識を止めて確定テキストを返す。 */
  stop() {
    this.running = false;
    try { this.recognition?.stop(); } catch { /* noop */ }
    this.recognition = null;
    const text = [this.finalText, this.interim].filter(Boolean).join(' ').trim();
    this.finalText = '';
    this.interim = '';
    return text;
  }
}

/** ざっくりの語数。日本語は文字数から概算する。 */
export function countWords(text = '') {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const latin = trimmed.match(/[A-Za-z0-9''’-]+/g)?.length ?? 0;
  const cjk = trimmed.match(/[぀-ヿ一-鿿]/g)?.length ?? 0;
  return latin + Math.round(cjk / 2);
}
