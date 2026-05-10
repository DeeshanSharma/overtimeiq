/**
 * stores/useAuthStore.ts
 * User auth profile - name, email, avatar from Supabase.
 * Set once during bootstrap, read everywhere.
 */

'use client';

import { create } from 'zustand';

interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
}

interface AuthState {
  user: UserProfile | null;
  isLoaded: boolean;

  setUser: (user: UserProfile | null) => void;
  clearUser: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoaded: false,

  setUser: (user) => set({ user, isLoaded: true }),
  clearUser: () => set({ user: null, isLoaded: true }),
}));
