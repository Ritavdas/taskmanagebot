import { z } from 'zod';

export const PRIORITY_CODES = ['P0', 'P1', 'P2', 'P3', 'P4'] as const;
export const PriorityCodeSchema = z.enum(PRIORITY_CODES);
export type PriorityCode = z.infer<typeof PriorityCodeSchema>;

export const DEFAULT_AREAS = [
  'Professional Work',
  'Content Creation',
  'Meetup/Community',
  'Personal Admin',
  'Relationship/Family',
  'Health/Fitness',
] as const;
/** @deprecated Use DEFAULT_AREAS for bootstrap or LinearAdapter.listAreas() for live. */
export const AREAS = DEFAULT_AREAS;
export const AreaSchema = z.enum(DEFAULT_AREAS);
export type Area = z.infer<typeof AreaSchema>;

const PRIORITY_TO_NUM: Record<PriorityCode, number> = {
  P0: 1,
  P1: 2,
  P2: 3,
  P3: 4,
  P4: 0,
};

const NUM_TO_PRIORITY: Record<number, PriorityCode> = {
  1: 'P0',
  2: 'P1',
  3: 'P2',
  4: 'P3',
  0: 'P4',
};

const PRIORITY_ALIASES: Record<string, PriorityCode> = {
  p0: 'P0', urgent: 'P0', critical: 'P0',
  p1: 'P1', high: 'P1', important: 'P1',
  p2: 'P2', normal: 'P2', medium: 'P2', default: 'P2',
  p3: 'P3', low: 'P3', someday: 'P3',
  p4: 'P4', none: 'P4', 'no priority': 'P4',
};

export function parsePriority(input: string | number | null | undefined): PriorityCode | undefined {
  if (input === null || input === undefined || input === '') return undefined;
  if (typeof input === 'number') {
    const code = NUM_TO_PRIORITY[input];
    if (!code) throw new Error(`Invalid Linear priority number "${input}". Use 0-4.`);
    return code;
  }
  const key = input.trim().toLowerCase();
  const code = PRIORITY_ALIASES[key];
  if (!code) throw new Error(`Invalid priority "${input}". Use P0, P1, P2, P3, or P4.`);
  return code;
}

export function priorityToLinearNumber(code: PriorityCode): number {
  return PRIORITY_TO_NUM[code];
}

export function priorityFromLinearNumber(n: number | null | undefined): PriorityCode | undefined {
  if (n === null || n === undefined) return undefined;
  return NUM_TO_PRIORITY[n];
}

export interface Task {
  id: string;
  identifier: string;
  title: string;
  stateName: string;
  stateType: string;
  areaName: string | null;
  dueDate: string | null;
  priority: PriorityCode | undefined;
  priorityLabel: string | null;
}

export const TaskInputSchema = z.object({
  title: z.string().min(1),
  area: z.string().nullable(),
  priority: PriorityCodeSchema.nullable(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  context: z.string().nullable(),
});
export type TaskInput = z.infer<typeof TaskInputSchema>;
