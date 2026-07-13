-- Default public channels (docs/02-database-schema.md "Seed data"). Fixed ids so this
-- migration is idempotent-by-content across environments; ordinary `rooms` rows, no
-- special-cased channel list anywhere in application code.

INSERT INTO rooms (id, type, slug, name, topic, owner_id, is_public) VALUES
  ('11111111-1111-4111-8111-111111111111', 'channel', 'general',     'General',     'General discussion', NULL, 1),
  ('22222222-2222-4222-8222-222222222222', 'channel', 'programming', 'Programming', 'Programming talk',   NULL, 1),
  ('33333333-3333-4333-8333-333333333333', 'channel', 'technology',  'Technology',  'Technology news',    NULL, 1),
  ('44444444-4444-4444-8444-444444444444', 'channel', 'gaming',      'Gaming',      'Gaming chat',        NULL, 1);
