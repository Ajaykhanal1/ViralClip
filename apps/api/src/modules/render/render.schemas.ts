import { z } from 'zod';

export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });
export const startSchema = z.object({ editId: z.number().int().positive() });
export const stateQuerySchema = z.object({ editId: z.coerce.number().int().positive().optional() });
