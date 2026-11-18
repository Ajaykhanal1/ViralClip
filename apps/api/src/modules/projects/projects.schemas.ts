import { z } from 'zod';

export const projectStatusSchema = z.enum(['draft', 'processing', 'ready', 'failed']);

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, 'Enter a project name').max(200),
  description: z.string().trim().max(4000).optional(),
});

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    status: projectStatusSchema.optional(),
  })
  .refine((v) => v.name !== undefined || v.description !== undefined || v.status !== undefined, {
    message: 'Provide at least one field to update',
  });

export const listProjectsSchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: projectStatusSchema.optional(),
  sort: z.enum(['newest', 'oldest']).default('newest'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const projectIdSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ListProjectsInput = z.infer<typeof listProjectsSchema>;
