import { ApiError, createApiClient, unwrap } from '@varsling/api-client';
import { API_URL } from './config';
import { accessToken } from './supabase';

/** The one API client for the app (working rule 8). Never call MET or NVE directly. */
export const api = createApiClient({ baseUrl: API_URL, getToken: accessToken });
export { ApiError, unwrap };
