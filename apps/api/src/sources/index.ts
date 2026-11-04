import type { Env } from '../env';
import { MetAlertsSource } from './met-alerts';
import { NveSource } from './nve';
import type { AlertSource } from './types';

export function createSources(env: Env): AlertSource[] {
  return [
    new MetAlertsSource({ userAgent: env.MET_USER_AGENT, listUrl: env.MET_ALERTS_URL, pollIntervalSec: env.MET_POLL_INTERVAL_SEC }),
    new NveSource('nve-flood', { baseUrl: env.NVE_FLOOD_BASE_URL, pollIntervalSec: env.NVE_POLL_INTERVAL_SEC, enabled: env.NVE_ENABLED }),
    new NveSource('nve-landslide', { baseUrl: env.NVE_LANDSLIDE_BASE_URL, pollIntervalSec: env.NVE_POLL_INTERVAL_SEC, enabled: env.NVE_ENABLED }),
  ];
}
