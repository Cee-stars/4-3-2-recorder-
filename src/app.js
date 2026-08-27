/**
 * 画面まわりの配線。
 * 準備 → セッション（4分/休憩/3分/休憩/2分）→ 結果 → 履歴。
 */

import {
  MAX_MEMO_WORDS, TOPIC_SUGGESTIONS, DEFAULT_SETTINGS,
  buildPhases, loadSettings, saveSettings, clamp,
} from './config.js';
import { Session, formatClock, formatDuration } from './session.js';
import { Mic, Chime, isRecordingSupported, extensionFor } from './audio.js';
import { Transcriber, isSpeechSupported, countWords } from './speech.js';
import {
  putSession, getSession, deleteSession, clearSessions, listSessions, estimateUsage,
} from './storage.js';
import { exportSessions, importFile, fileNameFor, download, formatSize } from './transfer.js';

const $ = sel => document.querySelector(sel);
const RING_LENGTH = 2 * Math.PI * 92;

const state = {
  settings: loadSettings(),
  memo: [],
  gaps: [],
  session: null,      // 進行中の Session
  record: null,       // 保存用のセッション記録
  viewing: null,      // 結果画面に出しているセッション
  urls: [],           // 後始末する Object URL
  wakeLock: null,
  levelRaf: 0,
};

const mic = new Mic();
const chime = new Chime();
let transcriber = null;

/* ---------------- 画面の高さ ---------------- */

/**
 * iOS Safari では position:fixed の高さがツールバーの出入りに追従せず、
 * スタートボタンの下に余白が残ることがある。
 * 実際に見えている高さを測って CSS に渡す。
 */
let viewportRaf = 0;
function syncViewportHeight() {
  // スクロール中に何度も呼ばれるため、1 フレームに 1 回だけ反映する。
  if (viewportRaf) return;
  viewportRaf = requestAnimationFrame(() => {
    viewportRaf = 0;
    const height = window.visualViewport?.height ?? window.innerHeight;
    if (height > 0) {
      document.documentElement.style.setProperty('--app-height', `${Math.round(height)}px`);
    }
  });
}

function watchViewportHeight() {
  syncViewportHeight();
  window.addEventListener('resize', syncViewportHeight);
  window.addEventListener('orientationchange', () => setTimeout(syncViewportHeight, 200));
  window.visualViewport?.addEventListener('resize', syncViewportHeight);
  // ツールバーの出入りはスクロール中に起きるので、その間も合わせ続ける。
  window.visualViewport?.addEventListener('scroll', syncViewportHeight);
  window.addEventListener('pageshow', syncViewportHeight);
}

/* ---------------- 画面切り替え ---------------- */

function show(id) {
  document.querySelectorAll('.screen').forEach(el => el.classList.toggle('is-active', el.id === id));
  document.querySelector(`#${id} .scroll`)?.scrollTo(0, 0);
}

let toastTimer = 0;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

function releaseUrls() {
  state.urls.forEach(URL.revokeObjectURL);
  state.urls = [];
}

function objectUrl(blob) {
  const url = URL.createObjectURL(blob);
  state.urls.push(url);
  return url;
}

/* ---------------- 準備画面 ---------------- */

function renderTopicSuggestions() {
  const box = $('#topic-suggestions');
  box.innerHTML = '';
  TOPIC_SUGGESTIONS.forEach(topic => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = topic;
    chip.addEventListener('click', () => { $('#input-topic').value = topic; });
    box.appendChild(chip);
  });
}

function renderMemo() {
  const box = $('#memo-list');
  box.innerHTML = '';
  state.memo.forEach((word, i) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.innerHTML = `<span></span><span class="x">×</span>`;
    chip.firstElementChild.textContent = word;
    chip.title = '削除';
    chip.addEventListener('click', () => {
      state.memo.splice(i, 1);
      renderMemo();
    });
    box.appendChild(chip);
  });
  $('#memo-count').textContent = String(state.memo.length);
  $('#input-memo').disabled = state.memo.length >= MAX_MEMO_WORDS;
  $('#btn-add-memo').disabled = state.memo.length >= MAX_MEMO_WORDS;
}

