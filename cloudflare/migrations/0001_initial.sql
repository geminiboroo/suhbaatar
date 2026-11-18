CREATE TABLE admins (
 id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'owner'
);
CREATE TABLE sessions (
 token TEXT PRIMARY KEY, admin_id INTEGER NOT NULL REFERENCES admins ON DELETE CASCADE, expires INTEGER NOT NULL
);
CREATE INDEX sessions_admin ON sessions(admin_id);
CREATE TABLE campaigns (
 id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, image TEXT,
 total INTEGER NOT NULL CHECK(total BETWEEN 1 AND 1000000), price INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 0,
 public INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, starts TEXT, ends TEXT,
 participant_goal INTEGER CHECK(participant_goal BETWEEN 1 AND 1000000), revision INTEGER NOT NULL DEFAULT 0,
 CHECK(ends IS NULL OR starts IS NULL OR ends>starts)
);
CREATE TABLE bank_accounts (
 campaign_id INTEGER PRIMARY KEY REFERENCES campaigns, bank TEXT NOT NULL, holder TEXT NOT NULL, account TEXT NOT NULL,
 iban TEXT NOT NULL, logo TEXT, provider TEXT
);
CREATE TABLE participants (
 id INTEGER PRIMARY KEY, phone TEXT UNIQUE NOT NULL CHECK(length(phone)=8 AND phone NOT GLOB '*[^0-9]*')
);
CREATE TABLE imports (
 id INTEGER PRIMARY KEY, campaign_id INTEGER NOT NULL REFERENCES campaigns, admin_id INTEGER NOT NULL REFERENCES admins,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), rolled_back_at TEXT,
 summary TEXT NOT NULL DEFAULT '{}', commit_key TEXT UNIQUE
);
CREATE TABLE transactions (
 id INTEGER PRIMARY KEY, campaign_id INTEGER NOT NULL REFERENCES campaigns, participant_id INTEGER NOT NULL REFERENCES participants,
 import_id INTEGER REFERENCES imports, source_row INTEGER, occurred_at TEXT, amount INTEGER CHECK(amount>0),
 bank TEXT NOT NULL DEFAULT '', memo TEXT NOT NULL DEFAULT '', count INTEGER NOT NULL CHECK(count>0),
 requested TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL CHECK(status IN ('pending','confirmed','reversed')),
 UNIQUE(import_id,source_row)
);
CREATE INDEX transaction_participant ON transactions(participant_id,status);
CREATE INDEX transaction_campaign ON transactions(campaign_id,status);
CREATE TABLE lottery_tickets (
 campaign_id INTEGER NOT NULL REFERENCES campaigns, transaction_id INTEGER NOT NULL REFERENCES transactions,
 number INTEGER NOT NULL CHECK(number>0), PRIMARY KEY(campaign_id,number)
);
CREATE INDEX ticket_transaction ON lottery_tickets(transaction_id);
CREATE TRIGGER ticket_capacity BEFORE INSERT ON lottery_tickets
 WHEN NEW.number > (SELECT total FROM campaigns WHERE id=NEW.campaign_id)
 BEGIN SELECT RAISE(ABORT,'ticket capacity'); END;
CREATE TRIGGER campaign_capacity BEFORE UPDATE OF total ON campaigns
 WHEN NEW.total < (SELECT max(number) FROM lottery_tickets WHERE campaign_id=NEW.id)
 BEGIN SELECT RAISE(ABORT,'ticket capacity'); END;
CREATE TABLE import_rows (
 import_id INTEGER NOT NULL REFERENCES imports, row_no INTEGER NOT NULL, result TEXT NOT NULL, reason TEXT,
 transaction_id INTEGER REFERENCES transactions, PRIMARY KEY(import_id,row_no)
);
CREATE TABLE audit_logs (
 id INTEGER PRIMARY KEY, admin_id INTEGER REFERENCES admins, action TEXT NOT NULL, target TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE site_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE images (id TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes BLOB NOT NULL);
CREATE TABLE rate_limits (
 scope TEXT NOT NULL, key TEXT NOT NULL, bucket INTEGER NOT NULL, count INTEGER NOT NULL,
 PRIMARY KEY(scope,key)
);
