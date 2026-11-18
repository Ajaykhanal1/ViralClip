import type { Project, ProjectActivity, ProjectListResult } from '@viralclip/shared';
import { AppError } from '../../http/errors.js';
import * as repo from './projects.repository.js';
import type { CreateProjectInput, ListProjectsInput, UpdateProjectInput } from './projects.schemas.js';

export async function createProject(userId: number, input: CreateProjectInput): Promise<Project> {
  return repo.insertProject(userId, input);
}

export async function getProjects(userId: number, input: ListProjectsInput): Promise<ProjectListResult> {
  return repo.listProjects(userId, input);
}

export async function getProject(
  userId: number,
  id: number,
): Promise<{ project: Project; activities: ProjectActivity[] }> {
  const project = await repo.findProjectById(userId, id);
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', `Project ${id} does not exist`);
  const activities = await repo.listProjectActivities(userId, id);
  return { project, activities };
}

export async function patchProject(
  userId: number,
  id: number,
  input: UpdateProjectInput,
): Promise<Project> {
  const project = await repo.updateProject(userId, id, input);
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', `Project ${id} does not exist`);
  return project;
}

export async function removeProject(userId: number, id: number): Promise<void> {
  const deleted = await repo.deleteProject(userId, id);
  if (!deleted) throw new AppError(404, 'PROJECT_NOT_FOUND', `Project ${id} does not exist`);
}
