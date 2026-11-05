import type { AccessStatus } from './classification-engine.js';
import { severity } from './network-aggregate.js';

export interface HistoryRow {
  day: string;
  status: AccessStatus;
  lastAt: string;
}

export interface HistoryDay {
  day: string;
  status: AccessStatus;
}

export interface HistorySummary {
  days: HistoryDay[];
  blockedSince: string | null;
}

interface DayState {
  worst: AccessStatus;
  latest: AccessStatus;
  latestAt: string;
}

function groupByDay(rows: HistoryRow[]): Map<string, DayState> {
  const days = new Map<string, DayState>();
  for (const row of rows) {
    const current = days.get(row.day);
    if (!current) {
      days.set(row.day, { worst: row.status, latest: row.status, latestAt: row.lastAt });
      continue;
    }
    if (severity(row.status) > severity(current.worst)) {
      current.worst = row.status;
    }
    if (row.lastAt > current.latestAt) {
      current.latest = row.status;
      current.latestAt = row.lastAt;
    }
  }
  return days;
}

export function summarizeHistory(rows: HistoryRow[]): HistorySummary {
  const ordered = [...groupByDay(rows).entries()].sort(([a], [b]) => a.localeCompare(b));
  let blockedSince: string | null = null;
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const [day, state] = ordered[index] as [string, DayState];
    if (state.latest !== 'blocked') {
      break;
    }
    blockedSince = day;
  }
  return { days: ordered.map(([day, state]) => ({ day, status: state.worst })), blockedSince };
}
