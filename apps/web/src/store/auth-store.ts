'use client';

import { create } from 'zustand';
import type { AuthUser } from '@viralclip/shared';
import * as authApi from '@/lib/auth-api';

export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'guest';

interface AuthState {
  user: AuthUser | null;
  status: AuthStatus;
  hydrate: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { email: string; displayName: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (displayName: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  resendVerification: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  status: 'idle',

  hydrate: async () => {
    if (get().status !== 'idle') return;
    set({ status: 'loading' });

    try {
      const { user } = await authApi.me();
      set({ user, status: 'authenticated' });
      return;
    } catch {
      // The access token is short-lived; a valid refresh cookie should recover the session.
    }

    try {
      const { user } = await authApi.refresh();
      set({ user, status: 'authenticated' });
    } catch {
      set({ user: null, status: 'guest' });
    }
  },

  login: async (email, password) => {
    const { user } = await authApi.login({ email, password });
    set({ user, status: 'authenticated' });
  },

  register: async (input) => {
    const { user } = await authApi.register(input);
    set({ user, status: 'authenticated' });
  },

  logout: async () => {
    try {
      await authApi.logout();
    } finally {
      set({ user: null, status: 'guest' });
    }
  },

  updateProfile: async (displayName) => {
    const { user } = await authApi.updateProfile({ displayName });
    set({ user });
  },

  changePassword: async (currentPassword, newPassword) => {
    await authApi.changePassword({ currentPassword, newPassword });
  },

  resendVerification: async () => {
    await authApi.resendVerification();
  },
}));
