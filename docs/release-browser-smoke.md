# Manual browser release smoke checklist

Status: **not executed**. Do not mark a release successful from this file alone.

Record: date / commit SHA / application version / environment / browser+version / OS / tester /
result / failed steps / linked issues.

- [ ] Registration: Turnstile success, missing/expired token, widget reset after failure, provider script blocked/timeout, keyboard and screen-reader label; email verification
- [ ] Login (including CAPTCHA challenge), wrong password, password reset challenge, email change, onboarding
- [ ] Refresh/reload session restore, access-token refresh, logout and session revoke
- [ ] WebSocket connect, reconnect, message send, lost-response retry/idempotency, edit/delete
- [ ] Read/unread, typing, presence, reactions; channel, DM and group flows
- [ ] Attachment upload/view, avatar/cover, notification inbox, block/report
- [ ] Moderator, admin and owner Control Center flows
- [ ] English/Turkish CAPTCHA error text, mobile layout, and permission-denied behavior
