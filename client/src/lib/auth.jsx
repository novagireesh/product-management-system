import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, setupRequired: false, branding: null });

  const refresh = useCallback(async () => {
    try {
      const s = await api('/auth/status');
      setState({ loading: false, user: s.user, setupRequired: s.setupRequired, branding: s.branding });
      return s;
    } catch {
      setState((prev) => ({ ...prev, loading: false }));
      return null;
    }
  }, []);

  useEffect(() => {
    refresh();
    const onUnauthorized = () => setState((prev) => ({ ...prev, user: null }));
    window.addEventListener('pm:unauthorized', onUnauthorized);
    return () => window.removeEventListener('pm:unauthorized', onUnauthorized);
  }, [refresh]);

  const value = useMemo(() => {
    const perms = new Set(state.user?.permissions || []);
    return {
      ...state,
      refresh,
      can: (...keys) => keys.some((k) => perms.has(k)),
      login: async (username, password) => {
        await api('/auth/login', { method: 'POST', body: { username, password } });
        return refresh();
      },
      logout: async () => {
        await api('/auth/logout', { method: 'POST' }).catch(() => {});
        setState((prev) => ({ ...prev, user: null }));
      },
      setBranding: (branding) => setState((prev) => ({ ...prev, branding: { ...prev.branding, ...branding } })),
    };
  }, [state, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
