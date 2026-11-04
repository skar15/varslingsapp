import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './api';
import { readCache, saveCache } from './cache';

export const useMe = (enabled = true) => useQuery({ queryKey: ['me'], queryFn: () => unwrap(api.GET('/v1/me')), enabled, retry: false });
export const useReference = () => useQuery({ queryKey: ['reference'], queryFn: () => unwrap(api.GET('/v1/reference')), staleTime: 10 * 60_000 });
export const useObject = (id: string) => useQuery({ queryKey: ['objects', id], queryFn: () => unwrap(api.GET('/v1/objects/{id}', { params: { path: { id } } })) });
export const useAlert = (id: string) => useQuery({ queryKey: ['alerts', id], queryFn: () => unwrap(api.GET('/v1/alerts/{id}', { params: { path: { id } } })) });
export const useUsers = () => useQuery({ queryKey: ['users'], queryFn: () => unwrap(api.GET('/v1/users')) });
export const useProposals = () => useQuery({ queryKey: ['proposals'], queryFn: () => unwrap(api.GET('/v1/proposals')) });
export const useAccount = () => useQuery({ queryKey: ['account'], queryFn: () => unwrap(api.GET('/v1/account')) });

type ObjectList = Awaited<ReturnType<typeof fetchObjects>>;
async function fetchObjects() {
  return unwrap(api.GET('/v1/objects'));
}

/** Dashboard with offline fallback: returns the cached list and its time when the API is unreachable. */
export function useDashboard() {
  return useQuery({
    queryKey: ['objects'],
    queryFn: async (): Promise<{ list: ObjectList; offline: boolean; savedAt: string }> => {
      try {
        const list = await fetchObjects();
        await saveCache('objects', list);
        return { list, offline: false, savedAt: list.generated_at };
      } catch (err) {
        const cached = await readCache<ObjectList>('objects');
        if (cached) return { list: cached.data, offline: true, savedAt: cached.savedAt };
        throw err;
      }
    },
    refetchInterval: 60_000,
  });
}
