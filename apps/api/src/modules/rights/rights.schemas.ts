import { z } from 'zod';

export const ownershipTypeSchema = z.enum(['original', 'licensed', 'public_domain', 'unknown']);
export const rightsStatusSchema = z.enum(['declared', 'pending_review', 'verified', 'rejected', 'expired']);
export const subjectTypeSchema = z.enum(['source_video', 'music', 'audio_asset', 'other']);
export const checkContextSchema = z.enum(['publish', 'render', 'upload_youtube', 'manual']);
export const claimStatusSchema = z.enum(['open', 'disputed', 'resolved', 'rejected']);

export const createRightsSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  sourceVideoId: z.coerce.number().int().positive().nullable().optional(),
  subjectType: subjectTypeSchema.default('source_video'),
  subjectLabel: z.string().trim().min(1).max(255),
  ownershipType: ownershipTypeSchema,
  status: rightsStatusSchema.default('declared'),
  commercialUse: z.boolean().default(false),
  derivativeWork: z.boolean().default(false),
  youtubePublication: z.boolean().default(false),
  musicRightsConfirmed: z.boolean().default(false),
  userConfirmed: z.boolean().default(false),
  permissionDetails: z.string().trim().max(4000).optional(),
  notes: z.string().trim().max(4000).optional(),
  license: z
    .object({
      licenseType: z.string().trim().min(1).max(120),
      licensor: z.string().trim().max(255).optional(),
      licenseReference: z.string().trim().max(255).optional(),
      permissionDetails: z.string().trim().max(4000).optional(),
      startsAt: z.string().date().optional(),
      expiresAt: z.string().date().optional(),
    })
    .optional(),
});

export const updateRightsSchema = z
  .object({
    subjectLabel: z.string().trim().min(1).max(255).optional(),
    ownershipType: ownershipTypeSchema.optional(),
    status: rightsStatusSchema.optional(),
    commercialUse: z.boolean().optional(),
    derivativeWork: z.boolean().optional(),
    youtubePublication: z.boolean().optional(),
    musicRightsConfirmed: z.boolean().optional(),
    userConfirmed: z.boolean().optional(),
    permissionDetails: z.string().trim().max(4000).nullable().optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Provide at least one field to update' });

export const licenseSchema = z.object({
  licenseType: z.string().trim().min(1).max(120),
  licensor: z.string().trim().max(255).optional(),
  licenseReference: z.string().trim().max(255).optional(),
  permissionDetails: z.string().trim().max(4000).optional(),
  startsAt: z.string().date().nullable().optional(),
  expiresAt: z.string().date().nullable().optional(),
});

export const listRightsSchema = z.object({
  projectId: z.coerce.number().int().positive().optional(),
  sourceVideoId: z.coerce.number().int().positive().optional(),
});

export const checkSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  sourceVideoId: z.coerce.number().int().positive().optional(),
  context: checkContextSchema.default('publish'),
});

export const createClaimSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  sourceVideoId: z.coerce.number().int().positive().nullable().optional(),
  claimant: z.string().trim().min(1).max(255),
  claimReference: z.string().trim().max(255).optional(),
  status: claimStatusSchema.default('open'),
  description: z.string().trim().max(4000).optional(),
});

export const updateClaimSchema = z.object({
  status: claimStatusSchema.optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  claimReference: z.string().trim().max(255).nullable().optional(),
}).refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Provide at least one field to update' });

export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });
export const docParamSchema = z.object({ id: z.coerce.number().int().positive(), docId: z.coerce.number().int().positive() });
export const claimParamSchema = z.object({ id: z.coerce.number().int().positive() });
