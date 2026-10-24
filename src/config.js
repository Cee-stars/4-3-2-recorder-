/**
 * 4/3/2 テクニックの設定と、写真のメモにある「本番で意識すること」。
 */

const SETTINGS_KEY = '432recorder.settings.v1';

export const DEFAULT_SETTINGS = {
  mode: '432',
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

/** モードの一覧。既定は 4/3/2 のまま変えない。 */
export const MODES = [
  { id: '432', name: '4/3/2', hint: '同じ話を 4分 → 3分 → 2分。削りながら速くする' },
  { id: 'solo', name: 'ひとりで話す', hint: '1分話して、聞き返して、言い直してもう1分。相手なしで組み立てる' },
];

/** 「ひとりで話す」の各工程に出す指示。 */
export const SOLO_CUES = {
  frame: 'ⓐ何の話だったか　ⓑ誰が、何をしたか　ⓒ自分はどう思うか',
  ready: '構える。まだ話さない',
  take1: '1分、英語で話す。詰まっても止まらない',
  listen: '自分の録音を聞く。詰まった所を1つだけ決める',
  fix: 'その所だけを言い直す。声に出す',
  take2: 'もう一度1分、同じ話をする',
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
  // 知らない値が入っていても 4/3/2 に落とす（既定を変えない）。
  s.mode = s.mode === 'solo' ? 'solo' : '432';
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
  if (settings.mode === 'solo') return buildSoloPhases();
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

/** 「ひとりで話す」の工程。
 *
 * 1分 × 5工程に、録音の前だけ3秒の「構える」を挟む。構えるのは演出ではなく、
 * session.js が endsAt を onPhaseStart（マイクの起動）より先に決めるため、
 * 録音の頭が1〜2秒削られるのを吸収するためのもの。4分なら無視できるが
 * 1分では話し始めが欠ける。
 *
 * 残り10秒のカウント音は鳴らさない（tick なし）。1分の17%が
 * ⓒ「自分はどう思うか」に被るため。
 */
export function buildSoloPhases() {
  const min = 60_000;
  const ready = 3_000;
  return [
    { type: 'prep', index: 0, ms: min, label: '型に当てる 1分', cue: SOLO_CUES.frame,
      records: false, showMemo: true, skipLabel: '次へ' },
    { type: 'ready', index: 0, ms: ready, label: '構える', cue: SOLO_CUES.ready,
      records: false, skipLabel: '次へ' },
    { type: 'round', index: 0, ms: min, label: '1回目 1分', cue: SOLO_CUES.take1,
      records: true, last: false },
    { type: 'listen', index: 0, ms: min, label: '聞き返す 1分', cue: SOLO_CUES.listen,
      records: false, skipLabel: '次へ' },
    { type: 'fix', index: 0, ms: min, label: '言い直す 1分', cue: SOLO_CUES.fix,
      records: false, skipLabel: '次へ' },
    { type: 'ready', index: 1, ms: ready, label: '構える', cue: SOLO_CUES.ready,
      records: false, skipLabel: '次へ' },
    { type: 'round', index: 1, ms: min, label: '2回目 1分', cue: SOLO_CUES.take2,
      records: true, last: true },
  ];
}
