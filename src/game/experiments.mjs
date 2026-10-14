import { potionRecord, scalePotionContents } from './potionTransfer.mjs';
import { createRabbitColony, migrateRabbitColony, rabbitById, advanceRabbits, buyRabbit,
  assessRabbitEffects, appendRabbitEvent } from './rabbits.mjs';

export const EXPERIMENT_SUBJECTS = Object.freeze([
  { id: 'rabbit', name: 'Moon Rabbit', kind: 'animal', icon: 'rabbit', description: 'Observe a finite colony with persistent potion effects.' }
]);
export const EXPERIMENT_RECORD_LIMIT = 80;

export function createExperimentState(now = Date.now()) {
  const colony = createRabbitColony(now);
  return { ...colony, subjects: { rabbit: colony.rabbits[0] }, records: [], serial: 0 };
}

export function currentExperimentReport(state, subjectId) {
  const subject = rabbitById(state.experiments, subjectId);
  return subject?.trials ? state.experiments.records.find(report =>
    (report.subjectId === subject.id || subject.id === 'rabbit-1' && report.subjectId === 'rabbit') && report.at === subject.lastTestAt) || null : null;
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
    if (copy.contents) copy.contents = scalePotionContents(copy.contents, ratio);
    return copy;
  };
  return { dose: scaled(fraction), remaining: fraction >= 1 - 1e-10 ? null : scaled(1 - fraction) };
}

/** Resolves the very same particle-derived properties used by potion scoring.
 * Callers transfer the actual dose from the cauldron or vial first. The sample
 * is never edited and reports keep independent snapshots of the observations. */
export function runExperiment(state, sample, subjectId, volume = 5, now = Date.now(), preparation = null) {
  if (!Number.isFinite(now) || now < 0) throw new Error('Invalid experiment time.');
  if (!Number.isFinite(volume) || volume <= 0 || volume > 50) throw new Error('Experiment doses must be between 0 and 50 ml.');
  state.experiments ||= createExperimentState(now);
  if (!Array.isArray(state.experiments.rabbits)) state.experiments = migrateRabbitColony(state.experiments, now);
  const previousEvents = new Set(state.experiments.events.map(event => event.id));
  advanceRabbits(state, now);
  const experiments = state.experiments;
  const subject = rabbitById(experiments, subjectId);
  if (!subject) throw new Error('Choose an available rabbit.');
  if (!subject.stats.alive) throw new Error('This rabbit has died. Choose another living rabbit.');
  if (subject.readyAt > now) throw new Error('Let this rabbit recover before another trial.');
  const { dose } = splitPotionSample(potionRecord(sample), volume);
  const assessment = assessRabbitEffects(dose, subject, dose.volume, now);
  const serial = experiments.serial + 1;
  Object.assign(subject, structuredClone(assessment.afterRabbit));
  subject.readyAt = now + (state.equipment?.analyzer ? 3000 : 6000);
  subject.trials++; subject.lastTestAt = now;
  appendRabbitEvent(experiments, subject.stats.alive ? 'trial' : 'death',
    `${subject.name}: ${assessment.observations.join(' ')}`, now, subject.id);
  const report = { ...assessment,
    afterRabbit: structuredClone(subject),
    events: structuredClone(experiments.events.filter(event => !previousEvents.has(event.id))),
    id: `trial-${serial}`, serial, subjectName: subject.name, at: now,
    sample: potionRecord(dose), sampleId: sample.id || null, volume: dose.volume, subjectId: subject.id, kind: subject.kind,
    preparation: potionRecord(preparation || { portions: sample.portions || [], volume: sample.volume, history: sample.history || {} }) };
  experiments.serial = serial; experiments.records.unshift(structuredClone(report));
  experiments.records.length = Math.min(experiments.records.length, EXPERIMENT_RECORD_LIMIT);
  state.experiments = experiments;
  return report;
}

/** Kept for older callers: replacement buys a distinct rabbit and never heals
 * or revives the selected animal. New UI uses buyRabbit directly. */
export function resetExperimentSubject(state, subjectId, now = Date.now()) {
  state.experiments ||= createExperimentState(now);
  if (!rabbitById(state.experiments, subjectId)) throw new Error('Choose an available rabbit.');
  return buyRabbit(state, now);
}