function renderPlan() {
  const list = $('#plan-preview');
  list.innerHTML = '';
  buildPhases(state.settings).forEach(phase => {
    const li = document.createElement('li');
    if (phase.type === 'break') li.classList.add('is-break');
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = phase.label;
    const d = document.createElement('span');
    d.className = 'd';
    d.textContent = phase.cue;
    li.append(t, d);
    list.appendChild(li);
  });
}

function renderChips(container, words) {
  container.innerHTML = '';
  words.forEach(word => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = word;
    container.appendChild(chip);
  });
}

function addMemoWord() {
  const input = $('#input-memo');
  const word = input.value.trim();
  if (!word) return;
  if (state.memo.length >= MAX_MEMO_WORDS) {
    toast(`メモは ${MAX_MEMO_WORDS} 単語までです`);
    return;
  }
  state.memo.push(word);
  input.value = '';
  renderMemo();
}

function checkEnvironment() {
  const note = $('#mic-note');
  const problems = [];
  if (!window.isSecureContext) {
    problems.push('このページは https（または localhost）で開かないとマイクを使えません。');
  }
  if (!isRecordingSupported()) {
    problems.push('このブラウザは録音に対応していません。タイマーとしては使えます。');
  }
  if (!isSpeechSupported()) {
    $('#toggle-transcribe').checked = false;
    $('#toggle-transcribe').disabled = true;
    state.settings.transcribe = false;
    $('#toggle-transcribe').closest('.switch').querySelector('small').textContent =
      'この端末は音声認識に対応していません。録音だけ行います。';
  }
  note.hidden = problems.length === 0;
  note.textContent = problems.join(' ');
}

/* ---------------- 画面の見た目（セッション中） ---------------- */

function setRing(fraction) {
  $('#ring-bar').style.strokeDashoffset = String(RING_LENGTH * (1 - clamp(fraction, 0, 1)));
}

function stopLevelMeter() {
  cancelAnimationFrame(state.levelRaf);
  state.levelRaf = 0;
  $('#level-bar').style.width = '0%';
}

function startLevelMeter() {
  const bar = $('#level-bar');
  const loop = () => {
    bar.style.width = `${Math.round(mic.level() * 100)}%`;
    state.levelRaf = requestAnimationFrame(loop);
  };
  stopLevelMeter();
  state.levelRaf = requestAnimationFrame(loop);
}

let breatheTimer = 0;
function startBreathing() {
  // 8 秒周期のアニメーションに合わせて 4 秒ごとに文字を切り替える。
  const el = $('#breathe-text');
  let inhale = true;
  el.textContent = '吸って';
  clearInterval(breatheTimer);
  breatheTimer = setInterval(() => {
    inhale = !inhale;
    el.textContent = inhale ? '吸って' : '吐いて';
  }, 4000);
}

function stopBreathing() {
  clearInterval(breatheTimer);
  breatheTimer = 0;
}

function renderGapList(target, words, { editable }) {
  target.innerHTML = '';
  words.forEach((word, i) => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.className = 'word';
    span.textContent = word;
    const link = document.createElement('a');
    link.href = `https://www.google.com/search?q=${encodeURIComponent(`${word} 意味 英語`)}`;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = '調べる';
    li.append(span, link);
    if (editable) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'del';
      del.textContent = '×';
      del.setAttribute('aria-label', `${word} を削除`);
      del.addEventListener('click', () => {
        state.gaps.splice(i, 1);
        renderGapList(target, state.gaps, { editable: true });
      });
      li.appendChild(del);
    }
    target.appendChild(li);
  });
}

/* ---------------- セッション ---------------- */

async function requestWakeLock() {
  if (!navigator.wakeLock) return;
  try {
    state.wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* 取れなくても進行に支障はない */ }
}

function releaseWakeLock() {
  state.wakeLock?.release().catch(() => {});
  state.wakeLock = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.session && !state.session.finished) {
    requestWakeLock();
  }
});

