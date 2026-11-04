'use client';
import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './api';

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => unwrap(api.GET('/v1/me')), retry: false });
export const useReference = () => useQuery({ queryKey: ['reference'], queryFn: () => unwrap(api.GET('/v1/reference')), staleTime: 10 * 60_000 });
export const useObjects = () => useQuery({ queryKey: ['objects'], queryFn: () => unwrap(api.GET('/v1/objects')), refetchInterval: 60_000 });
export const useObject = (id: string) => useQuery({ queryKey: ['objects', id], queryFn: () => unwrap(api.GET('/v1/objects/{id}', { params: { path: { id } } })) });
export const useAlert = (id: string) => useQuery({ queryKey: ['alerts', id], queryFn: () => unwrap(api.GET('/v1/alerts/{id}', { params: { path: { id } } })) });
export const useUsers = () => useQuery({ queryKey: ['users'], queryFn: () => unwrap(api.GET('/v1/users')) });
export const useProposals = () => useQuery({ queryKey: ['proposals'], queryFn: () => unwrap(api.GET('/v1/proposals')) });
export const useAccount = () => useQuery({ queryKey: ['account'], queryFn: () => unwrap(api.GET('/v1/account')) });
export const useAlerts = () => useQuery({ queryKey: ['alerts'], queryFn: () => unwrap(api.GET('/v1/alerts', { params: { query: { limit: 50, include_past: false } } })) });
