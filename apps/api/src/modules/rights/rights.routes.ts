import { Router } from 'express';
import type { Request, Response } from 'express';
import { AppError } from '../../http/errors.js';
import { sendOk } from '../../http/respond.js';
import { requireAuth } from '../auth/auth.middleware.js';
import * as service from './rights.service.js';
import {
  checkSchema,
  claimParamSchema,
  createClaimSchema,
  createRightsSchema,
  docParamSchema,
  idParamSchema,
  licenseSchema,
  listRightsSchema,
  updateClaimSchema,
  updateRightsSchema,
} from './rights.schemas.js';

export const rightsRouter = Router();
rightsRouter.use(requireAuth);

rightsRouter.get('/', async (req, res) => {
  const filters = listRightsSchema.parse(req.query);
  sendOk(res, { rights: await service.listRights(req.user!.id, filters) });
});

rightsRouter.post('/', async (req, res) => {
  const input = createRightsSchema.parse(req.body);
  sendOk(res, { rights: await service.createRightsDeclaration(req.user!.id, input) }, 201);
});

rightsRouter.get('/check', async (req, res) => {
  const input = checkSchema.parse(req.query);
  sendOk(res, await service.runPublishingCheck(req.user!.id, input));
});

rightsRouter.get('/history', async (req, res) => {
  const filters = listRightsSchema.parse(req.query);
  sendOk(res, await service.history(req.user!.id, filters));
});

rightsRouter.get('/claims', async (req, res) => {
  const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
  sendOk(res, { claims: await service.listClaims(req.user!.id, projectId) });
});

rightsRouter.post('/claims', async (req, res) => {
  const input = createClaimSchema.parse(req.body);
  sendOk(res, { claim: await service.createClaim(req.user!.id, input) }, 201);
});

rightsRouter.patch('/claims/:id', async (req, res) => {
  const { id } = claimParamSchema.parse(req.params);
  const input = updateClaimSchema.parse(req.body);
  sendOk(res, { claim: await service.updateClaim(req.user!.id, id, input) });
});

rightsRouter.get('/:id', async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  sendOk(res, { rights: await service.getRights(req.user!.id, id) });
});

rightsRouter.patch('/:id', async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  const input = updateRightsSchema.parse(req.body);
  sendOk(res, { rights: await service.updateRightsDeclaration(req.user!.id, id, input) });
});

rightsRouter.post('/:id/licenses', async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  const input = licenseSchema.parse(req.body);
  sendOk(res, { rights: await service.addLicense(req.user!.id, id, input) }, 201);
});

rightsRouter.patch('/:id/licenses/:licenseId', async (req, res) => {
  const { id } = idParamSchema.parse({ id: req.params.id });
  const licenseId = Number(req.params.licenseId);
  if (!Number.isInteger(licenseId) || licenseId <= 0) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid license id');
  const input = licenseSchema.parse(req.body);
  sendOk(res, { rights: await service.editLicense(req.user!.id, id, licenseId, input) });
});

rightsRouter.delete('/:id/documents/:docId', async (req, res) => {
  const { id, docId } = docParamSchema.parse(req.params);
  await service.removeRightsDocument(req.user!.id, id, docId);
  sendOk(res, { deleted: true });
});

// Raw document upload handler (registered before json parser).
export async function handleRightsDocumentUpload(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid rights id');
  // req.user is set by requireAuth which we need to run; but this handler is mounted early.
  // We'll rely on cookie/bearer parsing via auth middleware logic inline is complex; easier to
  // verify here by importing auth verify - but simpler: mount after a lightweight auth check.
  const filename = (req.headers['x-filename'] as string) || 'document';
  const mimeType = (req.headers['content-type'] as string) || null;
  if (!req.user) throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
  const doc = await service.uploadRightsDocument({ userId: req.user.id, rightsId: id, filename, mimeType, body: req });
  sendOk(res, { document: doc }, 201);
}
