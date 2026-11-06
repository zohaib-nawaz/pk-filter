import pg from 'pg';
import type { AccessStatus, Evidence } from '../services/classification-engine.js';
import type { HistoryRow } from '../services/history.js';
import type { ProbeMeasurement } from '../services/network-probe.js';

export interface CheckRecord {
  domain: string;
  country: string;
  status: AccessStatus;
  confidence: number;
  checkedAt: string;
  testSource: string;
  evidence: Evidence[];
  measurement: ProbeMeasurement;
}

export interface CheckRepository {
  saveCheck(record: CheckRecord): Promise<void>;
  history(domain: string, days: number): Promise<HistoryRow[] | null>;
  prune(retentionDays: number): Promise<number>;
  close(): Promise<void>;
}

export const nullRepository: CheckRepository = {
  saveCheck: async () => undefined,
  history: async () => null,
  prune: async () => 0,
  close: async () => undefined,
};

function tlsResult(measurement: ProbeMeasurement): Record<string, unknown> {
  const { https } = measurement;
  if (https.error === 'tls') {
    return { valid: false, errorCode: https.errorCode };
  }
  if (https.status !== null) {
    return { valid: true };
  }
  return { valid: null, reason: https.error };
}

export function createPgRepository(pool: pg.Pool): CheckRepository {
  return {
    async saveCheck(record) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const domain = await client.query<{ id: string }>(
          `insert into domains (domain, normalized_domain) values ($1, $1)
           on conflict (normalized_domain) do update set domain = excluded.domain
           returning id`,
          [record.domain],
        );
        const domainId = domain.rows[0]?.id;
        const check = await client.query<{ id: string }>(
          `insert into accessibility_checks (domain_id, country_code, status, confidence, checked_at, test_source)
           values ($1, $2, $3, $4, $5, $6) returning id`,
          [domainId, record.country, record.status, record.confidence, record.checkedAt, record.testSource],
        );
        const checkId = check.rows[0]?.id;
        await client.query(
          `insert into measurement_evidence (check_id, evidence_type, evidence_data, source, timestamp)
           select $1, e.type, e.data, e.source, $3
           from jsonb_to_recordset($2::jsonb) as e(type text, data jsonb, source text)`,
          [checkId, JSON.stringify(record.evidence), record.checkedAt],
        );
        const m = record.measurement;
        await client.query(
          `insert into network_measurements
             (domain_id, check_id, country_code, isp, asn, dns_resolver, dns_result, http_result, tls_result, measured_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            domainId,
            checkId,
            record.country,
            m.network.isp,
            m.network.asn,
            m.dns.resolvers.join(','),
            JSON.stringify(m.dns),
            JSON.stringify({ https: m.https, http: m.http }),
            JSON.stringify(tlsResult(m)),
            m.measuredAt,
          ],
        );
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async history(domain, days) {
      const result = await pool.query<{ day: string; status: HistoryRow['status']; last_at: string }>(
        `select to_char(date_trunc('day', c.checked_at), 'YYYY-MM-DD') as day, c.status,
                to_char(max(c.checked_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS') as last_at
           from accessibility_checks c
           join domains d on d.id = c.domain_id
          where d.normalized_domain = $1 and c.checked_at > now() - make_interval(days => $2)
          group by 1, 2`,
        [domain, days],
      );
      return result.rows.map((row) => ({ day: row.day, status: row.status, lastAt: row.last_at }));
    },

    async prune(retentionDays) {
      const result = await pool.query(
        `delete from accessibility_checks where checked_at < now() - make_interval(days => $1)`,
        [retentionDays],
      );
      await pool.query(`delete from network_measurements where measured_at < now() - make_interval(days => $1)`, [
        retentionDays,
      ]);
      await pool.query(
        `delete from domains where id in (
           select d.id from domains d
            where not exists (select 1 from accessibility_checks c where c.domain_id = d.id)
              and not exists (select 1 from network_measurements n where n.domain_id = d.id)
            for update skip locked
         )`,
      );
      return result.rowCount ?? 0;
    },

    close: () => pool.end(),
  };
}
