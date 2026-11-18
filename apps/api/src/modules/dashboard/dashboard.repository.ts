import type { RowDataPacket } from 'mysql2/promise';
import type { DashboardStats, Project, ProjectStatus } from '@viralclip/shared';
import { pool } from '../../db/mysql.js';

interface CountRow extends RowDataPacket {
  total: number;
}
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
  project_name: string;
}
interface JobRow extends RowDataPacket {
  id: number;
  name: string;
  status: string;
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

async function count(sql: string, params: Array<string | number>): Promise<number> {
  const [rows] = await pool.execute<CountRow[]>(sql, params);
  return Number(rows[0]?.total ?? 0);
}

export async function getDashboardStats(userId: number): Promise<DashboardStats> {
  const [projects, videos, clips, rendered, recentProjectRows, activityRows, projectJobs, videoJobs, clipJobs] =
    await Promise.all([
      count(`SELECT COUNT(*) AS total FROM projects WHERE user_id = ?`, [userId]),
      count(
        `SELECT COUNT(*) AS total FROM videos v
          JOIN projects p ON p.id = v.project_id WHERE p.user_id = ?`,
        [userId],
      ),
      count(
        `SELECT COUNT(*) AS total FROM clips c
          JOIN videos v ON v.id = c.video_id
          JOIN projects p ON p.id = v.project_id WHERE p.user_id = ?`,
        [userId],
      ),
      count(
        `SELECT COUNT(*) AS total FROM clips c
          JOIN videos v ON v.id = c.video_id
          JOIN projects p ON p.id = v.project_id
         WHERE p.user_id = ? AND c.status = 'ready'`,
        [userId],
      ),
      pool.execute<ProjectRow[]>(
        `SELECT id, user_id, name, description, status, created_at, updated_at
           FROM projects WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 5`,
        [userId],
      ),
      pool.execute<ActivityRow[]>(
        `SELECT a.id, a.project_id, a.user_id, a.action, a.message, a.created_at, p.name AS project_name
           FROM project_activities a
           JOIN projects p ON p.id = a.project_id
          WHERE p.user_id = ?
          ORDER BY a.created_at DESC, a.id DESC LIMIT 8`,
        [userId],
      ),
      pool.execute<JobRow[]>(
        `SELECT id, name, status FROM projects
          WHERE user_id = ? AND status = 'processing' ORDER BY updated_at DESC LIMIT 10`,
        [userId],
      ),
      pool.execute<JobRow[]>(
        `SELECT v.id, v.original_filename AS name, v.status
           FROM videos v JOIN projects p ON p.id = v.project_id
          WHERE p.user_id = ? AND v.status = 'processing' ORDER BY v.updated_at DESC LIMIT 10`,
        [userId],
      ),
      pool.execute<JobRow[]>(
        `SELECT c.id, c.title AS name, c.status
           FROM clips c
           JOIN videos v ON v.id = c.video_id
           JOIN projects p ON p.id = v.project_id
          WHERE p.user_id = ? AND c.status = 'processing' ORDER BY c.updated_at DESC LIMIT 10`,
        [userId],
      ),
    ]);

  return {
    totalProjects: projects,
    totalImportedVideos: videos,
    totalGeneratedClips: clips,
    totalRenderedShorts: rendered,
    recentProjects: recentProjectRows[0].map(toProject),
    recentActivities: activityRows[0].map((row) => ({
      id: row.id,
      projectId: row.project_id,
      userId: row.user_id,
      action: row.action,
      message: row.message,
      createdAt: row.created_at.toISOString(),
      projectName: row.project_name,
    })),
    processingJobs: [
      ...projectJobs[0].map((r) => ({ type: 'project' as const, id: r.id, name: r.name, status: r.status })),
      ...videoJobs[0].map((r) => ({ type: 'video' as const, id: r.id, name: r.name, status: r.status })),
      ...clipJobs[0].map((r) => ({ type: 'clip' as const, id: r.id, name: r.name, status: r.status })),
    ],
  };
}
