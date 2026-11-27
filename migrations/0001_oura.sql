CREATE TABLE oura_oauth_pending (
  owner TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL UNIQUE,
  expires INTEGER NOT NULL,
  claimed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE oura_connections (
  owner TEXT PRIMARY KEY,
  token_envelope TEXT NOT NULL
);
