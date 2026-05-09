import type { Category, MenuItem, Offer } from '../types';
import type { MenuPopularityContext } from './menuPopularity';

export interface HomeSnapshot {
  categories: Category[];
  bestSellers: MenuItem[];
  allItems: MenuItem[];
  offers: Offer[];
  popularityContext: MenuPopularityContext;
}

interface StoredHomeSnapshot {
  savedAt: number;
  data: HomeSnapshot;
}

const HOME_SNAPSHOT_STORAGE_KEY = 'supreme-waffle-home-snapshot';
const HOME_SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1000;

function isHomeSnapshot(value: unknown): value is HomeSnapshot {
  if (!value || typeof value !== 'object') return false;

  const snapshot = value as Partial<HomeSnapshot>;

  return Array.isArray(snapshot.categories)
    && Array.isArray(snapshot.bestSellers)
    && Array.isArray(snapshot.allItems)
    && Array.isArray(snapshot.offers)
    && Boolean(snapshot.popularityContext && typeof snapshot.popularityContext === 'object');
}

export function readHomeSnapshot() {
  if (typeof window === 'undefined') return null;

  if (isHomeSnapshot(window.__HOME_PAGE_STATE__)) {
    return window.__HOME_PAGE_STATE__;
  }

  try {
    const raw = window.localStorage.getItem(HOME_SNAPSHOT_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<StoredHomeSnapshot>;
    if (
      typeof parsed?.savedAt !== 'number'
      || Date.now() - parsed.savedAt > HOME_SNAPSHOT_MAX_AGE_MS
      || !isHomeSnapshot(parsed.data)
    ) {
      window.localStorage.removeItem(HOME_SNAPSHOT_STORAGE_KEY);
      return null;
    }

    return parsed.data;
  } catch {
    return null;
  }
}

export function writeHomeSnapshot(snapshot: HomeSnapshot) {
  if (typeof window === 'undefined') return;

  try {
    const payload: StoredHomeSnapshot = {
      savedAt: Date.now(),
      data: snapshot,
    };

    window.localStorage.setItem(HOME_SNAPSHOT_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage failures in private mode or limited browsers.
  }
}

export function installHomeSnapState(snapshot: HomeSnapshot | null) {
  if (typeof window === 'undefined' || !snapshot) return;

  window.__HOME_PAGE_STATE__ = snapshot;
  window.snapSaveState = () => ({
    __HOME_PAGE_STATE__: snapshot,
  });
}
