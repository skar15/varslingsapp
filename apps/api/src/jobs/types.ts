import type { I18nKey } from '@varsling/shared';

/** A parameter that is either plain text or reference-data i18n resolved per recipient. */
export type InfoParam = string | { nb: string; en?: string } | { time: string };

export interface InfoPush {
  userIds: string[];
  titleKey?: I18nKey;
  bodyKey: I18nKey;
  params?: Record<string, InfoParam>;
  data?: Record<string, unknown>;
  category?: 'status-extend';
  /** Send SMS when the user has no enabled device (user removed, invitation). */
  smsFallback?: boolean;
}

export interface JobData {
  'ingest.tick': Record<string, never>;
  'alert.process': { sourceAlertId: string };
  'alert.match': { alertId: string };
  'notify.dispatch': { notificationId: string };
  'notify.reminder': { notificationId: string };
  'push.receipts': Record<string, never>;
  'info.push': InfoPush;
  'status.expire': { objectId: string; version: number };
  'status.revert': { objectId: string; version: number };
  'ingest.staleness': Record<string, never>;
  'maintenance.retention': Record<string, never>;
  'maintenance.erasure': Record<string, never>;
}
export type JobName = keyof JobData;
export const JOB_NAMES = [
  'ingest.tick', 'alert.process', 'alert.match', 'notify.dispatch', 'notify.reminder', 'push.receipts', 'info.push',
  'status.expire', 'status.revert', 'ingest.staleness', 'maintenance.retention', 'maintenance.erasure',
] as const satisfies readonly JobName[];

export interface SendOpts {
  startAfter?: Date;
  singletonKey?: string;
}

export interface JobQueue {
  send<K extends JobName>(name: K, data: JobData[K], opts?: SendOpts): Promise<void>;
}

export type JobHandlers = { [K in JobName]: (data: JobData[K], meta: { retryCount: number; retryLimit: number }) => Promise<void> };
