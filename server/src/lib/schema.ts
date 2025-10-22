import { ensureDb } from './db';

export async function ensureSchema() {
  const db = await ensureDb();
  await db.query(`
    create table if not exists players (
      id text primary key,
      username text not null,
      name text,
      password_hash text,
      created_at timestamptz not null default now()
    );

    create table if not exists games (
      id text primary key,
      x_player_id text not null references players(id) on delete restrict,
      o_player_id text not null references players(id) on delete restrict,
      winner text, -- 'X' | 'O' | 'draw' | null
      moves jsonb not null,
      started_at timestamptz not null,
      ended_at timestamptz,
      created_at timestamptz not null default now()
    );

    create index if not exists idx_games_x_player on games(x_player_id);
    create index if not exists idx_games_o_player on games(o_player_id);
    create index if not exists idx_games_ended_at on games(ended_at);

    -- persistent leaderboard
    create table if not exists leaderboard (
      player_id text primary key references players(id) on delete cascade,
      username text not null,
      wins integer not null default 0,
      updated_at timestamptz not null default now()
    );
    create index if not exists idx_leaderboard_wins on leaderboard(wins desc);

    -- add columns if missing (safe re-run)
    do $$ begin
      begin alter table players add column if not exists name text; exception when others then null; end;
      begin alter table players add column if not exists password_hash text; exception when others then null; end;
    end $$;

    -- ensure unique username
    create unique index if not exists ux_players_username on players(lower(username));
  `);
}

export async function upsertPlayer(id: string, username: string) {
  const db = await ensureDb();
  await db.query(
    `insert into players(id, username) values ($1, $2)
     on conflict (id) do update set username = excluded.username`,
    [id, username]
  );
}
