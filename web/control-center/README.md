# Control Center

This browser client consumes the authoritative contracts in
`docs/11-moderation-api-contract.md` and
`docs/12-control-center-api-contract.md`. Production is served at
`/control-center` through an explicit asset allow-list.

Runtime identity, role, permissions, and area flags come only from
`GET /api/control-center/me`. Capabilities affect presentation only; backend
authorization remains mandatory. The client supports moderation
reports/context/assignment/transitions and contextual sanctions, user and
channel administration, explicit role transitions, versioned settings, broad
audit access for admin/owner, and owner transfer.

There is no global sanctions list, channel hard delete, private-channel control,
or arbitrary setting editor. This checkout contains no legacy `web/admin/`
client, so `/admin` remains not found.

Development fixtures are disconnected from the production import graph and have
no runtime fallback. URL parameters, browser storage, and DOM state cannot
enable them. Fixture, test, and Markdown files are not served by the production
HTTP route.
