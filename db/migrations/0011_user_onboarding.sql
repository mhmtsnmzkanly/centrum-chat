-- Persist the user-completed preferences/profile onboarding step. Existing
-- accounts predate onboarding and must retain application access; new accounts
-- created after this migration keep the default NULL until they submit the step.

ALTER TABLE users ADD COLUMN onboarding_preferences_completed_at TEXT;

UPDATE users
SET onboarding_preferences_completed_at = created_at
WHERE onboarding_preferences_completed_at IS NULL;
