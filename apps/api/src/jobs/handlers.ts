import type { Ctx } from '../context';
import { decide } from '../domain/decide';
import { checkReceipts, dispatchNotification, sendReminder } from '../domain/dispatch';
import { deliverInfo } from '../domain/info';
import { checkStaleness, pollSource, processSourceAlert } from '../domain/ingest';
import { runErasure, runRetention } from '../domain/maintenance';
import { onStatusExpire, onStatusRevert } from '../domain/status-jobs';
import type { JobHandlers } from './types';

export function createHandlers(ctx: Ctx): JobHandlers {
  return {
    'ingest.tick': async () => {
      for (const source of ctx.sources) await pollSource(ctx, source);
    },
    'alert.process': async (d) => {
      await processSourceAlert(ctx, d.sourceAlertId);
    },
    'alert.match': async (d) => {
      await decide(ctx, d.alertId);
    },
    'notify.dispatch': (d, meta) => dispatchNotification(ctx, d.notificationId, meta),
    'notify.reminder': async (d) => {
      await sendReminder(ctx, d.notificationId);
    },
    'push.receipts': async () => {
      await checkReceipts(ctx);
    },
    'info.push': (d) => deliverInfo(ctx, d),
    'status.expire': async (d) => {
      await onStatusExpire(ctx, d);
    },
    'status.revert': async (d) => {
      await onStatusRevert(ctx, d);
    },
    'ingest.staleness': async () => {
      await checkStaleness(ctx);
    },
    'maintenance.retention': async () => {
      await runRetention(ctx);
    },
    'maintenance.erasure': async () => {
      await runErasure(ctx);
    },
  };
}
