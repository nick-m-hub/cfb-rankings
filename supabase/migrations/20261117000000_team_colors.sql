-- Team colors from CFBD (/teams/fbs `color`, `alternateColor`), hex strings like "#003594".
-- Used as small accents next to team logos. Null for FCS teams and anything CFBD leaves blank.
alter table teams add column if not exists color text;
alter table teams add column if not exists alt_color text;
