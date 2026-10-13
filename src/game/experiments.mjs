import { assessEffects } from './effects.mjs';

export const EXPERIMENT_SUBJECTS = Object.freeze([
  { id: 'rabbit', name: 'Moon Rabbit', kind: 'animal', icon: 'rabbit', description: 'Observe vitality, affection and changing strength.' },
  { id: 'beetle', name: 'Copper Beetle', kind: 'animal', icon: 'beetle', description: 'A hardy subject for heat, frost and transformation.' },
  { id: 'seedling', name: 'Bean Seedling', kind: 'plant', icon: 'plant', description: 'Watch growth, wilting and elemental changes.' },
  { id: 'stone', name: 'Limestone', kind: 'mineral', icon: 'stone', description: 'Reveal corrosion and magical changes in an inert subject.' }
]);
export const EXPERIMENT_RECORD_LIMIT = 80;

const initialStats = subject => ({ health: 100, vitality: 100, growth: subject.kind === 'plant' ? 20 : 0,
  strength: subject.id === 'beetle' ? 35 : 20, love: 0, transformation: 0, burning: 0, freezing: 0, alive: true });
const freshSubject = subject => ({ ...subject, stats: initialStats(subject), trials: 0, lastTestAt: 0 });

export function createExperimentState() {
  return { subjects: Object.fromEntries(EXPERIMENT_SUBJECTS.map(subject => [subject.id, freshSubject(subject)])), records: [], serial: 0 };
}

/** A dose and its remainder are independent snapshots. Intensive properties
 * stay unchanged; all stored quantities and expenses follow the same fraction.
 * The remainder retains the sealed vial's ID, so tasting cannot duplicate it. */
export function splitPotionSample(sample, requestedMl = 5) {
  if (!sample || !Number.isFinite(sample.volume) || !(sample.volume > 0) || !Number.isFinite(sample.mass) || !(sample.mass > 0)) throw new Error('A liquid potion is needed for this experiment.');
  if (!Number.isFinite(requestedMl) || !(requestedMl > 0)) throw new Error('Choose a positive experiment dose.');
  const quantity = Math.min(requestedMl, sample.volume), fraction = quantity / sample.volume;
  const scaled = ratio => {
    const copy = structuredClone(sample);
    copy.volume = sample.volume * ratio; copy.mass = sample.mass * ratio;
    if (copy.cost) for (const key of Object.keys(copy.cost)) copy.cost[key] *= ratio;
    if (copy.composition) for (const key of Object.keys(copy.composition)) copy.composition[key] *= ratio;
    if (copy.phaseMass) copy.phaseMass = copy.phaseMass.map(mass => mass * ratio);
    if (copy.portions) copy.portions = copy.portions.map(portion => ({ ...portion, ml: portion.ml * ratio }));
    return copy;
  };
  return { dose: scaled(fraction), remaining: fraction >= 1 - 1e-10 ? null : scaled(1 - fraction) };
}

/** Resolves the very same particle-derived properties used by potion scoring.
 * Callers transfer the actual dose from the cauldron or vial first. The sample
 * is never edited and reports keep independent snapshots of the observations. */
export function runExperiment(state, sample, subjectId, volume = 5, now = Date.now()) {
  if (!Number.isFinite(now) || now < 0) throw new Error('Invalid experiment time.');
  if (volume > 50) throw new Error('Experiment doses must be 50 ml or smaller.');
  const experiments = state.experiments || createExperimentState();
  const subject = experiments.subjects[subjectId];
  if (!subject) throw new Error('Choose an experiment subject.');
  if (!subject.stats.alive) throw new Error('Reset this subject before another experiment.');
  const { dose } = splitPotionSample(sample, volume);
  const assessment = assessEffects(dose, subject, dose.volume);
  const serial = experiments.serial + 1;
  const report = { ...assessment, id: `trial-${serial}`, serial, subjectName: subject.name, at: now,
    sample: dose, sampleId: sample.id || null, volume: dose.volume, subjectId: subject.id, kind: subject.kind };
  subject.stats = { ...assessment.after }; subject.trials++; subject.lastTestAt = now;
  experiments.serial = serial; experiments.records.unshift(structuredClone(report));
  experiments.records.length = Math.min(experiments.records.length, EXPERIMENT_RECORD_LIMIT);
  state.experiments = experiments;
  return report;
}

export function resetExperimentSubject(state, subjectId) {
  const definition = EXPERIMENT_SUBJECTS.find(subject => subject.id === subjectId);
  if (!definition) throw new Error('Choose an experiment subject.');
  state.experiments ||= createExperimentState();
  state.experiments.subjects[subjectId] = freshSubject(definition);
  return state.experiments.subjects[subjectId];
}
