-- Store an explicitly selected interface locale with the user's existing
-- preferences. NULL means that the user has not made an account-level choice,
-- allowing browser locale resolution to remain authoritative until then.

ALTER TABLE user_preferences
ADD COLUMN locale TEXT CHECK (locale IS NULL OR locale IN ('en', 'tr'));