async function startSession() {
  const topic = $('#input-topic').value.trim();
  if (!topic) {
    toast('まず話題を一つ決めましょう');
    $('#input-topic').focus();
    return;
  }

  await chime.unlock();

  if (isRecordingSupported()) {
    try {
      await mic.open();
    } catch (err) {
      const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
      toast(denied ? 'マイクが使えないので録音なしで進めます' : '録音を開始できませんでした');
    }
  }

  state.gaps = [];
  state.record = {
    id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Date.now(),
    topic,
    memo: [...state.memo],
    rounds: [],
    gaps: [],
    settings: {
      roundMinutes: [...state.settings.roundMinutes],
      breakMinutes: state.settings.breakMinutes,
    },
  };

  chime.enabled = state.settings.sound;
  renderChips($('#session-memo'), state.memo);
  renderGapList($('#gap-list'), state.gaps, { editable: true });
  $('#live-transcript').innerHTML = '';

  state.session = new Session(state.settings, {
    onPhaseStart: enterPhase,
    onTick: tickPhase,
    onHold: holdPhase,
    onPhaseEnd: leavePhase,
    onFinish: finishSession,
  });

  requestWakeLock();
  show('screen-session');
  state.session.start();
}

async function enterPhase(phase) {
  const stage = $('#stage');
  stage.classList.remove('is-final');
  $('#phase-badge').textContent = phase.label;
  $('#cue').textContent = phase.cue;
  setRing(1);
  $('#clock').textContent = formatClock(phase.ms);
  $('#btn-skip').textContent = phase.type === 'round' ? 'このラウンドを終える' : '次のラウンドへ';

  const isRound = phase.type === 'round';
  const isSilentBreak = phase.type === 'break' && phase.index === 1;

  $('#break-notes').hidden = !(phase.type === 'break' && phase.index === 0);
  $('#break-breathe').hidden = !isSilentBreak;
  if (isSilentBreak) startBreathing(); else stopBreathing();
  // 2 回目の休憩は「何も見ない」ので、メモも指示も伏せる。
  $('#session-memo').hidden = !isRound;
  $('#cue').hidden = isSilentBreak;
  $('#level-wrap').hidden = !isRound;

  const wantsTranscript = isRound && state.settings.transcribe && isSpeechSupported();
  $('#live-transcript').hidden = !wantsTranscript;
  if (wantsTranscript) $('#live-transcript').innerHTML = '';

  if (!isRound) {
    $('#rec-indicator').classList.remove('is-on');
    stopLevelMeter();
    return;
  }

  // 着信などでマイクを取り上げられていることがあるので、ラウンドのたびに確かめて
  // 必要なら取り直す。2・3 ラウンド目が無音で終わるのを防ぐ。
  if (!mic.active && isRecordingSupported()) {
    try {
      await mic.open();
    } catch { /* 取れなければ録音なしで続ける */ }
  }

  if (mic.active) {
    try {
      mic.startRound();
      $('#rec-indicator').classList.add('is-on');
      startLevelMeter();
    } catch {
      toast('このラウンドは録音できませんでした');
    }
  } else {
    toast('マイクが使えないため、このラウンドは録音しません');
  }

  if (wantsTranscript) {
    transcriber = new Transcriber(state.settings.lang);
    transcriber.onUpdate = (final, interim) => {
      const box = $('#live-transcript');
      box.innerHTML = '';
      box.append(document.createTextNode(final ? `${final} ` : ''));
      const span = document.createElement('span');
      span.className = 'interim';
      span.textContent = interim;
      box.appendChild(span);
      box.scrollTop = box.scrollHeight;
    };
    transcriber.start();
  }
}

function tickPhase(remaining, phase, second) {
  $('#clock').textContent = formatClock(remaining);
  setRing(remaining / phase.ms);
  if (second <= 10 && second > 0) {
    $('#stage').classList.add('is-final');
    if (phase.type === 'round') chime.tick();
  }
}

function holdPhase() {
  $('#clock').textContent = '0:00';
  $('#phase-badge').textContent = '準備ができたら次へ';
  chime.roundEnd();
}

async function leavePhase(phase, { elapsedMs }) {
  if (phase.type === 'break') {
    if (phase.index === 0) state.record.gaps = [...state.gaps];
    return;
  }

  stopLevelMeter();
  $('#rec-indicator').classList.remove('is-on');

  const transcript = transcriber ? transcriber.stop() : '';
  transcriber = null;

  const recording = await mic.stopRound();
  const durationMs = recording?.durationMs ?? elapsedMs;

  state.record.rounds.push({
    index: phase.index,
    plannedMs: phase.ms,
    durationMs,
    blob: recording?.blob ?? null,
    mime: recording?.mime ?? '',
    transcript,
    words: countWords(transcript),
  });

  // iOS はバックグラウンドのページを容赦なく捨てる。12 分のセッションの
  // 途中で落ちても録音が残るよう、ラウンドが終わるたびに保存しておく。
  await saveProgress();

  const isLast = phase.index === state.settings.roundMinutes.length - 1;
  if (isLast) chime.sessionEnd(); else chime.roundEnd();
}

