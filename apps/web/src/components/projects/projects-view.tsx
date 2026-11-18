'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { Project } from '@viralclip/shared';
import { Card, EmptyState, Skeleton } from '@/components/ui/card';
import * as api from '@/lib/projects-api';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function ProjectsView() {
  const router = useRouter();
  const params = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [showCreate, setShowCreate] = useState(params.get('new') === '1');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const query = useMemo(() => ({ search, status, sort }), [search, status, sort]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listProjects({
        search: query.search || undefined,
        status: query.status || undefined,
        sort: query.sort,
      });
      setProjects(res.projects);
      setTotal(res.total);
    } catch (e) {
      setError(api.message(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.search, query.status, query.sort]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setFormError(null);
    try {
      const { project } = await api.createProject({ name: name.trim(), description: desc.trim() || undefined });
      setName('');
      setDesc('');
      setShowCreate(false);
      if (params.get('new')) router.replace('/projects');
      router.push(`/projects/${project.id}`);
    } catch (e) {
      setFormError(api.message(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    setDeletingId(id);
    try {
      await api.deleteProject(id);
      setConfirmId(null);
      await load();
    } catch (e) {
      setError(api.message(e));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink-soft">Manage</p>
          <h1 className="mt-2 font-serif text-4xl tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-ink-soft">Create, search, and organize your video projects.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="bg-ink px-4 py-2 text-xs font-semibold text-paper hover:bg-accent"
        >
          {showCreate ? 'Close' : 'New project'}
        </button>
      </div>

      {showCreate ? (
        <Card title="Create project">
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-1">
              <span className="text-xs font-medium text-ink-soft">Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={200}
                className="mt-1 w-full border border-ink/20 bg-paper px-3 py-2 text-sm outline-none focus:border-accent"
                placeholder="Project name"
              />
            </label>
            <label className="block sm:col-span-1">
              <span className="text-xs font-medium text-ink-soft">Description</span>
              <input
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                maxLength={4000}
                className="mt-1 w-full border border-ink/20 bg-paper px-3 py-2 text-sm outline-none focus:border-accent"
                placeholder="Optional description"
              />
            </label>
            {formError ? <p className="text-xs text-red-700 sm:col-span-2">{formError}</p> : null}
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={saving || !name.trim()}
                className="bg-ink px-4 py-2 text-xs font-semibold text-paper hover:bg-accent disabled:opacity-50"
              >
                {saving ? 'Creating…' : 'Create project'}
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card>
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects"
            className="w-full border border-ink/20 bg-paper px-3 py-2 text-sm outline-none focus:border-accent md:max-w-xs"
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="border border-ink/20 bg-paper px-3 py-2 text-sm outline-none focus:border-accent"
          >
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="processing">Processing</option>
            <option value="ready">Ready</option>
            <option value="failed">Failed</option>
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as 'newest' | 'oldest')}
            className="border border-ink/20 bg-paper px-3 py-2 text-sm outline-none focus:border-accent"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
          <span className="text-xs text-ink-soft md:ml-auto">{total} total</span>
        </div>
      </Card>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          title="Could not load projects"
          body={error}
          action={
            <button type="button" onClick={() => void load()} className="bg-ink px-4 py-2 text-xs font-semibold text-paper">
              Try again
            </button>
          }
        />
      ) : projects.length === 0 ? (
        <EmptyState
          title={search || status ? 'No matching projects' : 'No projects yet'}
          body={
            search || status
              ? 'Try adjusting your search or filters.'
              : 'Create a project to start importing videos and generating clips.'
          }
          action={
            !search && !status ? (
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="bg-ink px-4 py-2 text-xs font-semibold text-paper"
              >
                Create project
              </button>
            ) : undefined
          }
        />
      ) : (
        <ul className="space-y-3">
          {projects.map((p) => (
            <li key={p.id} className="border border-ink/15 bg-panel p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/projects/${p.id}`} className="text-lg font-semibold hover:text-accent">
                      {p.name}
                    </Link>
                    <span className="border border-ink/15 px-2 py-0.5 text-[11px] uppercase tracking-wide text-ink-soft">
                      {p.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-ink-soft">{p.description || 'No description'}</p>
                  <p className="mt-2 text-xs text-ink-soft">Updated {timeAgo(p.updatedAt)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Link
                    href={`/projects/${p.id}`}
                    className="border border-ink/20 px-3 py-1.5 text-xs font-medium hover:border-accent hover:text-accent"
                  >
                    Open
                  </Link>
                  {confirmId === p.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void remove(p.id)}
                        disabled={deletingId === p.id}
                        className="bg-red-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        {deletingId === p.id ? 'Deleting…' : 'Confirm delete'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmId(null)}
                        className="border border-ink/20 px-3 py-1.5 text-xs"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmId(p.id)}
                      className="border border-ink/20 px-3 py-1.5 text-xs font-medium text-red-700 hover:border-red-700"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
