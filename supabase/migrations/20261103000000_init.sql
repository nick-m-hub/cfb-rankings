-- Phase 1 initial schema. Seven tables per docs/phase1_spec.md.
-- Ratings are stored long (one row per system/team/season/week) so new systems need no schema change.
--
-- Week convention: `week` is a single integer per season. CFBD restarts week numbering at 1 for the
-- postseason, so ingest maps postseason to (last regular-season week + 1). Never store CFBD's raw
-- postseason week 1 here.

create table teams (
  id          bigint generated always as identity primary key,
  name        text not null,
  conference  text,
  division    text not null default 'fbs' check (division in ('fbs', 'fcs')),
  cfbd_id     integer not null unique
);

-- The crosswalk: every name variant each source uses.
create table team_aliases (
  alias    text not null,
  source   text not null,
  team_id  bigint not null references teams (id) on delete cascade,
  primary key (alias, source)
);
create index team_aliases_team_id_idx on team_aliases (team_id);

create table systems (
  id                bigint generated always as identity primary key,
  name              text not null unique,
  kind              text not null check (kind in ('predictive', 'resume')),
  source            text not null,
  higher_is_better  boolean not null default true,
  -- 'weekly': CFBD returns point-in-time values per week (Elo).
  -- 'season': CFBD returns one current/end-of-season value; history comes only from our own snapshots.
  history           text not null check (history in ('weekly', 'season'))
);

create table ratings (
  system_id     bigint not null references systems (id),
  team_id       bigint not null references teams (id),
  season        smallint not null,
  week          smallint not null check (week between 1 and 30),
  raw_value     double precision not null,
  z_value       double precision,
  retrieved_at  timestamptz not null default now(),
  primary key (system_id, team_id, season, week)
);
create index ratings_season_week_idx on ratings (season, week);

-- id is CFBD's game id, not generated.
create table games (
  id            bigint primary key,
  season        smallint not null,
  week          smallint not null check (week between 1 and 30),
  home_team_id  bigint not null references teams (id),
  away_team_id  bigint not null references teams (id),
  home_points   smallint,
  away_points   smallint,
  neutral_site  boolean not null default false,
  completed     boolean not null default false
);
create index games_season_week_idx on games (season, week);
create index games_home_idx on games (home_team_id, season);
create index games_away_idx on games (away_team_id, season);

create table committee_ranks (
  season   smallint not null,
  week     smallint not null check (week between 1 and 30),
  team_id  bigint not null references teams (id),
  rank     smallint not null check (rank between 1 and 25),
  primary key (season, week, team_id)
);

-- Precomputed slider inputs. Null z_pred / z_resume = team unranked on that side.
create table composite_scores (
  season            smallint not null,
  week              smallint not null check (week between 1 and 30),
  team_id           bigint not null references teams (id),
  z_pred            double precision,
  z_resume          double precision,
  n_systems_pred    smallint not null default 0,
  n_systems_resume  smallint not null default 0,
  primary key (season, week, team_id)
);

-- Phase 1 systems (equal weights within each composite).
insert into systems (name, kind, source, higher_is_better, history) values
  ('SP+',  'predictive', 'cfbd:/ratings/sp',  true, 'season'),
  ('FPI',  'predictive', 'cfbd:/ratings/fpi', true, 'season'),
  ('Elo',  'resume',     'cfbd:/ratings/elo', true, 'weekly'),
  ('SRS',  'resume',     'cfbd:/ratings/srs', true, 'season');

-- Row-level security: public read on teams, systems, composite_scores only.
-- Everything else has RLS enabled with no policies, i.e. service-role access only.
alter table teams            enable row level security;
alter table team_aliases     enable row level security;
alter table systems          enable row level security;
alter table ratings          enable row level security;
alter table games            enable row level security;
alter table committee_ranks  enable row level security;
alter table composite_scores enable row level security;

create policy "public read" on teams            for select using (true);
create policy "public read" on systems          for select using (true);
create policy "public read" on composite_scores for select using (true);