/** 途中経過を保存する。最後まで終わったものと区別できるよう partial を立てる。 */
async function saveProgress() {
  if (!state.record) return;
  try {
    await putSession({ ...state.record, gaps: [...state.gaps], partial: true });
  } catch {
    toast('保存できませんでした（空き容量を確認してください）');
  }
}

async function finishSession() {
  stopBreathing();
  releaseWakeLock();
  mic.close();
  state.session = null;
  state.record.gaps = [...state.gaps];
  state.record.partial = false;

  try {
    await putSession(state.record);
  } catch {
    toast('保存できませんでした（空き容量を確認してください）');
  }
  renderResult(state.record);
  show('screen-result');
}

function abortSession() {
  if (!state.session) return;
  if (!confirm('セッションを中断しますか？ここまでの録音は保存されません。')) return;
  state.session.abort();
  state.session = null;
  stopBreathing();
  if (state.record) deleteSession(state.record.id).catch(() => {});
  state.record = null;
  transcriber?.stop();
  transcriber = null;
  stopLevelMeter();
  $('#rec-indicator').classList.remove('is-on');
  mic.stopRound().finally(() => mic.close());
  releaseWakeLock();
  show('screen-setup');
}

/* ---------------- 結果画面 ---------------- */

function renderResult(record) {
  releaseUrls();
  state.viewing = record;

  $('#result-title').textContent = record.id === state.record?.id ? 'お疲れさま' : '記録';
  $('#result-topic').textContent = record.topic;
  $('#result-date').textContent = new Date(record.createdAt).toLocaleString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  renderChips($('#result-memo'), record.memo || []);

  // スピード比較（文字起こしがあるときだけ）
  const withWords = (record.rounds || []).filter(r => r.words > 0);
  const speedCard = $('#result-speed-card');
  speedCard.hidden = withWords.length < 2;
  if (!speedCard.hidden) {
    const wpms = record.rounds.map(r => (r.durationMs > 0 ? (r.words / (r.durationMs / 60_000)) : 0));
    const max = Math.max(...wpms, 1);
    const bars = $('#result-bars');
    bars.innerHTML = '';
    wpms.forEach((wpm, i) => {
      const row = document.createElement('div');
      row.className = 'bar-row';
      row.innerHTML = `<span class="lbl"></span><span class="track"><span class="fill"></span></span><span class="val"></span>`;
      row.querySelector('.lbl').textContent = `R${i + 1}`;
      row.querySelector('.fill').style.width = `${Math.round((wpm / max) * 100)}%`;
      row.querySelector('.val').textContent = `${Math.round(wpm)} wpm`;
      bars.appendChild(row);
    });
    const first = wpms[0];
    const last = wpms.at(-1);
    $('#result-speed-note').textContent = first > 0 && last > 0
      ? (last >= first
        ? `1 → 3 ラウンドで ${Math.round(((last / first) - 1) * 100)}% 速くなりました。`
        : '同じ内容をゆっくり整理できたラウンドでした。次は少し速く。')
      : '';
  }

  // 各ラウンド
  const box = $('#result-rounds');
  box.innerHTML = '';
  (record.rounds || []).forEach(round => {
    const card = document.createElement('div');
    card.className = 'card round-card';

    const head = document.createElement('div');
    head.className = 'round-head';
    const title = document.createElement('h3');
    title.textContent = `${round.index + 1}ラウンド目`;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = [
      formatDuration(round.durationMs),
      round.words ? `${round.words} words` : '',
    ].filter(Boolean).join(' ・ ');
    head.append(title, meta);
    card.appendChild(head);

    if (round.blob) {
      const url = objectUrl(round.blob);
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.preload = 'metadata';
      audio.src = url;
      card.appendChild(audio);

      const row = document.createElement('div');
      row.className = 'row';
      const dl = document.createElement('a');
      dl.className = 'btn btn-ghost';
      dl.style.textAlign = 'center';
      dl.style.textDecoration = 'none';
      dl.href = url;
      dl.download = `432_${new Date(record.createdAt).toISOString().slice(0, 10)}_R${round.index + 1}.${extensionFor(round.mime)}`;
      dl.textContent = '音声を保存';
      row.appendChild(dl);
      card.appendChild(row);
    } else {
      const p = document.createElement('p');
      p.className = 'hint';
      p.style.margin = '0';
      p.textContent = '録音なし（タイマーのみ）';
      card.appendChild(p);
    }

    if (round.transcript) {
      const t = document.createElement('div');
      t.className = 'transcript';
      t.textContent = round.transcript;
      card.appendChild(t);
    }

    box.appendChild(card);
  });

  const gaps = record.gaps || [];
  $('#result-gap-card').hidden = gaps.length === 0;
  if (gaps.length) renderGapList($('#result-gaps'), gaps, { editable: false });
}

