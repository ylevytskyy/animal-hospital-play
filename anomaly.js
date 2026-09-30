// Anomaly archetypes: pure game logic, no three.js, so it runs under node:test.

export const ARCHETYPES = { flatterer: 'Підлабузник', gaslighter: 'Газлайтер', glutton: 'Ненажера', saboteur: 'Саботажник' };
const IDS = Object.keys(ARCHETYPES);

export const pickArchetype = (rand = Math.random) => IDS[Math.floor(rand() * IDS.length)];

// Which situations each archetype has lines for (the bank test checks every one is filled).
export const SITUATIONS = {
  flatterer: ['hello', 'complaint', 'inBed', 'distract'],
  gaslighter: ['hello', 'complaint', 'inBed', 'advice'],
  glutton: ['hello', 'complaint', 'inBed', 'hungry'],
  saboteur: ['hello', 'complaint', 'inBed'],
};

const SLOT = /\{(\w+)\}/g;
// A random line for this character/archetype/situation with {placeholders} filled from vars.
// Templates needing a var we don't have are skipped; null if nothing fits (the caller falls back).
export function pickLine(bank, charId, archetype, situation, vars = {}, rand = Math.random) {
  const fits = (bank[charId]?.[archetype]?.[situation] ?? [])
    .filter((t) => [...t.matchAll(SLOT)].every(([, k]) => vars[k] != null));
  if (!fits.length) return null;
  return fits[Math.floor(rand() * fits.length)].replace(SLOT, (_, k) => vars[k]);
}

// A glutton left untreated in bed: warns after GLUTTON_WARN game minutes, goes hunting after GLUTTON_HUNT.
export const GLUTTON_WARN = 60;
export const GLUTTON_HUNT = 90;
export const gluttonStage = (inBedAt, now) =>
  now - inBedAt >= GLUTTON_HUNT ? 'hunt' : now - inBedAt >= GLUTTON_WARN ? 'warn' : 'calm';

// A saboteur spoils its own sample while it sits in the lab analyzer and the doctor has been out of the lab
// for SABOTAGE_AFTER real seconds (shorter than the analysis, so walking straight out is enough).
export const SABOTAGE_AFTER = 2;
export function sabotageStep(away, { sampleInLab, doctorInLab, used }, dt) {
  if (used || !sampleInLab || doctorInLab) return { away: 0, corrupt: false };
  const next = away + dt;
  return next >= SABOTAGE_AFTER ? { away: 0, corrupt: true } : { away: next, corrupt: false };
}
