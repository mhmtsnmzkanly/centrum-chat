# Manual browser release smoke checklist

Status: **not executed**. Do not mark a release successful from this file alone.

Record: date / commit SHA / application version / environment / browser+version / OS / tester /
result / failed steps / linked issues.

- [ ] Registration; Turnstile success and failure; email verification
- [ ] Login, wrong password, password reset, email change, onboarding
- [ ] Refresh/reload session restore, access-token refresh, logout and session revoke
- [ ] WebSocket connect, reconnect, message send, lost-response retry/idempotency, edit/delete
- [ ] Read/unread, typing, presence, reactions; channel, DM and group flows
- [ ] Attachment upload/view, avatar/cover, notification inbox, block/report
- [ ] Moderator, admin and owner Control Center flows
- [ ] English/Turkish change and permission-denied behavior
