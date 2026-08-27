/**
 * セッションのファイル書き出し・読み込み。
 *
 * ブラウザの中だけに置いておくと、履歴を消したり端末を変えたりした時点で
 * 録音が失われる。1 ファイルに音声ごと入れて持ち出せるようにする。
 */

export const FORMAT = '432recorder';
export const FORMAT_VERSION = 1;
export const FILE_EXT = 'json';

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64, mime) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'audio/webm' });
}

async function toPlain(record) {
  const rounds = [];
  for (const round of record.rounds || []) {
    rounds.push({
      index: round.index,
      plannedMs: round.plannedMs,
      durationMs: round.durationMs,
      mime: round.mime || '',
      transcript: round.transcript || '',
      words: round.words || 0,
      audio: round.blob ? await blobToBase64(round.blob) : null,
    });
  }
  return {
    id: record.id,
    createdAt: record.createdAt,
    topic: record.topic,
    memo: record.memo || [],
    gaps: record.gaps || [],
    settings: record.settings || null,
    partial: !!record.partial,
    rounds,
  };
}

function fromPlain(plain) {
  if (!plain || typeof plain !== 'object') return null;
  if (typeof plain.createdAt !== 'number' || typeof plain.topic !== 'string') return null;
  const rounds = (Array.isArray(plain.rounds) ? plain.rounds : []).map((round, i) => ({
    index: Number.isInteger(round.index) ? round.index : i,
    plannedMs: Number(round.plannedMs) || 0,
    durationMs: Number(round.durationMs) || 0,
    mime: typeof round.mime === 'string' ? round.mime : '',
    transcript: typeof round.transcript === 'string' ? round.transcript : '',
    words: Number(round.words) || 0,
    blob: round.audio ? base64ToBlob(round.audio, round.mime) : null,
  }));
  return {
    id: typeof plain.id === 'string' && plain.id ? plain.id : `s_${plain.createdAt}`,
    createdAt: plain.createdAt,
    topic: plain.topic,
    memo: Array.isArray(plain.memo) ? plain.memo.map(String) : [],
    gaps: Array.isArray(plain.gaps) ? plain.gaps.map(String) : [],
    settings: plain.settings ?? null,
    partial: !!plain.partial,
    rounds,
  };
}

/** セッションを 1 つの JSON（音声込み）にまとめる。 */
export async function exportSessions(records) {
  const payload = {
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: Date.now(),
    sessions: [],
  };
  for (const record of records) payload.sessions.push(await toPlain(record));
  return new Blob([JSON.stringify(payload)], { type: 'application/json' });
}

/** ファイル名向けに話題を短く整える。 */
function slug(topic) {
  return (topic || 'session')
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'session';
}

export function fileNameFor(records) {
  const date = new Date(records[0]?.createdAt ?? Date.now()).toISOString().slice(0, 10);
  const name = records.length === 1 ? slug(records[0].topic) : `all-${records.length}`;
  return `432_${date}_${name}.${FILE_EXT}`;
}

/**
 * 書き出したファイルを読み戻す。
 * 壊れているセッションは黙って飛ばし、読めたぶんだけ返す。
 */
export async function importFile(file) {
  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch {
    throw new Error('ファイルを読み取れませんでした');
  }
  if (!payload || payload.format !== FORMAT) {
    throw new Error('4/3/2 Recorder の書き出しファイルではないようです');
  }
  if (Number(payload.version) > FORMAT_VERSION) {
    throw new Error('新しい形式のファイルです。アプリを更新してください');
  }
  const sessions = (Array.isArray(payload.sessions) ? payload.sessions : [])
    .map(fromPlain)
    .filter(Boolean);
  if (!sessions.length) throw new Error('読み込めるセッションがありませんでした');
  return sessions;
}

/** ブラウザにファイルを保存させる。 */
export function download(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // click 直後に revoke すると保存が始まらない端末があるので、少し待つ。
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
