/**
 * 4/3/2 テクニックの設定と、写真のメモにある「本番で意識すること」。
 */

const SETTINGS_KEY = '432recorder.settings.v1';

export const DEFAULT_SETTINGS = {
  roundMinutes: [4, 3, 2],
  breakMinutes: 1,
  sound: true,
  autoNextBreak: true,
  transcribe: false,
  lang: 'en-US',
};

/** 各ラウンド／休憩で画面に出す指示（メモの表そのまま）。 */
export const CUES = {
  round: [
    '内容を出し切る。詰まって ok。沈黙 ok。',
    '同じ内容を、無駄に削って言う',
    '早く多少雑でも止まらないこと',
  ],
  break: [
    '言えなかった単語を 1〜2 個メモして調べる',
    '何も見ない。深呼吸だけ',
  ],
};

export const TOPIC_SUGGESTIONS = [
  'My morning routine',
  'A place I want to go back to',
  'What I did last weekend',
  'My favorite food',
  'A person I respect',
  'The last thing I learned',
];

export const MAX_MEMO_WORDS = 4;

export function loadSettings() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  } catch {
    stored = {};
  }
  const s = { ...DEFAULT_SETTINGS, ...stored };
  // 壊れた値で無限ループやゼロ長ラウンドにならないよう最低限を保証する。
  s.roundMinutes = (Array.isArray(s.roundMinutes) ? s.roundMinutes : DEFAULT_SETTINGS.roundMinutes)
    .slice(0, 3)
    .map((m, i) => clamp(Number(m) || DEFAULT_SETTINGS.roundMinutes[i], 1, 15));
  while (s.roundMinutes.length < 3) s.roundMinutes.push(DEFAULT_SETTINGS.roundMinutes[s.roundMinutes.length]);
  s.breakMinutes = clamp(Number(s.breakMinutes) || 0, 0, 10);
  return s;
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/** 設定から 5 つのフェーズ（4分 → 休憩 → 3分 → 休憩 → 2分）を組み立てる。
 *
 * フェーズは「自分が何をする番なのか」を自分で持つ。画面側が
 * 「配列の何番目か」や「ラウンドは全部で何本か」から判断すると、
 * 別の進行（ラウンド2本・休憩なしなど）を足したときに静かに壊れる。
 * 例：録音の終わりを `index === roundMinutes.length - 1` で見ていると、
 * roundMinutes が常に3本に揃えられている以上、2本の進行では
 * 終了音が一度も鳴らない。
 *
 *   records  … このフェーズは録音する
 *   last     … 録音する最後のフェーズ（終わりの音を鳴らす）
 *   tick     … 残り10秒のカウント音を鳴らす
 *   notes    … メモ欄を出す
 *   breathe  … 呼吸ガイドを出し、メモと指示を伏せる
 *   keepGaps … 沈黙の記録をここで確定させる
 *   hideCue  … 上の一文を出さない（パネル側に同じ文言があるため）
 */
export function buildPhases(settings) {
  const phases = [];
  const lastRound = settings.roundMinutes.length - 1;
  settings.roundMinutes.forEach((min, i) => {
    if (i > 0 && settings.breakMinutes > 0) {
      phases.push({
        type: 'break',
        index: i - 1,
        ms: settings.breakMinutes * 60_000,
        // 自動で進めない設定のときは 0 になっても次のラウンドを始めず待つ。
        hold: !settings.autoNextBreak,
        label: `休憩 ${settings.breakMinutes}分`,
        cue: CUES.break[i - 1] ?? CUES.break.at(-1),
        records: false,
        hideCue: true,
        notes: i === 1,
        breathe: i > 1,
        keepGaps: i === 1,
      });
    }
    phases.push({
      type: 'round',
      index: i,
      ms: min * 60_000,
      label: `${i + 1}ラウンド目 ${min}分`,
      cue: CUES.round[i] ?? CUES.round.at(-1),
      records: true,
      tick: true,
      last: i === lastRound,
    });
  });
  return phases;
}
