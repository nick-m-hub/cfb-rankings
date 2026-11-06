-- In-house models (Nov 2026): a resume ("most deserving") model and a best-team (predictive) model
-- now drive the slider. SP+, FPI, Elo and SRS stay as reference systems shown in team details.
-- Additive only: no existing column or row is changed except the new in_composite flag.

-- Which systems feed composite_scores. Reference systems keep their ratings and z-scores.
alter table systems add column in_composite boolean not null default true;
update systems set in_composite = false where name in ('SP+', 'FPI', 'Elo', 'SRS');

insert into systems (name, kind, source, higher_is_better, history, in_composite) values
  ('Resume Model',    'resume',     'model:resume', true, 'weekly', true),
  ('Best-Team Model', 'predictive', 'model:best',   true, 'weekly', true);

-- FBS membership per season (teams.division only reflects the newest season).
create table team_seasons (
  season      smallint not null,
  team_id     bigint not null references teams (id),
  conference  text,
  division    text not null check (division in ('fbs', 'fcs')),
  primary key (season, team_id)
);

-- Per team-game offensive stats from CFBD /stats/game/advanced (best-team model input).
create table game_team_stats (
  game_id       bigint not null references games (id),
  team_id       bigint not null references teams (id),
  plays         smallint not null,
  success_rate  double precision not null,
  primary key (game_id, team_id)
);

-- Preseason prior inputs: CFBD /player/returning and /talent.
create table team_season_inputs (
  season             smallint not null,
  team_id            bigint not null references teams (id),
  returning_ppa_pct  double precision,
  talent             double precision,
  primary key (season, team_id)
);

-- Per-team model outputs for the rankings detail view (best win, top-12 odds, offense/defense...).
create table model_details (
  season   smallint not null,
  week     smallint not null check (week between 1 and 30),
  team_id  bigint not null references teams (id),
  details  jsonb not null,
  primary key (season, week, team_id)
);

-- Server-only, like ratings and games.
alter table team_seasons       enable row level security;
alter table game_team_stats    enable row level security;
alter table team_season_inputs enable row level security;
alter table model_details      enable row level security;
