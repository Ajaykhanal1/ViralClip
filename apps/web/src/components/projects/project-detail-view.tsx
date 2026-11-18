'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Project, ProjectActivity } from '@viralclip/shared';
import { Card, EmptyState, Skeleton } from '@/components/ui/card';
import * as api from '@/lib/projects-api';

function fmt(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function ProjectDetailView({ id }: { id: number }) {
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [activities, setActivities] = useState<ProjectActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [status, setStatus] = useState<Project['status']>('draft');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getProject(id);
      setProject(res.project);
      setActivities(res.activities);
      setName(res.project.name);
      setDesc(res.project.description ?? '');
      setStatus(res.project.status);
    } catch (e) {
      setError(api.message(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!project) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const { project: updated } = await api.updateProject(id, {
        name: name.trim(),
        description: desc.trim() ? desc.trim() : null,
        status,
      });
      setProject(updated);
      setSaveMsg('Changes saved.');
      const res = await api.getProject(id);
      setActivities(res.activities);
    } catch (e) {
      setSaveMsg(api.message(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      await api.deleteProject(id);
      router.push('/projects');
      router.refresh();
    } catch (e) {
      setError(api.message(e));
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <EmptyState
        title="Project unavailable"
        body={error ?? 'Not found.'}
        action={
          <Link href="/projects" className="bg-ink px-4 py-2 text-xs font-semibold text-paper">
            Back to projects
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link href="/projects" className="text-xs text-ink-soft hover:text-accent">
            ← Projects
          </Link>
          <h1 className="mt-2 font-serif text-4xl tracking-tight">{project.name}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Status: <span className="font-medium text-ink">{project.status}</span> · Updated {fmt(project.updatedAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {confirmDelete ? (
            <>
              <button
                type="button"
                onClick={() => void remove()}
                disabled={deleting}
                className="bg-red-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Confirm delete'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="border border-ink/20 px-4 py-2 text-xs"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="border border-red-700/40 px-4 py-2 text-xs font-medium text-red-700 hover:bg-red-700 hover:text-white"
            >
              Delete project
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Card title="Project details">
          <form onSubmit={save} className="space-y-4">
            <label className="block">
              <span className="text-xs font-medium text-ink-soft">Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={200}
                className="mt-1 w-full border border-ink/20 bg-paper px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-ink-soft">Description</span>
              <textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                maxLength={4000}
                rows={4}
                className="mt-1 w-full border border-ink/20 bg-paper px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-ink-soft">Status</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as Project['status'])}
                className="mt-1 w-full border border-ink/20 bg-paper px-3 py-2 text-sm outline-none focus:border-accent"
              >
                <option value="draft">Draft</option>
                <option value="processing">Processing</option>
                <option value="ready">Ready</option>
                <option value="failed">Failed</option>
              </select>
            </label>
            {saveMsg ? <p className="text-xs text-ink-soft">{saveMsg}</p> : null}
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="bg-ink px-4 py-2 text-xs font-semibold text-paper hover:bg-accent disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </form>
        </Card>

        <Card title="Activity history">
          {activities.length === 0 ? (
            <p className="text-sm text-ink-soft">No activity recorded yet.</p>
          ) : (
            <ul className="space-y-3">
              {activities.map((a) => (
                <li key={a.id} className="border-l-2 border-accent/40 pl-3 text-sm">
                  <p className="font-medium capitalize">{a.action}</p>
                  <p className="text-ink-soft">{a.message}</p>
                  <p className="mt-0.5 text-xs text-ink-soft">{fmt(a.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
