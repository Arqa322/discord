import { openDB } from 'idb';
import type { ChatMessage, LocalUser, Room } from '../store/useAppStore';

const DB_NAME = 'pulsemesh-desktop';
const DB_VERSION = 1;
const APP_STATE_KEY = 'app-state';
const SESSION_KEY = 'session';

export interface PersistedWorkspace {
  profile: LocalUser | null;
  rooms: Room[];
  messages: Record<string, ChatMessage[]>;
  theme: 'dark' | 'light';
}

const dbPromise = openDB(DB_NAME, DB_VERSION, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('kv')) {
      db.createObjectStore('kv');
    }

    if (!db.objectStoreNames.contains('users')) {
      db.createObjectStore('users', { keyPath: 'email' });
    }
  },
});

export const hashPassword = (value: string) =>
  btoa(unescape(encodeURIComponent(value))).split('').reverse().join('');

export async function registerLocalUser(
  payload: Omit<LocalUser, 'id' | 'passwordHash'> & { password: string },
): Promise<{ ok: true; user: LocalUser } | { ok: false; error: string }> {
  const db = await dbPromise;
  const email = payload.email.trim().toLowerCase();
  const existing = await db.get('users', email);

  if (existing) {
    return { ok: false, error: 'Пользователь с таким email уже существует локально.' };
  }

  const user: LocalUser = {
    id: crypto.randomUUID(),
    name: payload.name.trim(),
    email,
    avatar: payload.avatar,
    color: payload.color,
    provider: payload.provider,
    status: payload.status,
    tagline: payload.tagline,
    passwordHash: hashPassword(payload.password || crypto.randomUUID()),
  };

  await db.put('users', user);
  await db.put('kv', user, SESSION_KEY);

  return { ok: true, user };
}

export async function loginLocalUser(
  email: string,
  password: string,
): Promise<{ ok: true; user: LocalUser } | { ok: false; error: string }> {
  const db = await dbPromise;
  const normalized = email.trim().toLowerCase();
  const user = await db.get('users', normalized);

  if (!user) {
    return { ok: false, error: 'Локальный аккаунт не найден. Зарегистрируйтесь на этом устройстве.' };
  }

  if (user.passwordHash !== hashPassword(password)) {
    return { ok: false, error: 'Неверный пароль для локального профиля.' };
  }

  await db.put('kv', user, SESSION_KEY);
  return { ok: true, user };
}

export async function createProviderUser(provider: LocalUser['provider']) {
  const db = await dbPromise;
  const user: LocalUser = {
    id: crypto.randomUUID(),
    name:
      provider === 'discord'
        ? 'Discord Link'
        : provider === 'google'
          ? 'Google Link'
          : provider === 'github'
            ? 'GitHub Link'
            : 'Local User',
    email: `${provider}-${Math.random().toString(36).slice(2, 8)}@local.mesh`,
    avatar: provider === 'discord' ? '🎮' : provider === 'google' ? '🟡' : provider === 'github' ? '🐙' : '🛰️',
    color: provider === 'discord' ? '#5865F2' : provider === 'google' ? '#FBBF24' : provider === 'github' ? '#94A3B8' : '#38BDF8',
    provider,
    status: 'online',
    tagline: 'Локальный профиль-посредник для децентрализованной синхронизации.',
    passwordHash: hashPassword(crypto.randomUUID()),
  };

  await db.put('users', user);
  await db.put('kv', user, SESSION_KEY);
  return user;
}

export async function loadSession(): Promise<LocalUser | null> {
  const db = await dbPromise;
  return (await db.get('kv', SESSION_KEY)) ?? null;
}

export async function clearSession() {
  const db = await dbPromise;
  await db.delete('kv', SESSION_KEY);
}

export async function saveWorkspace(workspace: PersistedWorkspace) {
  const db = await dbPromise;
  await db.put('kv', workspace, APP_STATE_KEY);
}

export async function loadWorkspace(): Promise<PersistedWorkspace | null> {
  const db = await dbPromise;
  return (await db.get('kv', APP_STATE_KEY)) ?? null;
}
