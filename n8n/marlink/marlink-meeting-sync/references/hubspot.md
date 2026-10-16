# HubSpot Meetings

Read this when the client books through HubSpot's Meetings tool (scheduling pages) — for the token,
picking the booking page, how meetings and contacts are shaped, and what HubSpot can't tell you.

## Token

Clients usually create a **service key** (HubSpot → Development → Keys → Service keys). The secret is
a `pat-na1-…` / `pat-eu1-…` string. A bare number (e.g. from a URL like
`/service-keys/<portalId>/key/<keyId>`) is the key's ID, not the token — HubSpot answers
`401 INVALID_AUTHENTICATION`.

Service keys are REST-only: **no webhooks**. Instant delivery would need a HubSpot workflow with the
"Send a webhook" action, which requires **Data Hub (formerly Operations Hub) Professional/Enterprise**.
Without it, poll every 5 minutes (the `hubspot-poll` template).

Scopes that were sufficient: `crm.objects.contacts.read` (meetings and contacts reads worked with it)
and `scheduler.meetings.meeting-link.read` (list booking pages). Verify by calling the endpoints below
rather than trusting the scope list.

## Discovery (read-only)

- Booking pages: `GET https://api.hubapi.com/scheduler/v3/meetings/meeting-links?limit=50` (follow
  `paging.next.after`) → `id`, `name`, `link`, `type`.
- Bookings per page, to show the user which pages are actually used:

```json
POST https://api.hubapi.com/crm/v3/objects/meetings/search
{ "limit": 200,
  "filterGroups": [{ "filters": [
    { "propertyName": "hs_meeting_source", "operator": "IN", "values": ["MEETINGS_PUBLIC", "MEETINGS_EMBEDDED"] },
    { "propertyName": "hs_createdate", "operator": "GTE", "value": "<epoch ms 12 months ago>" } ] }],
  "properties": ["hs_created_by_scheduling_page", "hs_meeting_outcome", "hs_createdate"] }
```

Group by `hs_created_by_scheduling_page` (= the meeting-link `id`). Most links in an account are
usually unused — present the active ones with counts and recommend one.

## Meeting data the workflow relies on

- `hs_created_by_scheduling_page` — filter for the tracked page (`EQ "<page id>"`).
- `hs_meeting_source` — `MEETINGS_PUBLIC` for booking-page meetings; most meetings in an account are
  `BIDIRECTIONAL_SYNC` calendar copies, which the page filter excludes.
- `hs_meeting_outcome` — `SCHEDULED`, `COMPLETED`, `RESCHEDULED`, `NO_SHOW`, `CANCELED` (accounts can add
  custom values; treat empty as `SCHEDULED`). `COMPLETED` is recorded but not announced.
- `hs_meeting_start_time` — ISO UTC.
- `hs_lastmodifieddate` changes for unrelated reasons (HubSpot touches meetings ~7 days after they
  start), so dedupe on `(outcome, start_time)` in the Data Table, never on modification alone.
- Look-back window: 3 days of `hs_lastmodifieddate` — survives n8n downtime; duplicates are prevented by
  the state table.

## Contacts on a meeting

- A booked meeting usually has **two** contacts: the lead and an internal contact for the host (the
  client's own domain). Pass the client's domains in `INTERNAL_EMAIL_DOMAINS`; the match code skips them.
- Contacts can't be searched by meeting (`associations.meeting` filter → 400). Use
  `GET /crm/v3/objects/meetings/{id}?associations=contacts`, then
  `POST /crm/v3/objects/contacts/batch/read` with `email, firstname, lastname`.

## What HubSpot can't see

- **Declined calendar invites are not tracked.** If a lead declines the Google/Outlook invite, the
  meeting stays `SCHEDULED`. Ask the client's team to set the meeting's **Outcome → Canceled** in HubSpot
  in that case (or when a lead cancels by email); the workflow picks it up within 5 minutes.
- Cancels/reschedules made through the links in the confirmation email are set automatically. Check with
  `GET /crm/v3/objects/meetings/{id}?propertiesWithHistory=hs_meeting_outcome`: `sourceType: API` =
  automatic, `CRM_UI` = someone clicked in HubSpot.

## State table and seeding

Data Table columns (strings): `meeting_id`, `outcome`, `start_time`. Before publishing, insert every
existing meeting of the tracked page (`outcome` empty → `SCHEDULED`) so the first run is quiet.

## Errors seen in production

HubSpot's search API occasionally returns `500 {"status":"error","message":"There was a problem with the
request."}` for a few minutes; n8n reports it as "The service was not able to process your request".
Retries plus the error workflow handle it, and the look-back window means nothing is missed. There may
be no matching incident on status.hubspot.com.
