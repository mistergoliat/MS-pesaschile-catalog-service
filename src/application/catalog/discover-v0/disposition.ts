import type { CandidateDisposition, ConstraintResult, ConstraintState, DiscoverCandidate, GroupResult, QueryInterpretation, ReadingState } from './contracts.js';

/*
 * Candidate disposition (V0.2). Retrieval relevance never enters here.
 *
 *  VERIFIED_MATCH  every required constraint is SATISFIED by its owning authority,
 *                  and every ambiguity group is SATISFIED under ALL its readings.
 *  REJECTED        sufficient evidence shows a required constraint is VIOLATED
 *                  (for a group: every reading VIOLATED or off-target).
 *  POSSIBLE_MATCH  otherwise: nothing violated, but something UNKNOWN /
 *                  UNSUPPORTED / conflicting, or satisfied under some readings only.
 *
 * UNKNOWN never becomes VIOLATED for lack of evidence, nor SATISFIED to add results.
 * VERIFIED_MATCH is "asserted by admitted projections", not human-adjudicated quality.
 */

function conjunction(states: readonly ConstraintState[]): ConstraintState {
  if (states.some((state) => state === 'VIOLATED')) return 'VIOLATED';
  if (states.every((state) => state === 'SATISFIED')) return 'SATISFIED';
  if (states.some((state) => state === 'UNKNOWN')) return 'UNKNOWN';
  return 'UNSUPPORTED';
}

/**
 * Aggregates the readings of each ambiguity group. `requirementPassed` tells
 * whether a gating relevance requirement holds for this product (text gate).
 */
export function aggregateGroups(interpretation: QueryInterpretation, results: readonly ConstraintResult[], requirementPassed: (requirementId: string) => boolean): GroupResult[] {
  return interpretation.ambiguityGroups.map((group) => {
    const readings = group.readings.map((reading) => {
      if (reading.requirementIds.some((id) => !requirementPassed(id))) return { readingId: reading.readingId, state: 'OFF_TARGET' as ReadingState, reason: 'READING_TEXT_GATE_NOT_MET' };
      const own = results.filter((result) => reading.constraintIds.includes(result.constraintId));
      const state = conjunction(own.map((result) => result.state));
      return { readingId: reading.readingId, state: state as ReadingState, reason: own.map((result) => `${result.kind}:${result.reason}`).join('; ') };
    });
    const satisfiedUnder = readings.filter((reading) => reading.state === 'SATISFIED').map((reading) => reading.readingId);
    let state: ConstraintState;
    let reason: string;
    if (readings.every((reading) => reading.state === 'SATISFIED')) {
      state = 'SATISFIED';
      reason = 'SATISFIED_UNDER_ALL_READINGS';
    } else if (readings.every((reading) => reading.state === 'VIOLATED' || reading.state === 'OFF_TARGET')) {
      state = 'VIOLATED';
      reason = `NO_READING_HOLDS:${readings.map((reading) => `${reading.readingId}=${reading.state}`).join(',')}`;
    } else {
      state = 'UNKNOWN';
      reason = `AMBIGUOUS_NEED:${readings.map((reading) => `${reading.readingId}=${reading.state}`).join(',')}`;
    }
    return { groupId: group.groupId, state, reason, satisfiedUnder, readings };
  });
}

export function dispositionOf(results: readonly ConstraintResult[], groups: readonly GroupResult[]): { disposition: CandidateDisposition; blocking: DiscoverCandidate['blocking'] } {
  const required = results.filter((result) => result.hard && !result.groupId);
  const blocking: DiscoverCandidate['blocking'] = [];
  for (const result of required) {
    if (result.state !== 'SATISFIED') blocking.push({ constraintId: result.constraintId, state: result.state, reason: result.reason, ...(result.conflict ? { conflict: result.conflict } : {}) });
  }
  for (const group of groups) {
    if (group.state !== 'SATISFIED') {
      const conflict = results.some((result) => result.groupId === group.groupId && result.conflict);
      blocking.push({ constraintId: group.groupId, state: group.state, reason: group.reason, ...(conflict ? { conflict: 'CONFLICTING_EVIDENCE' as const } : {}) });
    }
  }
  if (blocking.some((item) => item.state === 'VIOLATED')) return { disposition: 'REJECTED', blocking: blocking.filter((item) => item.state === 'VIOLATED') };
  return { disposition: blocking.length === 0 ? 'VERIFIED_MATCH' : 'POSSIBLE_MATCH', blocking };
}
