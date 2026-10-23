import { createContext, useContext, useEffect, useMemo, useState } from 'react';

// Products selected on the Products page, shared with Catalogue Generator, Labels and Collections.
const SelectionContext = createContext(null);
const KEY = 'pm.selection';

export function SelectionProvider({ children }) {
  const [ids, setIds] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(KEY) || '[]');
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(ids));
    } catch { /* ignore */ }
  }, [ids]);

  const value = useMemo(() => {
    const set = new Set(ids);
    return {
      ids,
      count: ids.length,
      has: (id) => set.has(id),
      toggle: (id) => setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])),
      add: (list) => setIds((cur) => [...new Set([...cur, ...list])]),
      remove: (list) => setIds((cur) => cur.filter((x) => !list.includes(x))),
      set: setIds,
      clear: () => setIds([]),
    };
  }, [ids]);

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export const useSelection = () => useContext(SelectionContext);
