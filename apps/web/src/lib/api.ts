/**
 * Thin client for the OpenCoperLock API. Sends the session cookie (credentials:
 * 'include') and attaches the double-submit CSRF token on mutating requests. The
 * token is cached in-memory after login / `me()` and refreshed transparently.
 */
import { CSRF_HEADER, type PublicUser } from '@opencoperlock/shared/client';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Raw body (FormData) bypassing JSON serialisation. */
  formData?: FormData;
  signal?: AbortSignal;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (method !== 'GET' && csrfToken) headers[CSRF_HEADER] = csrfToken;

  let body: BodyInit | undefined;
  if (opts.formData) {
    body = opts.formData;
  } else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body,
    credentials: 'include',
    signal: opts.signal,
  });

  if (res.status === 204) return undefined as T;

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const message = isJson && payload?.error ? payload.error : `Request failed (${res.status})`;
    throw new ApiError(res.status, message, isJson ? payload?.code : undefined);
  }
  return payload as T;
}

/**
 * Upload with progress. `fetch` can't report upload progress, so this uses XMLHttpRequest
 * and calls `onProgress(0..1)` as bytes are sent. Sends the session cookie + CSRF token.
 */
export function uploadWithProgress<T>(
  path: string,
  formData: FormData,
  onProgress?: (fraction: number) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}${path}`);
    xhr.withCredentials = true;
    if (csrfToken) xhr.setRequestHeader(CSRF_HEADER, csrfToken);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      const isJson = xhr.getResponseHeader('content-type')?.includes('application/json');
      const payload = isJson && xhr.responseText ? JSON.parse(xhr.responseText) : xhr.responseText;
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload as T);
      } else {
        reject(new ApiError(xhr.status, payload?.error ?? `Upload failed (${xhr.status})`, payload?.code));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, 'Network error during upload'));
    xhr.send(formData);
  });
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData, method: 'POST' | 'PUT' = 'POST') =>
    request<T>(path, { method, formData }),
  uploadWithProgress,
  /** Build an absolute URL for a download link / blob fetch. */
  url: (path: string) => `${API_URL}${path}`,
};

// ── Auth helpers ───────────────────────────────────────────────────────────--

export interface AuthResponse {
  user: PublicUser;
  csrfToken: string;
}

export async function login(
  email: string,
  password: string,
  totp?: string,
): Promise<AuthResponse> {
  const res = await api.post<AuthResponse>('/auth/login', { email, password, totp });
  setCsrfToken(res.csrfToken);
  return res;
}

export async function me(): Promise<AuthResponse> {
  const res = await api.get<AuthResponse>('/auth/me');
  setCsrfToken(res.csrfToken);
  return res;
}

export async function logout(): Promise<void> {
  await api.post('/auth/logout');
  setCsrfToken(null);
}
