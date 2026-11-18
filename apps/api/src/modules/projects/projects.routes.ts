import { Router } from 'express';
import { sendOk } from '../../http/respond.js';
import { requireAuth } from '../auth/auth.middleware.js';
import {
  createProjectSchema,
  listProjectsSchema,
  projectIdSchema,
  updateProjectSchema,
} from './projects.schemas.js';
import * as service from './projects.service.js';

export const projectsRouter = Router();

projectsRouter.use(requireAuth);

projectsRouter.get('/', async (req, res) => {
  const input = listProjectsSchema.parse(req.query);
  sendOk(res, await service.getProjects(req.user!.id, input));
});

projectsRouter.post('/', async (req, res) => {
  const input = createProjectSchema.parse(req.body);
  const project = await service.createProject(req.user!.id, input);
  sendOk(res, { project }, 201);
});

projectsRouter.get('/:id', async (req, res) => {
  const { id } = projectIdSchema.parse(req.params);
  sendOk(res, await service.getProject(req.user!.id, id));
});

projectsRouter.patch('/:id', async (req, res) => {
  const { id } = projectIdSchema.parse(req.params);
  const input = updateProjectSchema.parse(req.body);
  const project = await service.patchProject(req.user!.id, id, input);
  sendOk(res, { project });
});

projectsRouter.delete('/:id', async (req, res) => {
  const { id } = projectIdSchema.parse(req.params);
  await service.removeProject(req.user!.id, id);
  sendOk(res, { deleted: true });
});
