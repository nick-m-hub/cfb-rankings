-- Extra card stats for the blind ranking page. Additive and nullable: existing rows are untouched and
-- read as "unknown" until the season is re-ingested (npm run ingest-current -- --all-weeks, or backfill
-- for completed seasons, which re-reads the disk cache at no API cost).

-- Per team-game EPA (CFBD calls it PPA) from /stats/game/advanced, which we already fetch.
-- off_ppa: points added per offensive play. def_ppa: points allowed per defensive play (lower is better).
alter table game_team_stats
  add column off_ppa   double precision,
  add column def_ppa   double precision,
  add column def_plays smallint;

-- Postgame win probability from /games (already fetched): how likely each side was to win given what
-- happened on the field. Null for games not yet played or without play-by-play.
alter table games
  add column home_postgame_wp double precision,
  add column away_postgame_wp double precision;
