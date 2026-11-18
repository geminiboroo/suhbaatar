CREATE TABLE IF NOT EXISTS admins (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, username text UNIQUE NOT NULL,
 password text NOT NULL, role text NOT NULL DEFAULT 'owner' CHECK(role IN ('owner','operator'))
);
CREATE TABLE IF NOT EXISTS sessions (
 token text PRIMARY KEY, admin_id integer NOT NULL REFERENCES admins ON DELETE CASCADE,
 expires timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS campaigns (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, slug text NOT NULL UNIQUE, title text NOT NULL,
 description text NOT NULL, image text, total integer NOT NULL CHECK(total > 0), price integer NOT NULL CHECK(price > 0),
 active boolean NOT NULL DEFAULT false, public boolean NOT NULL DEFAULT false, archived boolean NOT NULL DEFAULT false,
 starts timestamptz, ends timestamptz, CHECK(ends IS NULL OR starts IS NULL OR ends>starts)
);
CREATE TABLE IF NOT EXISTS campaign_settings (
 campaign_id integer PRIMARY KEY REFERENCES campaigns, settings jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS bank_accounts (
 campaign_id integer PRIMARY KEY REFERENCES campaigns, bank text NOT NULL, holder text NOT NULL,
 account text NOT NULL, iban text NOT NULL, logo text, provider text, UNIQUE(provider,account)
);
CREATE TABLE IF NOT EXISTS participants (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, phone text UNIQUE NOT NULL CHECK(phone ~ '^[0-9]{8}$')
);
CREATE TABLE IF NOT EXISTS imports (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, campaign_id integer NOT NULL REFERENCES campaigns,
 admin_id integer NOT NULL REFERENCES admins, created_at timestamptz NOT NULL DEFAULT now(), rolled_back_at timestamptz,
 summary jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS transactions (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, campaign_id integer NOT NULL REFERENCES campaigns,
 participant_id integer NOT NULL REFERENCES participants, import_id integer REFERENCES imports,
 occurred_at timestamptz NOT NULL, amount integer NOT NULL CHECK(amount>0), bank text NOT NULL DEFAULT '',
 memo text NOT NULL DEFAULT '', count integer NOT NULL CHECK(count>0), requested integer[] NOT NULL DEFAULT '{}',
 status text NOT NULL CHECK(status IN ('pending','confirmed','reversed')), dedupe text, provider text, external_id text
);
CREATE UNIQUE INDEX IF NOT EXISTS transaction_dedupe ON transactions(campaign_id,dedupe) WHERE status<>'reversed';
CREATE UNIQUE INDEX IF NOT EXISTS transaction_external ON transactions(provider,external_id);
CREATE INDEX IF NOT EXISTS transaction_participant ON transactions(participant_id,status);
CREATE INDEX IF NOT EXISTS transaction_campaign ON transactions(campaign_id,status);
CREATE TABLE IF NOT EXISTS lottery_tickets (
 campaign_id integer NOT NULL REFERENCES campaigns, transaction_id integer NOT NULL REFERENCES transactions,
 number integer NOT NULL CHECK(number>0), PRIMARY KEY(campaign_id,number)
);
CREATE INDEX IF NOT EXISTS ticket_transaction ON lottery_tickets(transaction_id);
CREATE TABLE IF NOT EXISTS import_rows (
 import_id integer NOT NULL REFERENCES imports, row_no integer NOT NULL, result text NOT NULL,
 reason text, transaction_id integer REFERENCES transactions, PRIMARY KEY(import_id,row_no)
);
CREATE TABLE IF NOT EXISTS audit_logs (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, admin_id integer REFERENCES admins,
 action text NOT NULL, target text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS site_settings (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE IF NOT EXISTS images (id text PRIMARY KEY, mime text NOT NULL, bytes bytea NOT NULL);
ALTER TABLE transactions ALTER COLUMN occurred_at DROP NOT NULL;
ALTER TABLE transactions ALTER COLUMN amount DROP NOT NULL;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS participant_goal integer CHECK (participant_goal BETWEEN 1 AND 1000000);
