/**
 * Typed client for the Varslingsapp API, generated from the OpenAPI document that the API
 * builds from the zod schemas in @varsling/shared. Web and mobile use only this client
 * (working rule 8). Regenerate with `pnpm api-client:generate`.
 */
import createClient, { type Middleware } from 'openapi-fetch';
import type { components, paths } from './generated/schema';

export type { components, paths };

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code?: string;
  detail?: string;
  i18n_key?: string;
  errors?: { path: string; message: string }[];
  [key: string]: unknown;
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly problem: ProblemDetails) {
    super(problem.title || `HTTP ${status}`);
  }
  get code(): string | undefined {
    return this.problem.code;
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Returns the current Supabase access token, or null when signed out. */
  getToken?: () => Promise<string | null> | string | null;
  fetch?: typeof fetch;
}

export function createApiClient(opts: ApiClientOptions) {
  const client = createClient<paths>({ baseUrl: opts.baseUrl.replace(/\/$/, ''), fetch: opts.fetch });
  const auth: Middleware = {
    async onRequest({ request }) {
      const token = await opts.getToken?.();
      if (token) request.headers.set('authorization', `Bearer ${token}`);
      return request;
    },
    async onResponse({ response }) {
      if (response.ok || response.status === 304) return response;
      let problem: ProblemDetails;
      try {
        problem = (await response.clone().json()) as ProblemDetails;
      } catch {
        problem = { type: 'about:blank', title: response.statusText, status: response.status };
      }
      throw new ApiError(response.status, problem);
    },
  };
  client.use(auth);
  return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** Unwraps an openapi-fetch result (errors already throw ApiError in the middleware). */
export async function unwrap<T>(p: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const r = await p;
  if (r.data === undefined && r.response.status !== 204 && r.response.status !== 202) {
    throw new ApiError(r.response.status, { type: 'about:blank', title: 'Empty response', status: r.response.status });
  }
  return r.data as T;
}

type Schemas = components['schemas'];
export type { Schemas };
