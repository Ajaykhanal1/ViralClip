import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { Project, ProjectActivity, ProjectStatus } from '@viralclip/shared';
import { pool } from '../../db/mysql.js';
import type { CreateProjectInput, ListProjectsInput, UpdateProjectInput } from './projects.schemas.js';

interface ProjectRow extends RowDataPacket {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  status: ProjectStatus;
  created_at: Date;
  updated_at: Date;
}

interface ActivityRow extends RowDataPacket {
  id: number;
  project_id: number;
  user_id: number;
  action: string;
  message: string;
  created_at: Date;
  project_name?: string;
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toActivity(row: ActivityRow): ProjectActivity {
  return {
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    action: row.action,
    message: row.message,
    createdAt: row.created_at.toISOString(),
  };
}

export async function insertProject(userId: number, input: CreateProjectInput): Promise<Project> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO projects (user_id, name, description) VALUES (?, ?, ?)`,
    [userId, input.name, input.description ?? null],
  );
  const project = await findProjectById(userId, result.insertId);
  if (!project) throw new Error(`Project ${result.insertId} was inserted but could not be read back`);
  await insertActivity(project.id, userId, 'created', `Created project "${project.name}"`);
  return project;
}

export async function findProjectById(userId: number, id: number): Promise<Project | null> {
  const [rows] = await pool.execute<ProjectRow[]>(
    `SELECT id, user_id, name, description, status, created_at, updated_at
       FROM projects WHERE id = ? AND user_id = ? LIMIT 1`,
    [id, userId],
  );
  return rows[0] ? toProject(rows[0]) : null;
}

export async function listProjects(
  userId: number,
  input: ListProjectsInput,
): Promise<{ projects: Project[]; total: number }> {
  const where: string[] = ['user_id = ?'];
  const params: Array<string | number> = [userId];
  if (input.status) {
    where.push('status = ?');
    params.push(input.status);
  }
  if (input.search) {
    where.push('(name LIKE ? OR description LIKE ?)');
    const q = `%${input.search}%`;
    params.push(q, q);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const order = input.sort === 'oldest' ? 'ASC' : 'DESC';

  const [countRows] = await pool.execute<Array<RowDataPacket & { total: number }>>(
    `SELECT COUNT(*) AS total FROM projects ${whereSql}`,
    params,
  );
  const total = Number(countRows[0]?.total ?? 0);

  const [rows] = await pool.execute<ProjectRow[]>(
    `SELECT id, user_id, name, description, status, created_at, updated_at
       FROM projects ${whereSql}
       ORDER BY created_at ${order}, id ${order}
       LIMIT ? OFFSET ?`,
    [...params, input.limit, input.offset],
  );
  return { projects: rows.map(toProject), total };
}

export async function updateProject(
  userId: number,
  id: number,
  input: UpdateProjectInput,
): Promise<Project | null> {
  const current = await findProjectById(userId, id);
  if (!current) return null;

  const sets: string[] = [];
  const params: Array<string | number | null> = [];
  const changes: string[] = [];

  if (input.name !== undefined && input.name !== current.name) {
    sets.push('name = ?');
    params.push(input.name);
    changes.push(`renamed to "${input.name}"`);
  }
  if (input.description !== undefined && input.description !== current.description) {
    sets.push('description = ?');
    params.push(input.description);
    changes.push('updated description');
  }
  if (input.status !== undefined && input.status !== current.status) {
    sets.push('status = ?');
    params.push(input.status);
    changes.push(`status set to ${input.status}`);
  }

  if (sets.length === 0) return current;

  await pool.execute(`UPDATE projects SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, [
    ...params,
    id,
    userId,
  ]);
  const updated = await findProjectById(userId, id);
  if (updated) await insertActivity(id, userId, 'updated', changes.join(', '));
  return updated;
}

export async function deleteProject(userId: number, id: number): Promise<boolean> {
  const [result] = await pool.execute<ResultSetHeader>(
    `DELETE FROM projects WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
  return result.affectedRows > 0;
}

export async function insertActivity(
  projectId: number,
  userId: number,
  action: string,
  message: string,
): Promise<void> {
  await pool.execute(
    `INSERT INTO project_activities (project_id, user_id, action, message) VALUES (?, ?, ?, ?)`,
    [projectId, userId, action, message],
  );
}

export async function listProjectActivities(
  userId: number,
  projectId: number,
): Promise<ProjectActivity[]> {
  const [rows] = await pool.execute<ActivityRow[]>(
    `SELECT a.id, a.project_id, a.user_id, a.action, a.message, a.created_at
       FROM project_activities a
       JOIN projects p ON p.id = a.project_id
      WHERE a.project_id = ? AND p.user_id = ?
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT 50`,
    [projectId, userId],
  );
  return rows.map(toActivity);
}