/* ---------------- 書き出し・読み込み ---------------- */

async function exportRecords(records, emptyMessage) {
  if (!records.length) {
    toast(emptyMessage);
    return;
  }
  toast('書き出しています…');
  try {
    const blob = await exportSessions(records);
    download(blob, fileNameFor(records));
    toast(`${records.length} 件を書き出しました（${formatSize(blob.size)}）`);
  } catch {
    toast('書き出せませんでした');
  }
}

async function exportAll() {
  const records = await listSessions();
  await exportRecords(records, '書き出せる記録がありません');
}

/** ファイル選択を開き、読み込んだセッションを履歴に足す。 */
function openImportDialog() {
  const input = $('#import-file');
  input.value = '';
  input.click();
}

async function handleImportFile(file) {
  if (!file) return;
  toast('読み込んでいます…');
  let sessions;
  try {
    sessions = await importFile(file);
  } catch (err) {
    toast(err.message || '読み込めませんでした');
    return;
  }

  let added = 0;
  for (const session of sessions) {
    // 同じ id が既にある場合は上書きせず、別の記録として残す。
    const existing = await getSession(session.id).catch(() => null);
    if (existing) session.id = `${session.id}_i${Date.now().toString(36)}${added}`;
    try {
      await putSession(session);
      added += 1;
    } catch {
      toast('保存できませんでした（空き容量を確認してください）');
      break;
    }
  }

  if (added) {
    toast(`${added} 件を読み込みました`);
    show('screen-history');
    await renderHistory();
  }
}

/* ---------------- 履歴 ---------------- */

