'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ContentRights, CopyrightClaim, CopyrightEvent, Project, PublishingRightsCheck, SourceVideo } from '@viralclip/shared';
import { Card, EmptyState, Skeleton } from '@/components/ui/card';
import * as projectsApi from '@/lib/projects-api';
import * as importsApi from '@/lib/imports-api';
import * as rightsApi from '@/lib/rights-api';

function Badge({ status }: { status: string }) {
  const ok = status === 'verified' || status === 'pass' || status === 'ready';
  const bad = status === 'rejected' || status === 'expired' || status === 'blocked' || status === 'failed';
  const cls = ok ? 'border-emerald-700/40 text-emerald-800' : bad ? 'border-red-700/40 text-red-700' : 'border-ink/20 text-ink-soft';
  return <span className={`border px-2 py-0.5 text-[10px] uppercase tracking-wide ${cls}`}>{status.replace(/_/g, ' ')}</span>;
}

export function RightsView() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | ''>('');
  const [sources, setSources] = useState<SourceVideo[]>([]);
  const [rights, setRights] = useState<ContentRights[]>([]);
  const [events, setEvents] = useState<CopyrightEvent[]>([]);
  const [claims, setClaims] = useState<CopyrightClaim[]>([]);
  const [check, setCheck] = useState<PublishingRightsCheck | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [form, setForm] = useState({
    sourceVideoId: '' as '' | number,
    subjectType: 'source_video' as 'source_video' | 'music' | 'audio_asset' | 'other',
    subjectLabel: '',
    ownershipType: 'original' as 'original' | 'licensed' | 'public_domain' | 'unknown',
    status: 'declared' as 'declared' | 'pending_review' | 'verified' | 'rejected' | 'expired',
    commercialUse: false,
    derivativeWork: false,
    youtubePublication: false,
    musicRightsConfirmed: false,
    userConfirmed: false,
    permissionDetails: '',
    notes: '',
    licenseType: '',
    licensor: '',
    licenseReference: '',
    licenseExpiresAt: '',
  });

  async function loadAll(pid: number | '') {
    if (typeof pid !== 'number') { setSources([]); setRights([]); setEvents([]); setClaims([]); return; }
    const [s, r, h, c] = await Promise.all([
      importsApi.listSources(pid),
      rightsApi.listRights({ projectId: pid }),
      rightsApi.history({ projectId: pid }),
      rightsApi.listClaims(pid),
    ]);
    setSources(s.sources);
    setRights(r.rights);
    setEvents(h.events);
    setClaims(c.claims);
  }

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        const res = await projectsApi.listProjects({ sort: 'newest' });
        setProjects(res.projects);
        const pid = res.projects[0]?.id ?? '';
        setProjectId(pid);
        if (typeof pid === 'number') await loadAll(pid);
      } catch (e) { setError(rightsApi.message(e)); }
      finally { setLoading(false); }
    })();
  }, []);

  useEffect(() => { if (typeof projectId === 'number') void loadAll(projectId).catch((e) => setError(rightsApi.message(e))); }, [projectId]);

  async function submitRights(e: React.FormEvent) {
    e.preventDefault();
    if (typeof projectId !== 'number') return;
    setBusy(true); setMsg(null); setError(null);
    try {
      const payload: Record<string, unknown> = {
        projectId,
        sourceVideoId: form.sourceVideoId === '' ? null : form.sourceVideoId,
        subjectType: form.subjectType,
        subjectLabel: form.subjectLabel || (form.subjectType === 'source_video' ? 'Source video' : 'Audio asset'),
        ownershipType: form.ownershipType,
        status: form.status,
        commercialUse: form.commercialUse,
        derivativeWork: form.derivativeWork,
        youtubePublication: form.youtubePublication,
        musicRightsConfirmed: form.musicRightsConfirmed,
        userConfirmed: form.userConfirmed,
        permissionDetails: form.permissionDetails || undefined,
        notes: form.notes || undefined,
      };
      if (form.licenseType) {
        payload.license = {
          licenseType: form.licenseType,
          licensor: form.licensor || undefined,
          licenseReference: form.licenseReference || undefined,
          expiresAt: form.licenseExpiresAt || undefined,
        };
      }
      await rightsApi.createRights(payload);
      setMsg('Rights declaration saved. Status is based on your declaration and checks, not AI ownership verification.');
      setForm((f) => ({ ...f, subjectLabel: '', permissionDetails: '', notes: '', licenseType: '', licensor: '', licenseReference: '', licenseExpiresAt: '', userConfirmed: false }));
      await loadAll(projectId);
    } catch (e) { setError(rightsApi.message(e)); }
    finally { setBusy(false); }
  }

  async function toggleConfirm(r: ContentRights) {
    if (typeof projectId !== 'number') return;
    setBusy(true); setError(null);
    try { await rightsApi.updateRights(r.id, { userConfirmed: !r.userConfirmed }); await loadAll(projectId); }
    catch (e) { setError(rightsApi.message(e)); }
    finally { setBusy(false); }
  }

  async function setStatus(r: ContentRights, status: string) {
    if (typeof projectId !== 'number') return;
    setBusy(true); setError(null);
    try { await rightsApi.updateRights(r.id, { status }); await loadAll(projectId); }
    catch (e) { setError(rightsApi.message(e)); }
    finally { setBusy(false); }
  }

  async function addLicense(r: ContentRights, fd: FormData) {
    if (typeof projectId !== 'number') return;
    setBusy(true); setError(null);
    try {
      await rightsApi.addLicense(r.id, {
        licenseType: String(fd.get('licenseType') || ''),
        licensor: String(fd.get('licensor') || '') || undefined,
        licenseReference: String(fd.get('licenseReference') || '') || undefined,
        permissionDetails: String(fd.get('permissionDetails') || '') || undefined,
        expiresAt: String(fd.get('expiresAt') || '') || null,
      });
      await loadAll(projectId);
    } catch (e) { setError(rightsApi.message(e)); }
    finally { setBusy(false); }
  }

  async function uploadDoc(r: ContentRights, file: File) {
    if (typeof projectId !== 'number') return;
    setBusy(true); setError(null);
    try { await rightsApi.uploadDocument(r.id, file); await loadAll(projectId); }
    catch (e) { setError(rightsApi.message(e)); }
    finally { setBusy(false); }
  }

  async function runCheckNow() {
    if (typeof projectId !== 'number') return;
    setBusy(true); setError(null);
    try { setCheck(await rightsApi.runCheck({ projectId, context: 'publish' })); await loadAll(projectId); }
    catch (e) { setError(rightsApi.message(e)); }
    finally { setBusy(false); }
  }

  async function submitClaim(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (typeof projectId !== 'number') return;
    const fd = new FormData(e.currentTarget);
    setBusy(true); setError(null);
    try {
      await rightsApi.createClaim({ projectId, claimant: String(fd.get('claimant') || ''), claimReference: String(fd.get('claimReference') || '') || undefined, description: String(fd.get('description') || '') || undefined });
      e.currentTarget.reset();
      await loadAll(projectId);
    } catch (e) { setError(rightsApi.message(e)); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-64" /></div>;
  if (projects.length === 0) {
    return <EmptyState title="Create a project first" body="Rights declarations are managed per project." action={<a href="/projects?new=1" className="bg-ink px-4 py-2 text-xs font-semibold text-paper">Create project</a>} />;
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink-soft">Compliance</p>
        <h1 className="mt-2 font-serif text-4xl tracking-tight">Copyright & rights</h1>
        <p className="mt-2 max-w-3xl text-sm text-ink-soft">
          Declare ownership and permissions before publishing. Risk checks are not legal verification and do not
          guarantee copyright-free results. Edits (cropping, subtitles, filters) do not remove copyright.
        </p>
      </div>

      {error ? <p className="border border-red-700/30 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {msg ? <p className="border border-emerald-700/30 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</p> : null}

      <Card title="Project & review">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="block flex-1">
            <span className="text-xs font-medium text-ink-soft">Project</span>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : '')} className="mt-1 w-full border border-ink/20 bg-paper px-3 py-2 text-sm">
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => void runCheckNow()} disabled={busy || typeof projectId !== 'number'} className="bg-ink px-4 py-2 text-xs font-semibold text-paper hover:bg-accent disabled:opacity-50">Run publishing check</button>
        </div>
        {check ? (
          <div className={`mt-4 border p-3 text-sm ${check.allowed ? 'border-emerald-700/30 bg-emerald-50' : 'border-red-700/30 bg-red-50'}`}>
            <p className="font-medium">{check.allowed ? 'Publishing checks passed' : 'Publishing blocked'}</p>
            {!check.allowed && check.reasons.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">{check.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
            ) : <p className="mt-1 text-xs">Declared rights meet current policy checks. This is not legal verification.</p>}
          </div>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Rights declaration form">
          <form onSubmit={submitRights} className="space-y-3 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block"><span className="text-xs text-ink-soft">Subject</span>
                <select value={form.subjectType} onChange={(e) => setForm({ ...form, subjectType: e.target.value as any })} className="mt-1 w-full border border-ink/20 bg-paper px-2 py-1.5">
                  <option value="source_video">Source video</option>
                  <option value="music">Music track</option>
                  <option value="audio_asset">Audio asset</option>
                  <option value="other">Other asset</option>
                </select>
              </label>
              <label className="block"><span className="text-xs text-ink-soft">Linked source (optional)</span>
                <select value={form.sourceVideoId} onChange={(e) => setForm({ ...form, sourceVideoId: e.target.value ? Number(e.target.value) : '' })} className="mt-1 w-full border border-ink/20 bg-paper px-2 py-1.5">
                  <option value="">None / project-level</option>
                  {sources.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                </select>
              </label>
            </div>
            <label className="block"><span className="text-xs text-ink-soft">Subject label</span>
              <input value={form.subjectLabel} onChange={(e) => setForm({ ...form, subjectLabel: e.target.value })} required className="mt-1 w-full border border-ink/20 bg-paper px-2 py-1.5" placeholder="e.g. Main interview footage or Background track name" />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block"><span className="text-xs text-ink-soft">Ownership</span>
                <select value={form.ownershipType} onChange={(e) => setForm({ ...form, ownershipType: e.target.value as any })} className="mt-1 w-full border border-ink/20 bg-paper px-2 py-1.5">
                  <option value="original">Original (owned by you)</option>
                  <option value="licensed">Licensed</option>
                  <option value="public_domain">Public domain</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
              <label className="block"><span className="text-xs text-ink-soft">Verification status</span>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as any })} className="mt-1 w-full border border-ink/20 bg-paper px-2 py-1.5">
                  <option value="declared">Declared</option>
                  <option value="pending_review">Pending review</option>
                  <option value="verified">Verified</option>
                  <option value="rejected">Rejected</option>
                </select>
              </label>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 text-xs">
              {([['commercialUse','Commercial-use permission'],['derivativeWork','Derivative-work permission'],['youtubePublication','YouTube publication permission'],['musicRightsConfirmed','Music/audio rights confirmed'],['userConfirmed','I confirm this rights declaration']] as const).map(([k,label]) => (
                <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={(form as any)[k]} onChange={(e) => setForm({ ...form, [k]: e.target.checked })} />{label}</label>
              ))}
            </div>
            <label className="block"><span className="text-xs text-ink-soft">Permission / source details</span>
              <textarea value={form.permissionDetails} onChange={(e) => setForm({ ...form, permissionDetails: e.target.value })} rows={2} className="mt-1 w-full border border-ink/20 bg-paper px-2 py-1.5" />
            </label>
            <div className="border-t border-ink/10 pt-3">
              <p className="text-xs font-medium">License details (optional, recommended for licensed content)</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <input value={form.licenseType} onChange={(e) => setForm({ ...form, licenseType: e.target.value })} placeholder="License type" className="border border-ink/20 bg-paper px-2 py-1.5" />
                <input value={form.licensor} onChange={(e) => setForm({ ...form, licensor: e.target.value })} placeholder="Licensor" className="border border-ink/20 bg-paper px-2 py-1.5" />
                <input value={form.licenseReference} onChange={(e) => setForm({ ...form, licenseReference: e.target.value })} placeholder="License/reference ID" className="border border-ink/20 bg-paper px-2 py-1.5" />
                <input type="date" value={form.licenseExpiresAt} onChange={(e) => setForm({ ...form, licenseExpiresAt: e.target.value })} className="border border-ink/20 bg-paper px-2 py-1.5" title="License expiry date" />
              </div>
            </div>
            <button type="submit" disabled={busy || !form.subjectLabel} className="bg-ink px-4 py-2 text-xs font-semibold text-paper hover:bg-accent disabled:opacity-50">Save declaration</button>
            {form.ownershipType === 'unknown' ? <p className="text-xs text-amber-800">Unknown ownership will block publishing until rights are established and confirmed. It is not treated as authorized.</p> : null}
          </form>
        </Card>

        <Card title="Asset rights manager & declarations">
          {rights.length === 0 ? <p className="text-sm text-ink-soft">No rights declarations yet. Add source and music/audio asset rights.</p> : (
            <ul className="space-y-4">
              {rights.map((r) => (
                <li key={r.id} className="border border-ink/10 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{r.subjectLabel}</p>
                    <Badge status={r.status} />
                    <span className="border border-ink/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink-soft">{r.ownershipType.replace(/_/g,' ')}</span>
                    <span className="border border-ink/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink-soft">{r.subjectType.replace(/_/g,' ')}</span>
                  </div>
                  <p className="mt-1 text-xs text-ink-soft">
                    Permissions: commercial {r.commercialUse?'yes':'no'} · derivative {r.derivativeWork?'yes':'no'} · YouTube {r.youtubePublication?'yes':'no'} · music confirmed {r.musicRightsConfirmed?'yes':'no'} · user confirmed {r.userConfirmed?'yes':'no'}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" onClick={() => void toggleConfirm(r)} className="border border-ink/20 px-2 py-1 text-[11px]">{r.userConfirmed?'Unconfirm':'Confirm declaration'}</button>
                    <select value={r.status} onChange={(e) => void setStatus(r, e.target.value)} className="border border-ink/20 bg-paper px-2 py-1 text-[11px]">
                      {['declared','pending_review','verified','rejected','expired'].map((s)=><option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
                    </select>
                  </div>
                  <div className="mt-3 space-y-2">
                    <p className="text-xs font-medium">Licenses</p>
                    {r.licenses.length === 0 ? <p className="text-xs text-ink-soft">None</p> : r.licenses.map((l) => (
                      <p key={l.id} className="text-xs text-ink-soft">{l.licenseType} {l.licensor?`· ${l.licensor}`:''} {l.expiresAt?`· expires ${l.expiresAt}`:''}</p>
                    ))}
                    <form onSubmit={(e) => { e.preventDefault(); void addLicense(r, new FormData(e.currentTarget)); e.currentTarget.reset(); }} className="flex flex-wrap gap-2">
                      <input name="licenseType" placeholder="License type" required className="border border-ink/20 bg-paper px-2 py-1 text-xs" />
                      <input name="licensor" placeholder="Licensor" className="border border-ink/20 bg-paper px-2 py-1 text-xs" />
                      <input name="licenseReference" placeholder="Reference" className="border border-ink/20 bg-paper px-2 py-1 text-xs" />
                      <input name="expiresAt" type="date" className="border border-ink/20 bg-paper px-2 py-1 text-xs" />
                      <button type="submit" className="border border-ink/20 px-2 py-1 text-xs">Add license</button>
                    </form>
                  </div>
                  <div className="mt-3 space-y-2">
                    <p className="text-xs font-medium">Rights documents</p>
                    {r.documents.length === 0 ? <p className="text-xs text-ink-soft">No documents uploaded.</p> : r.documents.map((d) => (
                      <p key={d.id} className="text-xs text-ink-soft">{d.originalFilename} {d.sizeBytes?`(${d.sizeBytes} bytes)`:''}</p>
                    ))}
                    <label className="inline-block border border-ink/20 px-2 py-1 text-xs cursor-pointer hover:border-accent">
                      Upload document (PDF/PNG/JPG/WEBP)
                      <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value=''; if (f) void uploadDoc(r,f); }} />
                    </label>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Copyright history">
          {events.length === 0 ? <p className="text-sm text-ink-soft">No rights events yet.</p> : (
            <ul className="space-y-2 text-xs">
              {events.slice(0,20).map((ev) => (
                <li key={ev.id} className="border-l-2 border-accent/30 pl-2">
                  <p><span className="font-medium">{ev.eventType.replace(/_/g,' ')}</span> · actor #{ev.actorId} · {new Date(ev.createdAt).toLocaleString()}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Copyright claims">
          <form onSubmit={submitClaim} className="mb-4 space-y-2">
            <input name="claimant" required placeholder="Claimant" className="w-full border border-ink/20 bg-paper px-2 py-1.5 text-sm" />
            <input name="claimReference" placeholder="Claim reference (optional)" className="w-full border border-ink/20 bg-paper px-2 py-1.5 text-sm" />
            <textarea name="description" placeholder="Description" rows={2} className="w-full border border-ink/20 bg-paper px-2 py-1.5 text-sm" />
            <button type="submit" disabled={busy} className="border border-ink/20 px-3 py-1.5 text-xs font-medium">Record claim</button>
          </form>
          {claims.length === 0 ? <p className="text-sm text-ink-soft">No claims recorded.</p> : (
            <ul className="space-y-2 text-xs">{claims.map((c) => <li key={c.id} className="border border-ink/10 p-2"><p className="font-medium">{c.claimant} <Badge status={c.status} /></p>{c.description?<p className="text-ink-soft">{c.description}</p>:null}</li>)}</ul>
          )}
        </Card>
      </div>

      <p className="text-xs text-ink-soft">Policy: unknown ownership is never treated as authorized. Cropping, mirroring, subtitles, speed changes, and filters do not remove copyright. Public YouTube videos are not automatically reusable.</p>
    </div>
  );
}
