create table if not exists domains (
  id bigserial primary key,
  domain text not null,
  normalized_domain text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists accessibility_checks (
  id bigserial primary key,
  domain_id bigint not null references domains(id) on delete cascade,
  country_code char(2) not null,
  status text not null check (status in ('accessible', 'blocked', 'possibly_blocked', 'unknown', 'server_error')),
  confidence numeric(3, 2) not null check (confidence between 0 and 1),
  checked_at timestamptz not null default now(),
  test_source text not null
);

create index if not exists accessibility_checks_domain_recent_idx
  on accessibility_checks (domain_id, country_code, checked_at desc);
create index if not exists accessibility_checks_checked_at_idx
  on accessibility_checks (checked_at);

create table if not exists measurement_evidence (
  id bigserial primary key,
  check_id bigint not null references accessibility_checks(id) on delete cascade,
  evidence_type text not null,
  evidence_data jsonb not null default '{}'::jsonb,
  source text not null,
  timestamp timestamptz not null default now()
);

create index if not exists measurement_evidence_check_idx on measurement_evidence (check_id);
create index if not exists measurement_evidence_type_idx on measurement_evidence (evidence_type, timestamp desc);

create table if not exists network_measurements (
  id bigserial primary key,
  domain_id bigint not null references domains(id) on delete cascade,
  check_id bigint references accessibility_checks(id) on delete cascade,
  country_code char(2) not null,
  isp text not null,
  asn text not null,
  dns_resolver text,
  dns_result jsonb not null,
  http_result jsonb not null,
  tls_result jsonb not null,
  measured_at timestamptz not null default now()
);

create index if not exists network_measurements_domain_recent_idx
  on network_measurements (domain_id, country_code, measured_at desc);
create index if not exists network_measurements_measured_at_idx on network_measurements (measured_at);
