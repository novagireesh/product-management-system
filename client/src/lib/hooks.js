import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

/** Fetch JSON from the API; re-runs when `deps` change. */
export function useApi(path, { query, deps = [], skip = false } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: !skip });
  const key = JSON.stringify([path, query]);
  const ctrl = useRef(null);

  const load = useCallback(async () => {
    if (skip || !path) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api(path, { query, signal: c.signal });
      if (!c.signal.aborted) setState({ data, error: null, loading: false });
    } catch (err) {
      if (err.name !== 'AbortError') setState((s) => ({ ...s, error: err, loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, skip, ...deps]);

  useEffect(() => {
    load();
    return () => ctrl.current?.abort();
  }, [load]);

  return { ...state, reload: load, setData: (fn) => setState((s) => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })) };
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** State persisted in localStorage (per-browser conveniences such as view mode). */
export function useStored(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : JSON.parse(raw);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch { /* storage unavailable */ }
  }, [key, value]);
  return [value, setValue];
}

export function useTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · Product Management` : 'Product Management';
  }, [title]);
}
