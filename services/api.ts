import type { Agent, Conversation, Role, CreateUserData, UpdateUserData } from '../types';

const API_BASE = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:4000';

const TOKEN_KEY = 'jwt_token';
export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

async function http<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(options?.headers as any || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    headers,
    ...options,
  });
  if (!res.ok) {
    if (res.status === 401) {
      try { window.dispatchEvent(new Event('unauthorized')); } catch {}
      throw new Error('Unauthorized');
    }
    let errText = await res.text().catch(() => '');
    try { const j = JSON.parse(errText); errText = j.error || errText; } catch {}
    throw new Error(errText || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

// Auth
export const login = (email: string, password: string) =>
  fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  }).then(async (res) => {
    if (!res.ok) {
      let errText = await res.text().catch(() => '');
      try { const j = JSON.parse(errText); errText = j.error || errText; } catch {}
      throw new Error(errText || `HTTP ${res.status}`);
    }
    return res.json();
  });

export const me = () => http<{ id: string; firstName: string; lastName: string; email: string }>(`/api/auth/me`);

export interface UserProfileUpdate {
  firstName?: string;
  lastName?: string;
  password?: string;
}

export const updateUserProfile = (data: UserProfileUpdate) =>
  http<{ id: string; firstName: string; lastName: string; email: string }>('/api/users/me', {
    method: 'PUT',
    body: JSON.stringify(data),
  });

// Roles
export const getRoles = () => http<Role[]>('/api/roles');

// Agents
export const getAgents = (roleId?: string) => http<Agent[]>('/api/agents?roleId=' + (roleId || ''));
export const createAgent = (data: { name: string; masterPrompt: string; model: string; roleId?: string }) =>
  http<Agent>('/api/agents', { method: 'POST', body: JSON.stringify(data) });
export const updateAgent = (id: string, data: { name: string; masterPrompt: string; model: string; roleId?: string }) =>
  http<Agent>(`/api/agents/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteAgent = (id: string) => http<void>(`/api/agents/${id}`, { method: 'DELETE' });
export const duplicateAgent = (id: string) => http<Agent>(`/api/agents/${id}/duplicate`, { method: 'POST' });

// Conversations
export const getConversations = (agentId: string) =>
  http<Conversation[]>(`/api/agents/${agentId}/conversations`);
export const replaceConversations = (agentId: string, conversations: Conversation[]) =>
  http<{ ok: boolean }>(`/api/agents/${agentId}/conversations`, { method: 'PUT', body: JSON.stringify({ conversations }) });
export const createConversation = (agentId: string, conversation: Conversation) =>
  http<Conversation>(`/api/agents/${agentId}/conversations`, { method: 'POST', body: JSON.stringify({ conversation }) });

export const getUsers = () => http<{ id: string; firstName: string; lastName: string; email: string, roles: Role[] }[]>('/api/users');

export const createUser = (data: CreateUserData) =>
  http<{ id: string; firstName: string; lastName: string; email: string; roles: Role[] }>('/api/users', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const updateUser = (userId: string, data: UpdateUserData) =>
  http<{ id: string; firstName: string; lastName: string; email: string; roles: Role[] }>(`/api/users/${userId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
