# Calendar integration

Workspace connects to Google Calendar separately from Google sign-in. Calendar
data stays behind the signed-in owner's API session. Text requests and manual
forms use the same preview and apply endpoints. The model cannot send invitations.

## Configuration

Enable Google Calendar API for a Google Cloud web OAuth client. Register the exact
callback `<WORKSPACE_ORIGIN>/auth/calendar/callback`. Supply these server-only
environment variables:

- `WORKSPACE_GOOGLE_CLIENT_ID`
- `WORKSPACE_GOOGLE_CLIENT_SECRET`
- `WORKSPACE_INTEGRATION_KEY`: a cryptographically random 32-byte key encoded as base64

Do not use a `NEXT_PUBLIC_` prefix. Keep the integration key stable across restarts
and instances. Replacing it makes existing encrypted connections unreadable;
users must reconnect. Back up the key using the deployment's secret manager.

Apply `20261025065933_calendar_credentials.sql` through the normal reviewed
migration process before enabling hosted connections. The app does not use a
Supabase service-role key. Hosted RPCs derive the workspace from the verified
owner session. Local SQLite uses `.data/calendar.sqlite` with owner-only file
permissions. Both stores contain authenticated ciphertext, not provider tokens.

Google OAuth requests `calendar.events`, `calendar.calendarlist.readonly`, and
`calendar.events.freebusy`. These authorize event access, subscribed-calendar
listing, and availability respectively. A connect attempt uses PKCE S256 and a
short-lived, single-use state stored in an HttpOnly cookie and owner-scoped
database row. Account selection happens at Google. A connection replaces only
that Workspace owner's previous connection after consent succeeds.

Google projects in external Testing mode issue Calendar refresh tokens with a
seven-day lifetime. Public distribution may require consent-screen verification.
The UI reports missing setup or reconnection requirements without showing secrets.

## Behavior

- Calendar lists and agendas are fetched on request. This is not a background
  synchronization service. Event windows are limited to 90 days and 1,000 events;
  the API returns `truncated: true` when more events exist.
- All-day events can be viewed. Manual and assistant writes create or edit timed,
  non-recurring events. Recurring edits are rejected until the UI supports an
  explicit occurrence/series choice.
- Previews bind the exact event, owner, connected Google grant, request ID and ten-minute expiry using
  authenticated encryption. Apply requires an explicit confirmation.
- Google invitations are sent with `sendUpdates=all`. Stable event IDs and
  operation markers make an uncertain create retry recoverable. Updates use
  `If-Match` etags; a changed event requires a fresh preview.
- Updates preserve existing attendee RSVP objects and existing conference data.
  Meet creation requires a compatible calendar and completes asynchronously.
  Only an actual returned Meet URL appears as a join link.
- Availability errors remain errors. They are never treated as a free time slot.
- Disconnect revokes Google's grant and clears encrypted credentials. A failed
  revocation retains them so the user can retry. Already-revoked grants can be
  disconnected. No event is deleted by disconnecting.

## ICS import

Import previews up to ten timed, non-recurring VEVENT entries from a file no
larger than 60 KB. It imports title and start/end into local Workspace meetings;
it does not send Google invitations. Stable UID-based record IDs prevent creating
another local record for the same UID. The existing command system supplies
revision checks, history and undo when the preview is applied.

UTC, IANA timezones and embedded VTIMEZONE definitions are supported. Floating
times, ambiguous or missing daylight-saving times, all-day events, recurrence,
cancelled events, missing UIDs and more than ten entries are rejected explicitly.
The entire preview fails if any event is unsupported; no partial import occurs.
Attendees, reminders, attachments and invitation semantics are not imported.

## API and verification

`GET /api/calendar?action=status|calendars|events` reads configuration, calendars
or events. Event queries use `calendarId`, `from`, and `to` with explicit timezone
offsets. JSON `POST /api/calendar` uses the existing same-origin CSRF headers and
accepts `connect`, `disconnect`, `preview`, `apply`, `freebusy`, or `import` actions.

Run `node --test tests/calendar*.test.ts` with the repository's supported Node
version. Tests cover encrypted owner binding, preview expiry/confirmation,
idempotency, conditional updates, refresh and revocation, OAuth state/PKCE,
timezone parsing and PostgreSQL owner/session isolation using mocked provider
responses. They do not send real invitations or claim a live Google integration
has been configured.

## Primary references

- [Google web server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth)
- [Freebusy API](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query)
- [Event creation and conferences](https://developers.google.com/workspace/calendar/api/guides/create-events)
- [Conditional updates](https://developers.google.com/workspace/calendar/api/guides/version-resources)
- [OAuth token expiration](https://developers.google.com/identity/protocols/oauth2)
- [ICAL.js timezone and recurrence guidance](https://github.com/kewisch/ical.js/wiki/Common-Use-Cases)
