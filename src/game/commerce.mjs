import { assessPotion } from './evaluation.mjs';
import { findPotionId, potionFingerprint } from './potionId.mjs';
import { mulberry32 } from '../materials/MaterialGenerator.mjs';
import { seedNumber } from './world.mjs';

export function certificationCost(state) { return Math.max(90, Math.ceil(state.order.budget * 1.5)); }
export function certificateFor(state, sample) {
  const fingerprint = potionFingerprint(sample);
  return (state.certificates || []).find(c => c.fingerprint === fingerprint) || null;
}
export function certifyPotion(state) {
  const sample = state.pendingBottle;
  if (!sample || !findPotionId(state, sample)) throw new Error('Seal a potion with a compiled ID first.');
  if (state.mode === 'sandbox') throw new Error('Expert certification belongs to shop mode.');
  const existing = certificateFor(state, sample); if (existing) return existing;
  const cost = certificationCost(state);
  if (state.coins < cost) throw new Error(`The expert charges ${cost} coins for this batch.`);
  state.coins -= cost; state.certificates ||= [];
  const seal = { id: `seal-${sample.batchId}`, fingerprint: potionFingerprint(sample), batchId: sample.batchId,
    at: Date.now(), cost, expert: 'Master Yselle' };
  state.certificates.unshift(seal); state.certificates.length = Math.min(80,state.certificates.length);
  return seal;
}
export function startNegotiation(state) {
  const sample = state.pendingBottle, document = findPotionId(state,sample);
  if (!sample || !document) throw new Error('Compile this potion’s ID after a creature trial.');
  if (state.complaints?.some(c => c.status === 'pending')) throw new Error('Resolve the returning customer first.');
  const fingerprint = potionFingerprint(sample) + ':' + sample.volume.toFixed(3);
  if (state.negotiation?.fingerprint === fingerprint) return state.negotiation;
  // Buyers bargain against the seller's written claims, never secretly assay
  // the vial at the counter. Actual effectiveness is assessed after delivery.
  const claimed = { ...sample, ...document.estimates };
  const claim = assessPotion(claimed,state.order).quality / 100;
  const ceiling = Math.max(5,Math.floor(state.order.budget * (.64 + .3 * claim) * Math.min(1,sample.volume/state.order.volume)));
  state.negotiation = { fingerprint, orderId: state.order.id, offer: Math.max(1,Math.floor(ceiling*.62)), ceiling,
    round: 0, agreed: false, sellerAsk: null, history: [] };
  return state.negotiation;
}
export function counterOffer(state, requested) {
  const negotiation = startNegotiation(state), ask = Math.floor(requested);
  if (!Number.isFinite(requested) || ask < 1 || ask > state.order.budget * 3) throw new Error('Choose a reasonable whole-coin offer.');
  if (negotiation.agreed) throw new Error('A price is already agreed.');
  if (negotiation.round >= 4) throw new Error('This is the customer’s final offer.');
  negotiation.round++; negotiation.sellerAsk = ask;
  if (ask <= negotiation.ceiling) { negotiation.offer = ask; negotiation.agreed = true; }
  else negotiation.offer = Math.min(negotiation.ceiling,negotiation.offer+Math.max(1,Math.ceil((negotiation.ceiling-negotiation.offer)*.45)));
  negotiation.history.push({ ask, offer: negotiation.offer, accepted: negotiation.agreed });
  return negotiation;
}
export function acceptCustomerOffer(state) {
  const negotiation = startNegotiation(state);
  negotiation.agreed = true;
  return negotiation.offer;
}
export function recordDelivery(state, sale, sample, order, now = Date.now()) {
  state.deliveries ||= []; state.complaints ||= [];
  const assessment = assessPotion(sample,order), met = assessment.quantityRatio >= .999 && assessment.breakdown.every(r=>r.met);
  const random = mulberry32(seedNumber(`${state.seed}:complaint:${order.id}`));
  const bluff = met && random() < .26;
  const receipt = { id: `receipt-${order.id}`, orderId: order.id, customer: structuredClone(order.customer),
    fingerprint: potionFingerprint(sample), potionId: findPotionId(state,sample)?.id || null,
    payment: sale.payment, certified: Boolean(certificateFor(state,sample)), met, bluff, genuine: !met,
    sideEffects: assessment.breakdown.filter(r => r.comparison === 'maximum' && !r.met).map(r=>r.property),
    dueAt: now + 150000 + Math.floor(random()*150000), dueCompleted: state.completed + 2 + Math.floor(random()*2), status: 'delivered' };
  state.deliveries.unshift(receipt); state.deliveries.length = Math.min(100,state.deliveries.length);
  state.negotiation = null;
  return receipt;
}
function refundPayment(state, complaint) {
  const paid = Math.min(state.coins,complaint.payment);
  state.coins = Math.round((state.coins-paid)*100)/100;
  state.debt = (state.debt || 0) + complaint.payment - paid;
  if (complaint.genuine) state.reputation = Math.max(0,state.reputation-3);
  complaint.status = 'refunded'; complaint.resolvedAt = Date.now();
}
/** Persisted appointments survive reload/offline time. Ignoring a justified or
 * unprotected claim cannot evade it: the guild debits it after one minute. */
export function advanceComplaints(state, now = Date.now()) {
  if (state.mode === 'sandbox') return [];
  state.complaints ||= []; const arrived = [];
  for (const receipt of state.deliveries || []) {
    if (receipt.status !== 'delivered' || now < receipt.dueAt && state.completed < receipt.dueCompleted) continue;
    receipt.status = 'reviewed';
    if (!receipt.genuine && !receipt.bluff) continue;
    const complaint = { ...receipt, id: `claim-${receipt.orderId}`, status: 'pending', arrivedAt: now, deadline: now+60000,
      reason: receipt.bluff ? 'It did nothing for my problem. I want my money back.' : receipt.sideEffects.length ? 'The potion gave me unwanted side effects. Refund me.' : 'The enchantment was too weak for my problem. I need a refund.' };
    state.complaints.unshift(complaint); arrived.push(complaint);
  }
  for (const complaint of state.complaints) if (complaint.status === 'pending' && now >= complaint.deadline) {
    if (complaint.certified && complaint.bluff && complaint.met) { complaint.status = 'dismissed'; complaint.resolvedAt = now; }
    else refundPayment(state,complaint);
  }
  state.complaints.length = Math.min(100,state.complaints.length);
  return arrived;
}
export function resolveComplaint(state, complaintId, presentSeal = false) {
  const complaint = state.complaints?.find(c=>c.id===complaintId);
  if (!complaint || complaint.status !== 'pending') throw new Error('This claim is already resolved.');
  if (presentSeal && complaint.certified && complaint.bluff && complaint.met) { complaint.status = 'dismissed'; complaint.resolvedAt = Date.now(); }
  else refundPayment(state,complaint);
  return complaint;
}
