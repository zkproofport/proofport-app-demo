/**
 * Builds the `inputs` of a proof request and checks them before anything is
 * sent. The KProof app checks the same rules again on its side; the relay does
 * not read `inputs` at all.
 */
import type { CircuitId } from './circuits';
import { lookupCircuit } from './circuits';

export const MAX_TEXT_LENGTH = 256;
export const MIN_AGE = 1;
export const MAX_AGE = 150;

/**
 * Korean si/do names, current official forms: 전라북도 became 전북특별자치도
 * on 2024-01-18 and 강원도 became 강원특별자치도 on 2023-06-11.
 */
export const SI_DO = [
  '서울특별시', '부산광역시', '대구광역시', '인천광역시', '광주광역시', '대전광역시',
  '울산광역시', '세종특별자치시', '경기도', '강원특별자치도', '충청북도', '충청남도',
  '전북특별자치도', '전라남도', '경상북도', '경상남도', '제주특별자치도',
] as const;
export type SiDo = typeof SI_DO[number];

export type InputField = 'scope' | 'ageThreshold' | 'targetRegion';
export type InputProblem = 'empty' | 'too_long' | 'control_characters' | 'not_an_integer' | 'out_of_range' | 'unknown_region';

export class InputError extends Error {
  constructor(readonly field: InputField, readonly problem: InputProblem, message: string) {
    super(message);
    this.name = 'InputError';
  }
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/** Trimmed text: non-empty, at most 256 characters (code points), no control characters. */
export function checkText(field: 'scope' | 'targetRegion', raw: unknown): string {
  if (typeof raw !== 'string') throw new InputError(field, 'empty', `${field} must be a string`);
  const value = raw.trim();
  if (value.length === 0) throw new InputError(field, 'empty', `${field} is empty`);
  if ([...value].length > MAX_TEXT_LENGTH) throw new InputError(field, 'too_long', `${field} is longer than ${MAX_TEXT_LENGTH} characters`);
  if (CONTROL_CHARS.test(value)) throw new InputError(field, 'control_characters', `${field} contains a line break or control character`);
  return value;
}

/** An integer age between 1 and 150, given as a number or as decimal digits. */
export function checkAge(raw: unknown): number {
  let age: number;
  if (typeof raw === 'number') {
    age = raw;
  } else if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
    age = Number(raw.trim());
  } else {
    throw new InputError('ageThreshold', 'not_an_integer', `ageThreshold must be an integer between ${MIN_AGE} and ${MAX_AGE}`);
  }
  if (!Number.isSafeInteger(age)) throw new InputError('ageThreshold', 'not_an_integer', `ageThreshold must be an integer between ${MIN_AGE} and ${MAX_AGE}`);
  if (age < MIN_AGE || age > MAX_AGE) throw new InputError('ageThreshold', 'out_of_range', `ageThreshold must be between ${MIN_AGE} and ${MAX_AGE}, got ${age}`);
  return age;
}

export function checkRegion(raw: unknown): SiDo {
  const value = checkText('targetRegion', raw);
  if (!(SI_DO as readonly string[]).includes(value)) {
    throw new InputError('targetRegion', 'unknown_region', `targetRegion must be one of: ${SI_DO.join(', ')}`);
  }
  return value as SiDo;
}

export interface RequestValues {
  scope: unknown;
  ageThreshold?: unknown;
  targetRegion?: unknown;
}

/** The `inputs` object for a circuit, with exactly that circuit's fields. */
export function buildInputs(circuitId: CircuitId, values: RequestValues): Record<string, unknown> {
  const { id } = lookupCircuit(circuitId);
  const scope = checkText('scope', values.scope);
  if (id === 'mdl_kr_ownership') return { scope };
  if (id === 'mdl_kr_age') return { scope, ageThreshold: checkAge(values.ageThreshold) };
  if (id === 'mdl_kr_region') return { scope, targetRegion: checkRegion(values.targetRegion) };
  throw new Error(`No input builder for circuit '${id}'`);
}
