# Integration Boundary

The Control Center frontend owns presentation and its isolated API adapter.
Backend contracts, persisted roles, permissions, optimistic concurrency, owner
protections, and authorization are authoritative.

Integration changes must not alter `web/admin/`, invent routes or DTO fields,
infer permission from role labels, weaken backend checks, or expose
fixtures/tests as public assets. Production behavior uses real APIs only;
fixture mode requires a source edit and has no URL or storage activation path.
