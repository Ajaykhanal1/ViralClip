'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Notification, NotificationStateResult } from '@viralclip/shared';
import * as api from '@/lib/account-api';

const severityStyle: Record<Notification['severity'], string> = {
  info: 'border-ink/15 bg-panel/40',
  success: 'border-green-300 bg-green-50',
  warning: 'border-amber-300 bg-amber-50',
  error: 'border-red-300 bg-red-50',
};

function when(value: string): string {
  return new Date(value).toLocaleString();
}

export function NotificationsView() {
  const [snapshot, setSnapshot] = useState<NotificationStateResult | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await api.notificationState());
      setError(null);
    } catch (cause) {
      setError(api.message(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(action: () => Promise<NotificationStateResult>) {
    setBusy(true);
    try {
      setSnapshot(await action());
      setError(null);
    } catch (cause) {
      setError(api.message(cause));
    } finally {
      setBusy(false);
    }
  }

  const notifications = (snapshot?.notifications ?? []).filter((item) => !unreadOnly || !item.readAt);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3 border-b border-ink/15 pb-4">
        <div>
          <h1 className="font-serif text-2xl">Notifications</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {snapshot ? `${snapshot.unreadCount} unread` : 'Loading notifications…'}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setUnreadOnly((value) => !value)}
            className="border border-ink/20 px-3 py-1.5 text-xs hover:border-accent hover:text-accent"
          >
            {unreadOnly ? 'Show all' : 'Unread only'}
          </button>
          <button
            type="button"
            onClick={() => void run(() => api.markAllNotificationsRead())}
            disabled={busy || !snapshot?.unreadCount}
            className="bg-ink px-3 py-1.5 text-xs font-semibold text-paper hover:bg-accent disabled:opacity-50"
          >
            Mark all read
          </button>
        </div>
      </header>

      {error ? <p className="border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}

      <div className="space-y-2">
        {notifications.map((item) => (
          <article key={item.id} className={`border p-4 ${severityStyle[item.severity]}`}>
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-serif text-base">{item.title}</h2>
                  {!item.readAt ? <span className="bg-accent px-1.5 py-0.5 text-[10px] font-bold text-white">NEW</span> : null}
                  <span className="font-mono text-[10px] uppercase tracking-widest text-ink-soft">{item.type.replaceAll('_', ' ')}</span>
                </div>
                <p className="mt-1 text-sm">{item.message}</p>
                <p className="mt-2 font-mono text-[11px] text-ink-soft">{when(item.createdAt)}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                {!item.readAt ? (
                  <button
                    type="button"
                    onClick={() => void run(() => api.markNotificationRead(item.id))}
                    disabled={busy}
                    className="border border-ink/20 px-2 py-1 text-xs hover:border-accent hover:text-accent disabled:opacity-50"
                  >
                    Mark read
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void run(() => api.deleteNotification(item.id))}
                  disabled={busy}
                  className="border border-ink/20 px-2 py-1 text-xs hover:border-red-500 hover:text-red-700 disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
          </article>
        ))}
        {snapshot && notifications.length === 0 ? (
          <p className="border border-ink/15 bg-panel/40 p-6 text-center text-sm text-ink-soft">
            {unreadOnly ? 'No unread notifications.' : 'No notifications yet.'}
          </p>
        ) : null}
      </div>
    </div>
  );
}
