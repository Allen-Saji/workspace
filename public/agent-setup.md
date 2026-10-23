# Workspace agent connection status

Production pairing and credentials are not available. Do not send private reports
or attempt to connect an external agent. Reading this document grants no access.

GET /api/agent/v1/capabilities reports whether the isolated ephemeral test harness is
enabled. That harness accepts synthetic test data only, loses all state on restart,
and cannot access the personal workspace. Its protocol is documented in the source
repository at docs/CONNECTIONS.md. It is not the proposed production OAuth/setup profile.

The current conversational assistant uses a separate explicit owner-mediated relay.
No automatic transcript access, background monitoring or remote-memory sync is claimed.
