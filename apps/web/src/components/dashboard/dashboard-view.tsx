'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { DashboardStats } from '@viralclip/shared';
import { Card, EmptyState, Skeleton, StatCard } from '@/components/ui/card';
import * as api from '@/lib/projects-api';
import { useAuthStore } from '@/store/auth-store';

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

export function DashboardView() {
  const user = useAuthStore((s) => s.user);
  const [data, setData] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await api.getDashboard());
    } catch (e) {
      setError(api.message(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function quickCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      await api.createProject({ name: name.trim(), description: desc.trim() || undefined });
      setName('');
      setDesc('');
      await load();
    } catch (e) {
      setCreateError(api.message(e));
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <EmptyState
        title="Could not load dashboard"
        body={error ?? 'Something went wrong.'}
        action={
          <button type="button" onClick={() => void load()} className="bg-ink px-4 py-2 text-xs font-semibold text-paper">
            Try again
          </button>
        }
      />
    );
  }

  const usage = [
    { label: 'Projects', value: data.totalProjects },
    { label: 'Imported videos', value: data.totalImportedVideos },
    { label: 'Generated clips', value: data.totalGeneratedClips },
    { label: 'Rendered Shorts', value: data.totalRenderedShorts },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink-soft">Workspace</p>
          <h1 className="mt-2 font-serif text-4xl tracking-tight">Welcome{user ? `, ${user.displayName}` : ''}</h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-soft">
            Create projects, track imports and clips, and see what is processing right now.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total projects" value={data.totalProjects} />
        <StatCard label="Imported videos" value={data.totalImportedVideos} />
        <StatCard label="Generated clips" value={data.totalGeneratedClips} />
        <StatCard label="Rendered Shorts" value={data.totalRenderedShorts} hint="Clips ready for export" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card
          title="Recent projects"
          action={
            <Link href="/projects" className="text-xs font-medium text-accent hover:underline">
              View all
            </Link>
          }
        >
          {data.recentProjects.length === 0 ? (
            <EmptyState
              title="No projects yet"
              body="Create your first project to start organizing videos and clips."
              action={
                <Link href="/projects?new=1" className="bg-ink px-4 py-2 text-xs font-semibold text-paper">
                  Create project
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-ink/10">
              {data.recentProjects.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <Link href={`/projects/${p.id}`} className="font-medium hover:text-accent">
                      {p.name}
                    </Link>
                    <p className="truncate text-xs text-ink-soft">
                      {p.description || 'No description'} · Updated {timeAgo(p.updatedAt)}
                    </p>
                  </div>
                  <span className="shrink-0 border border-ink/15 px-2 py-0.5 text-[11px] uppercase tracking-wide text-ink-soft">
                    {p.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Quick create">
          <form onSubmit={quickCreate} className="space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-ink-soft">Project name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={200}
                className="mt-1 w-full border border-ink/20 bg-paper px-3 py-2 text-sm outline-none focus:border-accent"
                placeholder="Summer campaign clips"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-ink-soft">Description (optional)</span>
              <textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                maxLength={4000}
                rows={3}
                className="mt-1 w-full border border-ink/20 bg-paper px-3 py-2 text-sm outline-none focus:border-accent"
                placeholder="What is this project for?"
              />
            </label>
            {createError ? <p className="text-xs text-red-700">{createError}</p> : null}
            <button
              type="submit"
              disabled={creating || !name.trim()}
              className="w-full bg-ink px-4 py-2 text-xs font-semibold text-paper hover:bg-accent disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create project'}
            </button>
          </form>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Recent activity">
          {data.recentActivities.length === 0 ? (
            <p className="text-sm text-ink-soft">No activity yet. Actions on your projects will appear here.</p>
          ) : (
            <ul className="space-y-3">
              {data.recentActivities.map((a) => (
                <li key={a.id} className="text-sm">
                  <p>
                    <span className="font-medium">{a.projectName}</span>{' '}
                    <span className="text-ink-soft">{a.message}</span>
                  </p>
                  <p className="text-xs text-ink-soft">{timeAgo(a.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Processing jobs">
          {data.processingJobs.length === 0 ? (
            <p className="text-sm text-ink-soft">Nothing processing right now.</p>
          ) : (
            <ul className="space-y-2">
              {data.processingJobs.map((j) => (
                <li key={`${j.type}-${j.id}`} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="uppercase text-[10px] tracking-wide text-ink-soft">{j.type}</span> {j.name}
                  </span>
                  <span className="shrink-0 text-xs text-accent">{j.status}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Usage statistics">
          <dl className="grid grid-cols-2 gap-3">
            {usage.map((u) => (
              <div key={u.label} className="border border-ink/10 p-3">
                <dt className="text-xs text-ink-soft">{u.label}</dt>
                <dd className="mt-1 text-xl font-semibold">{u.value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </div>
  );
}