async function renderHistory() {
  const box = $('#history-list');
  box.innerHTML = '';
  let sessions = [];
  try {
    sessions = await listSessions();
  } catch {
    box.innerHTML = '<p class="empty">履歴を読み込めませんでした。</p>';
    return;
  }
  if (!sessions.length) {
    box.innerHTML = '<p class="empty">まだ記録がありません。<br>1 回やってみましょう。</p>';
    return;
  }
  sessions.forEach(record => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'history-item';
    const main = document.createElement('div');
    main.className = 'h-main';
    const topic = document.createElement('div');
    topic.className = 'h-topic';
    topic.textContent = record.topic;
    const sub = document.createElement('div');
    sub.className = 'h-sub';
    const total = (record.rounds || []).reduce((sum, r) => sum + r.durationMs, 0);
    const when = new Date(record.createdAt).toLocaleString('ja-JP', {
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    // 最後まで終わらなかったセッション（アプリが落ちた等）は一目で分かるように。
    sub.textContent = [
      when,
      `${(record.rounds || []).length} ラウンド`,
      formatDuration(total),
      record.partial ? '途中まで' : '',
    ].filter(Boolean).join('・');
    main.append(topic, sub);
    const arrow = document.createElement('span');
    arrow.className = 'h-arrow';
    arrow.textContent = '›';
    item.append(main, arrow);
    item.addEventListener('click', async () => {
      const full = await getSession(record.id);
      if (!full) return;
      renderResult(full);
      show('screen-result');
    });
    box.appendChild(item);
  });
}

/* ---------------- 設定 ---------------- */

function fillSettingsForm() {
  const s = state.settings;
  $('#set-r1').value = s.roundMinutes[0];
  $('#set-r2').value = s.roundMinutes[1];
  $('#set-r3').value = s.roundMinutes[2];
  $('#set-break').value = s.breakMinutes;
  $('#set-lang').value = s.lang;
  $('#set-sound').checked = s.sound;
  $('#set-autonext').checked = s.autoNextBreak;
  $('#toggle-transcribe').checked = s.transcribe && isSpeechSupported();
}

function readSettingsForm() {
  const s = state.settings;
  s.roundMinutes = [
    clamp(Number($('#set-r1').value) || 4, 1, 15),
    clamp(Number($('#set-r2').value) || 3, 1, 15),
    clamp(Number($('#set-r3').value) || 2, 1, 15),
  ];
  s.breakMinutes = clamp(Number($('#set-break').value) || 0, 0, 10);
  s.lang = $('#set-lang').value;
  s.sound = $('#set-sound').checked;
  s.autoNextBreak = $('#set-autonext').checked;
  saveSettings(s);
  renderPlan();
}

async function showUsage() {
  const usage = await estimateUsage();
  $('#storage-usage').textContent = usage
    ? `使用中の容量：約 ${(usage / 1024 / 1024).toFixed(1)} MB`
    : '';
}

/* ---------------- 起動 ---------------- */

function bind() {
  watchViewportHeight();
  renderTopicSuggestions();
  renderMemo();
  renderPlan();
  fillSettingsForm();
  checkEnvironment();

  $('#memo-form').addEventListener('submit', e => { e.preventDefault(); addMemoWord(); });
  $('#btn-start').addEventListener('click', startSession);
  $('#toggle-transcribe').addEventListener('change', e => {
    state.settings.transcribe = e.target.checked;
    saveSettings(state.settings);
  });

  $('#btn-skip').addEventListener('click', () => state.session?.skip());
  $('#btn-abort').addEventListener('click', abortSession);

  $('#gap-form').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('#input-gap');
    const word = input.value.trim();
    if (!word) return;
    state.gaps.push(word);
    input.value = '';
    renderGapList($('#gap-list'), state.gaps, { editable: true });
  });

  $('#btn-result-back').addEventListener('click', () => {
    releaseUrls();
    show('screen-setup');
  });
  $('#btn-again').addEventListener('click', () => {
    releaseUrls();
    show('screen-setup');
    $('#input-topic').focus();
  });
  $('#btn-result-delete').addEventListener('click', async () => {
    if (!state.viewing) return;
    if (!confirm('この記録を削除しますか？')) return;
    await deleteSession(state.viewing.id);
    releaseUrls();
    state.viewing = null;
    toast('削除しました');
    show('screen-setup');
  });

  $('#btn-export-session').addEventListener('click', () => {
    exportRecords(state.viewing ? [state.viewing] : [], '書き出せる記録がありません');
  });
  $('#btn-export-all').addEventListener('click', exportAll);
  $('#btn-settings-export').addEventListener('click', exportAll);
  ['#btn-import-history', '#btn-settings-import']
    .forEach(sel => $(sel).addEventListener('click', openImportDialog));
  $('#import-file').addEventListener('change', e => handleImportFile(e.target.files?.[0]));

  $('#btn-open-history').addEventListener('click', async () => {
    show('screen-history');
    await renderHistory();
  });
  $('#btn-history-back').addEventListener('click', () => show('screen-setup'));

  $('#btn-open-settings').addEventListener('click', () => {
    fillSettingsForm();
    showUsage();
    show('screen-settings');
  });
  $('#btn-settings-back').addEventListener('click', () => show('screen-setup'));
  ['#set-r1', '#set-r2', '#set-r3', '#set-break', '#set-lang', '#set-sound', '#set-autonext']
    .forEach(sel => $(sel).addEventListener('change', readSettingsForm));
  $('#btn-reset-times').addEventListener('click', () => {
    state.settings.roundMinutes = [...DEFAULT_SETTINGS.roundMinutes];
    state.settings.breakMinutes = DEFAULT_SETTINGS.breakMinutes;
    saveSettings(state.settings);
    fillSettingsForm();
    renderPlan();
    toast('4 / 3 / 2 に戻しました');
  });
  $('#btn-clear-all').addEventListener('click', async () => {
    if (!confirm('すべての録音と履歴を削除します。よろしいですか？')) return;
    await clearSessions();
    releaseUrls();
    toast('すべて削除しました');
    showUsage();
  });

  // 練習中の誤操作でセッションを失わないようにする。
  window.addEventListener('beforeunload', e => {
    if (state.session && !state.session.finished) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

bind();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
