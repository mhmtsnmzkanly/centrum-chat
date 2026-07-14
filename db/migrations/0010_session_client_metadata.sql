-- Session client metadata for the account-security screen (TODOS.md "Oturum IP ve
-- istemci geçmişi"): the IP address and user-agent observed when a session was
-- created, refreshed on every token rotation. Both are nullable so pre-existing
-- sessions (and callers that cannot supply them) stay valid; no external
-- geolocation is involved — the raw values are shown only to the account owner.
ALTER TABLE user_sessions ADD COLUMN ip_address TEXT;
ALTER TABLE user_sessions ADD COLUMN user_agent TEXT;
