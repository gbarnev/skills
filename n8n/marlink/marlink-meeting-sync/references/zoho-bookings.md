# Zoho Bookings

Read this when the client books through Zoho Bookings — for the token, the region, discovery, and the
API quirks the polling code relies on.

## Token (no Zoho login needed on our side)

Zoho has no personal API token: access tokens expire after 1 hour. Use a **Self Client**, which yields a
refresh token that doesn't expire. Client-facing steps are in the "Zoho Bookings Connection Setup" doc
(https://claude.ai/artifact/Sg42XUfiybnu5kL9F5q79E); in short:

1. A Zoho Bookings Super Admin/Admin opens the API Console for their region (`api-console.zoho.eu` for
   EU) → **Self Client** → copies the **Client ID** and **Client Secret** (these don't expire).
2. **Generate Code** tab: scope `zohobookings.data.CREATE` (Bookings' only scope; reads need it too),
   the longest duration → a one-time code.
3. The code works once and expires within minutes, so have the client send it straight away and exchange
   it at once (keep the values in mode-600 temp files, as with every token):

```bash
curl -s -X POST https://accounts.zoho.eu/oauth/v2/token --data-urlencode grant_type=authorization_code \
  --data-urlencode "client_id=$(cat client_id)" --data-urlencode "client_secret=$(cat client_secret)" --data-urlencode code=<CODE>
```

→ `refresh_token`, `access_token`, `api_domain`. `invalid_code` = expired or already used: the client
repeats step 2 (Client ID and Secret stay). `invalid_client` = the client lives in another region.

## Region

The account's data center decides every host: EU `accounts.zoho.eu` / `www.zohoapis.eu`, US
`accounts.zoho.com` / `www.zohoapis.com` (also `.in`, `.com.au`, `.jp`, `.uk`, `zohocloud.ca`, `.sa`).
The booking link's host shows it (`<org>.zohobookings.eu`). The token response's `api_domain` is the API
host; the template reads it from there, so only `ZOHO_ACCOUNTS_URL` is configured.

## n8n credential

The MCP can't create credentials. Ask the user for a **Custom Auth** credential named
"<Client> Zoho Bookings Refresh Token" holding:

```json
{ "qs": { "refresh_token": "…", "client_id": "…", "client_secret": "…", "grant_type": "refresh_token" } }
```

Write that JSON into a mode-600 file and hand it over with `pbcopy < file`, so the token never appears
in chat. `Refresh Zoho Token` posts it to `<accounts>/oauth/v2/token` on every run; `Fetch Appointments`
sends the 1-hour token as `Authorization: Zoho-oauthtoken <token>` (`Bearer` works too). The short-lived
access token shows in execution data; the refresh token stays in the credential.

## Discovery (read-only, `<api_domain>/bookings/v1/json/…`)

- `GET workspaces` → `id`, `name`.
- `GET services?workspace_id=…` → `id`, `name`, `duration`. A booking link
  `https://<org>.zohobookings.eu/<id>` ends with the service id to track.
- `GET staffs?workspace_id=…` → `role`. A Super Admin's token sees every booking.
- `POST fetchappointment` with **one form field `data` holding JSON**:
  `{"service_id", "from_time", "to_time", "per_page": 100}`, dates `dd-MMM-yyyy HH:mm:ss`. Plain form
  fields are ignored (the call succeeds and returns nothing). Omitting `status` returns every status.

## Appointment data the workflow relies on

- `booking_id`, e.g. `#IN-00005` — the state key.
- `status`, lowercase: `upcoming`, `yet_to_mark` (meeting passed, not marked), `cancel`, `completed`,
  `no_show`; the docs also list `ongoing`, `pending`, `pending_payment`. Everything except `cancel`,
  `completed` and `no_show` counts as still standing.
- `iso_start_time` in UTC (`2026-11-05T10:00:00+00:00`). Never use `start_time`: it is in the account's
  business time zone, which can be wrong (Integrity IT's was set to Asia/Calcutta).
- `customer_email`, `customer_name`; `triggered_from` is `booking_page` or `in_app`.
- An empty result is `returnvalue.response = "No Match Found"` (a string, not `[]`).
- `next_page_available: true` makes `Detect Changes` throw. Add paging only if a client ever has more
  than 100 bookings in the window (14 days back, 365 ahead).

## Reschedules

Not observed yet whether a reschedule keeps the `booking_id`. The code covers both cases: a new time on
the same id → "🔁 Rescheduled"; a cancel plus a new booking → "❌ Canceled" then "✅ Booked" (this is
also how an admin cancelling and re-booking in the app shows up). Update this section once a real
reschedule has been seen.

## Limits

API calls per user per day: Free 250, Basic 1,000, Premium 3,000; token requests don't count.
Polling every 10 minutes uses 144, so every plan works.

## State table and seeding

Data Table columns (strings): `booking_id`, `status`, `start_time` (exactly `iso_start_time`). Before
publishing, insert every booking of the tracked service in the window so the first run is quiet.

## Revoking

The client deletes the Self Client in the API Console, or we unpublish the workflow.
