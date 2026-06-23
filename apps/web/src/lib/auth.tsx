'use client';

/**
 * Client-side auth state. Hydrates from `GET /auth/me` on mount (the session lives in
 * an httpOnly cookie), exposes the current user, and refreshes the CSRF token.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { PublicUser } from '@opencoperlock/shared/client';
import { login as apiLogin, logout as apiLogout, me } from './api';

interface AuthState {
  user: PublicUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string, totp?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await me();
      setUser(res.user);
      try {
        localStorage.setItem('ocl_user', JSON.stringify(res.user));
      } catch {
        /* storage unavailable */
      }
    } catch {
      // Offline: keep the last-known user so the app still loads (read-only / queue uploads).
      let cached: PublicUser | null = null;
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        try {
          const raw = localStorage.getItem('ocl_user');
          if (raw) cached = JSON.parse(raw) as PublicUser;
        } catch {
          /* ignore */
        }
      }
      setUser(cached);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string, totp?: string) => {
    const res = await apiLogin(email, password, totp);
    setUser(res.user);
    try {
      localStorage.setItem('ocl_user', JSON.stringify(res.user));
    } catch {
      /* ignore */
    }
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
    try {
      localStorage.removeItem('ocl_user');
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, refresh, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
