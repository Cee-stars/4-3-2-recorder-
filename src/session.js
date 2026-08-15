/**
 * 4/3/2 セッションの進行役。
 * フェーズ（ラウンド／休憩）を順に回し、残り時間を通知するだけに徹する。
 * 録音や画面の更新は呼び出し側（app.js）が担当する。
 */

import { buildPhases } from './config.js';

export class Session {
  /**
   * @param {object} settings
   * @param {{onPhaseStart:Function,onTick:Function,onPhaseEnd:Function,onFinish:Function}} handlers
   */
  constructor(settings, handlers = {}) {
    this.settings = settings;
    this.phases = buildPhases(settings);
    this.handlers = handlers;
    this.cursor = -1;
    this.endsAt = 0;
    this.startedAt = 0;
    this.timerId = null;
    this.lastTickSecond = -1;
    this.finished = false;
    this._onVisible = () => this._tick();
  }

  get phase() {
    return this.phases[this.cursor] ?? null;
  }

  start() {
    document.addEventListener('visibilitychange', this._onVisible);
    this._next();
  }

  /** 現在のフェーズを早めに終える（「次へ進む」ボタン）。 */
  skip() {
    if (this.finished) return;
    this._endPhase(true);
  }

  /** セッションを中断してタイマーを片付ける。 */
  abort() {
    this.finished = true;
    this._stopTimer();
    document.removeEventListener('visibilitychange', this._onVisible);
  }

  async _next() {
    this.cursor += 1;
    if (this.cursor >= this.phases.length) {
      this.finished = true;
      this._stopTimer();
      document.removeEventListener('visibilitychange', this._onVisible);
      await this.handlers.onFinish?.();
      return;
    }
    const phase = this.phase;
    this.startedAt = Date.now();
    this.endsAt = this.startedAt + phase.ms;
    this.lastTickSecond = -1;
    this.held = false;
    await this.handlers.onPhaseStart?.(phase);
    this._startTimer();
    this._tick();
  }

  _startTimer() {
    this._stopTimer();
    // 絶対時刻から毎回計算するので、タブが眠って間引かれても表示はずれない。
    this.timerId = setInterval(() => this._tick(), 200);
  }

  _stopTimer() {
    if (this.timerId) clearInterval(this.timerId);
    this.timerId = null;
  }

  _tick() {
    if (this.finished || this.held || !this.phase) return;
    const remaining = Math.max(0, this.endsAt - Date.now());
    const second = Math.ceil(remaining / 1000);
    if (second !== this.lastTickSecond) {
      this.lastTickSecond = second;
      this.handlers.onTick?.(remaining, this.phase, second);
    }
    if (remaining > 0) return;

    if (this.phase.hold) {
      // 休憩は時間が来ても勝手に進めず、「次へ進む」を待つ。
      this.held = true;
      this._stopTimer();
      this.handlers.onHold?.(this.phase);
      return;
    }
    this._endPhase(false);
  }

  async _endPhase(skipped) {
    if (this.finished) return;
    this._stopTimer();
    const phase = this.phase;
    const elapsedMs = Math.min(phase.ms, Date.now() - this.startedAt);
    await this.handlers.onPhaseEnd?.(phase, { skipped, elapsedMs });
    this._next();
  }
}

export function formatClock(ms) {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatDuration(ms) {
  const total = Math.round(Math.max(0, ms) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}分${String(s).padStart(2, '0')}秒`;
}
