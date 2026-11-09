/**
 * Automatic screening for the commitment wall. Runs on the phone for a friendly message and on the
 * server, which is what counts. It is a first pass in front of a human moderator, not a replacement.
 *
 * Three outcomes, because this is an event about ending violence against children:
 *   block    profanity and slurs, and contact details (the safeguarding plan treats personal
 *            information of children as a risk). Not stored; the writer is asked to rephrase.
 *   flag     words that are entirely legitimate here ("end sexual abuse") but must never reach the
 *            big screen without a person reading them, and anything that may be someone disclosing
 *            harm to themselves. Always held for a moderator, even in auto-show mode.
 *   ok       everything else.
 *
 * To change what is caught, edit the lists below. ANYWHERE matches inside a word; WHOLE only matches
 * the whole word, for short ones that hide in innocent words ("ass" is in "class", and in Filipino
 * "gaga" is in "gagawin").
 */
export const MAX_LEN = 120;

const ANYWHERE = [
  'fuck', 'shit', 'bitch', 'cunt', 'nigg', 'fagg', 'asshole', 'whore', 'pussy', 'hitler',
  // Filipino
  'putang', 'tangina', 'kantot', 'pakyu', 'pakshet', 'jakol', 'tarantado', 'hindot', 'pekpek', 'kingina',
];
const WHOLE = [
  'ass', 'arse', 'dick', 'cock', 'slut', 'fag', 'hoe', 'tits', 'boobs',
  // Filipino
  'puta', 'gago', 'gaga', 'tanga', 'bobo', 'ulol', 'tite', 'titi', 'puke', 'kupal', 'burat', 'leche', 'tae', 'inutil',
];
const SENSITIVE = [
  'rape', 'raped', 'raping', 'rapist', 'sex', 'sexy', 'sexual', 'sexually', 'porn', 'pornography', 'abuse', 'abused',
  'molest', 'molested', 'suicide', 'kill', 'killed', 'die', 'dead', 'penis', 'vagina', 'naked', 'nude',
  // Filipino
  'gahasa', 'ginahasa', 'pagpatay', 'patayin', 'magpakamatay',
];
// Someone may be telling us about harm to themselves. A moderator should alert the Safeguarding Team.
const DISCLOSURE = [
  /\b(hit|hits|hurt|hurts|touched|touches|abused|abuses|raped|beat|beats|threatens|threatened)\s+me\b/,
  /\b(i was|i am|i'm|i got|i have been)\s+(being\s+)?(abused|raped|hurt|beaten|bullied|touched|threatened)\b/,
  /\b(kill|hurt|harm)\s+myself\b/,
  /\b(want|wanted)\s+to\s+die\b/,
  /\bhelp me\b/,
  /\b(sinaktan|hinipuan|ginahasa|binugbog)\s+(ako|niya ako)\b/,
];

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i' };
// Tolerates stretching: "fuuuck" is still f+u+c+k+.
const stretchy = (w) => w.split('').map((c) => `${c}+`).join('');
const ANYWHERE_RE = ANYWHERE.map((w) => new RegExp(stretchy(w)));
const WHOLE_RE = WHOLE.map((w) => new RegExp(`^${stretchy(w)}$`));

/** Letters, numbers, punctuation and single spaces; no emoji or markup; no "I commit to" prefix. */
export function cleanCommitment(raw) {
  return String(raw ?? '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N}\p{P}$ \n]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^i\s+(will\s+)?commit(\s+to)?\s*[:,.-]?\s*/i, '')
    .slice(0, MAX_LEN)
    .trim();
}

function hasContactDetails(lower) {
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(lower)) return true;
  if (/(https?:\/\/|www\.)/.test(lower)) return true;
  if (/\b[\w-]+\.(com|org|net|ph|io|me|gg|co|edu|gov)\b/.test(lower)) return true;
  if (/(^|\s)@\w{2,}/.test(lower)) return true;
  // Seven or more digits in a row, allowing separators: a phone number, not a year.
  return /\d{7,}/.test(lower.replace(/[\s().+-]/g, ''));
}

function isProfane(lower) {
  const tokens = lower.split(/\s+/).filter(Boolean);
  const words = [];
  let run = '';
  for (const raw of tokens) {
    const w = raw.replace(/[0134578@$!]/g, (c) => LEET[c]).replace(/[^\p{L}]/gu, '');
    if (!w) continue;
    words.push(w);
    // "f u c k" and "p.u.t.a" are read as one word.
    if (w.length === 1) run += w;
    else {
      if (run.length >= 3) words.push(run);
      run = '';
    }
  }
  if (run.length >= 3) words.push(run);
  return words.some((w) => ANYWHERE_RE.some((re) => re.test(w)) || WHOLE_RE.some((re) => re.test(w)));
}

/**
 * A boat name for the sailing opening. Stricter than a commitment, because a name goes straight to
 * the big screen with nobody reading it first: anything this screen would flag is refused too.
 * @returns {{ ok: boolean, name: string, reason?: 'empty'|'contact'|'block' }}
 */
export const NAME_MAX = 18;
export function screenName(raw) {
  const name = String(raw ?? '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N} .,'!?&-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .trim();
  if ((name.match(/\p{L}/gu) || []).length < 2) return { ok: false, name, reason: 'empty' };
  const lower = name.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
  if (hasContactDetails(lower)) return { ok: false, name, reason: 'contact' };
  if (isProfane(lower) || DISCLOSURE.some((re) => re.test(lower))) return { ok: false, name, reason: 'block' };
  if (lower.split(/[^\p{L}]+/u).some((w) => SENSITIVE.includes(w))) return { ok: false, name, reason: 'block' };
  return { ok: true, name };
}

/** @returns {{ verdict: 'ok'|'flag'|'block'|'contact'|'empty', text: string, note?: string }} */
export function screenCommitment(raw) {
  const text = cleanCommitment(raw);
  if ((text.match(/\p{L}/gu) || []).length < 3) return { verdict: 'empty', text };
  const lower = text.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
  if (hasContactDetails(lower)) return { verdict: 'contact', text };
  if (isProfane(lower)) return { verdict: 'block', text };
  if (DISCLOSURE.some((re) => re.test(lower))) {
    return { verdict: 'flag', text, note: 'May be someone disclosing harm. Tell the Safeguarding Team.' };
  }
  const words = lower.split(/[^\p{L}]+/u);
  if (words.some((w) => SENSITIVE.includes(w))) return { verdict: 'flag', text, note: 'Sensitive words. Read before approving.' };
  return { verdict: 'ok', text };
}
