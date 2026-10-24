# Hosted reporting activation — 2026-10-24

Project: wovswvjkioymuabthnmq. Existing free project; no deployment or billing change.
The user approved bounded connection and diary activation. No real agent was connected.

## Applied migrations

| Local source | Recorded hosted version/name |
|---|---|
| 20261023172249_connection_persistence_candidate.sql | 20261024091933 / connection_persistence_candidate |
| 20261024082058_hosted_connection_transactions_candidate.sql | 20261024092121 / hosted_connection_transactions_candidate |
| 20261024084829_agent_diary_v2_candidate.sql | 20261024092133 / agent_diary_v2_candidate |
| 20261024092137_activate_scoped_agent_reporting.sql | 20261024092157 / activate_scoped_agent_reporting |

Each apply returned success; history was reread. No blanket db push. pgcrypto already
existed in extensions, and there were no conflicting agent tables. New tables force RLS.

Authenticated owners may call control and diary-read wrappers. Owner identity comes
from confirmed, active ordinary Auth plus relational ownership, with no owner argument.
Anon may call only capability-authenticated transport wrappers and their dispatchers.
Public wrappers are SECURITY INVOKER; private checked dispatchers use empty search_path.
No generic helper execution or direct write grants. Setup challenge and token/pairing
hashes cannot be selected by ordinary users. Diary/status retain reports:append scope.
No context reads, task edits, automatic acceptance or remote-memory claims are added.

Local app review constants are enabled and ignored local configuration selects hosted.
Capabilities report hosted, journalEnabled=true, schedulerConnected=false and
productionReady=false. Public internet deployment is still outside this milestone.

## Actual verification

- 68 tests, lint, typecheck and production build passed after gate activation.
- Existing signed-in Google session survived restart. Agents UI loaded ordinary owner
  connection and diary listings successfully, with no registrations or diary entries.
- App unauthenticated control/journal GETs: HTTP 401.
- App invalid synthetic registration and v1/v2 receipt bearer requests: HTTP 401.
- Direct publishable-key PostgREST owner control: HTTP 401. Invalid registration and
  journal receipt RPCs return auth_required, with no registration or credential created.
- SQL privilege inspection: no anonymous table access, no authenticated direct writes,
  no setup_challenge SELECT; exact intended wrapper/dispatcher EXECUTE grants only.
- Final counts: pairings/connections/token hashes/diaries/journal events all zero.
  Existing records/history/commands remained 1/4/2 across verification.
- Live successful exchange, ingestion, rotation/revoke, cross-user isolation and
  independent hosted lock contention are NOT tested. Local fixtures cover these.

## Advisor interpretation

Seven private tables report [RLS enabled without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
Intentional: direct client access is denied; checked private dispatchers are the only
access boundary. Do not add permissive policies to silence this advisory.
The existing [leaked password protection warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
is unchanged; no Auth settings or paid plan were altered. Google is the app login UI.
Performance reports two unindexed connection foreign keys (diaries and journal events)
and two unused new indexes. These are nonblocking with empty agent data; review indexing
before scale. Do not drop indexes solely because fresh tables have no traffic.

## Destructive-operation warning explanation

The transaction migration defines two DELETE statements inside stored functions:
`delete from workspace_private.agent_token_hashes where connection_id=c.id;`
They remove only a connection's old token hash during future revoke/rotation. Defining
those functions did not execute their bodies. No DROP/TRUNCATE or application-data
DELETE was applied. Top-level data changes inserted the new false activation row and
then changed that row to true with WHERE singleton. Tool output did not identify the
warning detector's exact match or the person who approved its card. No denied result,
retry, alternate path or credential extraction occurred. Pre-migration row counts were
not captured; no unsupported before/after comparison is claimed for migration time.

## Non-destructive disable

First execute `update workspace_private.agent_activation set enabled=false where singleton;`
to block transport even if an old app remains running. Then remove local
WORKSPACE_CONNECTIONS=hosted and restart the app. Revoke only the EXECUTE grants listed
in the activation migration for durable API closure. Do not delete data, tokens, history,
tables or schema. Retain them for investigation. Re-enabling requires a reviewed decision.

Before an actual agent: approve its exact identity, requested scopes and secure one-time
setup delivery. No pairing code, token exchange, external contact or job was performed.
A host must schedule work and rotate the one-hour token independently of the three-hour
status cadence. Public deployment also needs abuse, retention and secret-log review.
