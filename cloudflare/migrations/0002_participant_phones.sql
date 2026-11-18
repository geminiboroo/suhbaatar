CREATE TABLE participant_phones (
  phone TEXT NOT NULL CHECK(length(phone)=8 AND phone NOT GLOB '*[^0-9]*'),
  participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  PRIMARY KEY(phone,participant_id)
);
CREATE INDEX participant_phones_by_phone ON participant_phones(phone);
INSERT OR IGNORE INTO participant_phones(phone,participant_id)
SELECT phone,id FROM participants;
