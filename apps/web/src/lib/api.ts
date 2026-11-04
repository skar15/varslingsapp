import { ApiError, createApiClient, unwrap } from '@varsling/api-client';
import { API_URL } from './env';
import { accessToken } from './supabase';

/** The one API client for the web app (working rule 8: no hand-written fetch calls). */
export const api = createApiClient({ baseUrl: API_URL, getToken: () => (typeof window === 'undefined' ? null : accessToken()) });
export { ApiError, unwrap };

/** Server-side client for public endpoints (landing page plans). */
export const publicApi = createApiClient({ baseUrl: process.env.API_INTERNAL_URL ?? API_URL });
