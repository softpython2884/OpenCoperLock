'use client';

/**
 * Client-side auth state. Hydrates from `GET /auth/me` on mount (the session lives in
 * an httpOnly cookie), exposes the current user, and refreshes the CSRF token.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { PublicUser } from '@opencoperlock/shared/client';
import { login as apiLogin, logout as apiLogout, me, ApiError } from './api';

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
      // Bound the check so a stuck/slow network can never leave the app on "loading" forever.
      const res = await Promise.race([
        me(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new TypeError('auth timeout')), 8000)),
      ]);
      setUser(res.user);
      try {
        localStorage.setItem('ocl_user', JSON.stringify(res.user));
      } catch {
        /* storage unavailable */
      }
    } catch (err) {
      // A real HTTP response (e.g. 401) means we're logged out → no user. A network failure or
      // timeout means we're probably offline → keep the last-known user so the app still loads.
      let cached: PublicUser | null = null;
      if (!(err instanceof ApiError)) {
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
