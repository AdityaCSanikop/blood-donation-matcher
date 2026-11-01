"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "./client";

type Loaded<T> = { path: string | null; data: T | null; meta: Record<string, unknown>; error: string | null };

/**
 * Load a resource from the API with loading / error / reload handling.
 * `loading` is derived (the loaded path differs from the requested one, or a
 * manual reload is running) so no state is set synchronously in an effect.
 */
export function useLoad<T>(path: string | null) {
  const [state, setState] = useState<Loaded<T>>({ path: null, data: null, meta: {}, error: null });
  const [reloading, setReloading] = useState(false);
  const latest = useRef(0);
  const currentPath = useRef(path);

  const fetchInto = useCallback(async (target: string) => {
    const ticket = ++latest.current;
    try {
      const result = await api<T>(target);
      if (ticket !== latest.current) return; // a newer request superseded this one
      setState({ path: target, data: result.data, meta: result.meta, error: null });
    } catch (err) {
      if (ticket !== latest.current) return;
      setState((prev) => ({ path: target, data: prev.path === target ? prev.data : null, meta: {}, error: errorMessage(err) }));
    }
  }, []);

  useEffect(() => {
    currentPath.current = path;
    if (path !== null) void fetchInto(path);
  }, [path, fetchInto]);

  // A caller may hold an older `reload` across a slow save, so read the path at call time.
  const reload = useCallback(async () => {
    const target = currentPath.current;
    if (target === null) return;
    setReloading(true);
    await fetchInto(target);
    setReloading(false);
  }, [fetchInto]);

  const current = state.path === path;
  return {
    // Keep showing the previous rows while a filter change loads (no flicker).
    data: state.data,
    meta: current ? state.meta : {},
    error: current ? state.error : null,
    loading: path !== null && (!current || reloading),
    reload,
  };
}

/** Debounce a fast-changing value (search boxes). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
