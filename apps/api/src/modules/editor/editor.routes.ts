import { Router } from 'express';
import { sendOk } from '../../http/respond.js';
import { requireAuth } from '../auth/auth.middleware.js';
import * as service from './editor.service.js';
import { assetSchema, draftParamSchema, idParamSchema, saveTimelineSchema, versionSchema } from './editor.schemas.js';

export const editorRouter = Router();
editorRouter.use(requireAuth);

editorRouter.get('/drafts/:draftId', (req, res) => {
  const { draftId } = draftParamSchema.parse(req.params);
  sendOk(res, service.load(req.user!.id, draftId));
});

editorRouter.put('/edits/:id', async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  const { timeline } = saveTimelineSchema.parse(req.body);
  sendOk(res, await service.save(req.user!.id, id, timeline));
});

editorRouter.post('/edits/:id/versions', async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  const { label } = versionSchema.parse(req.body ?? {});
  sendOk(res, await service.createVersion(req.user!.id, id, label), 201);
});

editorRouter.get('/edits/:id/versions', async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  sendOk(res, await service.listVersions(req.user!.id, id));
});

editorRouter.post('/edits/:id/versions/:versionId/restore', async (req, res) => {
  const { id, versionId } = idParamSchema.extend({ versionId: idParamSchema.shape.id }).parse(req.params);
  sendOk(res, await service.restoreVersion(req.user!.id, id, versionId));
});

editorRouter.post('/edits/:id/assets', async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  sendOk(res, await service.addAsset(req.user!.id, id, assetSchema.parse(req.body)), 201);
});

editorRouter.delete('/edits/:id/assets/:assetId', async (req, res) => {
  const { id, assetId } = idParamSchema.extend({ assetId: idParamSchema.shape.id }).parse(req.params);
  sendOk(res, await service.removeAsset(req.user!.id, id, assetId));
});

editorRouter.post('/edits/:id/export', async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  sendOk(res, await service.requestExport(req.user!.id, id), 202);
});
