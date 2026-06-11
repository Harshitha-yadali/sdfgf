import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
const legacyStorageKey = `sb-${projectRef}-auth-token`;
const customerStorageKey = `${legacyStorageKey}-customer`;
const staffStorageKey = `${legacyStorageKey}-staff`;

type ClientRegistry = Record<string, SupabaseClient>;

declare global {
  interface Window {
    __supremeWaffleSupabaseClients__?: ClientRegistry;
  }
}

function getClientRegistry(): ClientRegistry {
  if (typeof window === 'undefined') {
    return {};
  }

  if (!window.__supremeWaffleSupabaseClients__) {
    window.__supremeWaffleSupabaseClients__ = {};
  }

  return window.__supremeWaffleSupabaseClients__;
}

function createScopedSupabaseClient(storageKey: string) {
  const registry = getClientRegistry();
  const existingClient = registry[storageKey];
  if (existingClient) {
    return existingClient;
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storageKey,
    },
  });

  if (typeof window !== 'undefined') {
    registry[storageKey] = client;
  }

  return client;
}

function getBrowserPathname() {
  if (typeof window === 'undefined') return '/';
  return window.location.pathname;
}

export function isStaffPath(pathname: string) {
  return pathname.startsWith('/admin') || pathname.startsWith('/chef') || pathname.startsWith('/delivery');
}

export const customerSupabase = createScopedSupabaseClient(customerStorageKey);
export const staffSupabase = createScopedSupabaseClient(staffStorageKey);

export function getSupabaseClientForPath(pathname = getBrowserPathname()): SupabaseClient {
  return isStaffPath(pathname) ? staffSupabase : customerSupabase;
}

if (typeof window !== 'undefined') {
  try {
    window.localStorage.removeItem(legacyStorageKey);
  } catch {
    // Ignore localStorage access issues in restricted browsers.
  }
}

export const supabase = new Proxy(customerSupabase, {
  get(_target, prop) {
    const client = getSupabaseClientForPath();
    const value = Reflect.get(client, prop, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
}) as typeof customerSupabase;
