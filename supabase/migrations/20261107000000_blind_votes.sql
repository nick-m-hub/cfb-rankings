-- Blind ranking votes: a visitor ranks three anonymous teams. Written only by the vote route handler
-- (service role). The crowd ranking uses votes with the current crowd_week (the Eastern Monday the vote
-- was cast in), so it resets every Monday while history is kept.
create table blind_votes (
  id          bigint generated always as identity primary key,
  session_id  uuid not null,
  season      smallint not null,
  week        smallint not null,
  crowd_week  date not null,
  first       bigint not null references teams (id),
  second      bigint not null references teams (id),
  third       bigint not null references teams (id),
  created_at  timestamptz not null default now(),
  check (first <> second and first <> third and second <> third)
);

create index blind_votes_crowd_week_idx on blind_votes (crowd_week, season);
create index blind_votes_session_idx on blind_votes (session_id, created_at desc);

-- RLS on with no policies: service-role only, like ratings.
alter table blind_votes enable row level security;
