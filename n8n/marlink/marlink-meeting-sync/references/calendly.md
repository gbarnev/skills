# Calendly

Read this when the client books through Calendly — for discovery, choosing webhook vs polling,
creating the webhook subscription, and the reschedule/no-show semantics the code relies on.

## Token and scopes

Clients send a Calendly **personal access token** (a long JWT starting `eyJ…`). Newer tokens are
scoped; decode the middle part (base64url JSON) to see `scope` and `user_uuid`. Calendly answers 403
with `required_scopes` when one is missing — use that to tell the user exactly what to add.

| Need | Endpoint | Scope |
|---|---|---|
| Who the token belongs to, the organization URI | `GET /users/me` | `users:read` |
| Meeting types (pick the one to track) | `GET /event_types?user=<user uri>` | `event_types:read` |
| Bookings (polling) | `GET /scheduled_events?user=…` and `GET <event uri>/invitees` | `scheduled_events:read` |
| Webhook subscriptions | `GET/POST /webhook_subscriptions` | `webhooks:read` / `webhooks:write` |

A webhooks-only token is not enough even for the webhook variant: creating a subscription needs the
organization URI, which only `/users/me` (`users:read`) returns. Ask for a token with
`users:read`, `event_types:read`, `scheduled_events:read` (+ `webhooks:read/write` for the webhook
variant).

## Discovery (read-only)

```python
import json, subprocess, urllib.parse, datetime
T = open("cal.token").read().strip()          # keep the token in a 600 file, delete it afterwards
def get(url, **q):
    if q: url += "?" + urllib.parse.urlencode(q)
    return json.loads(subprocess.run(["curl", "-s", "-H", f"Authorization: Bearer {T}", url], capture_output=True, text=True).stdout)
me = get("https://api.calendly.com/users/me")["resource"]
U, O = me["uri"], me["current_organization"]
for e in get("https://api.calendly.com/event_types", user=U, count=100)["collection"]:
    print(e["active"], e["name"], e["scheduling_url"], e["uri"])
since = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=180)).strftime("%Y-%m-%dT%H:%M:%SZ")
events = get("https://api.calendly.com/scheduled_events", user=U, count=100, min_start_time=since)["collection"]   # follow pagination.next_page_token if needed
print(get("https://api.calendly.com/webhook_subscriptions", organization=O, scope="user", user=U))
```

Count bookings per `event_type` to show the user which meeting type is the "obvious one". Check
existing webhook subscriptions so you don't create a duplicate.

## Plan check: webhook or polling

Webhook subscriptions require a paid plan. On the free plan
`POST /webhook_subscriptions` returns **403 `Please upgrade your Calendly account to Standard`**.
Reads (event types, scheduled events, invitees) still work on free, so use the polling template.
Ask the user before choosing — an upgrade gives instant notifications, polling is free with ≤5 min delay.

## Webhook variant

Subscription (create it only after the workflow is published, so the URL is live):

```json
POST https://api.calendly.com/webhook_subscriptions
{
  "url": "https://<n8n host>/webhook/<WEBHOOK_PATH>",
  "events": ["invitee.created", "invitee.canceled", "invitee_no_show.created", "invitee_no_show.deleted"],
  "organization": "<current_organization>",
  "user": "<user uri>",
  "scope": "user",
  "signing_key": "<same value as WEBHOOK_SECRET>"
}
```

Generate the signing key fresh per client (`python3 -c "import secrets,string;print(''.join(secrets.choice(string.ascii_letters+string.digits) for _ in range(32)))"`).
It ends up in the workflow's Config node (Code nodes can't read n8n credentials); never commit it.

Signature: header `Calendly-Webhook-Signature: t=<unix>,v1=<hex>` where
`hex = HMAC_SHA256(signing_key, t + "." + rawBody)`. The Webhook node must have `options.rawBody: true`
so the exact bytes are available as binary `data`; `Authenticate Webhook` reads them with
`this.helpers.getBinaryDataBuffer` (works in every binary storage mode).

Payload paths used: `body.event`, `body.payload.email`, `body.payload.name` (or `first_name`/`last_name`),
`body.payload.scheduled_event.{event_type,start_time,name}`.

Safe live test (no Slack post, no sheet write) — sign a request whose `event_type` is not the tracked one;
the run must pass `Is Authentic?` and stop at `Filter Calendly Event Type`:

```bash
KEY=$(cat signing.key); TS=$(date +%s)
BODY='{"event":"invitee.created","payload":{"email":"signature-test@example.com","scheduled_event":{"event_type":"https://api.calendly.com/event_types/00000000-0000-0000-0000-000000000000","start_time":"2026-01-01T14:00:00.000000Z"}}}'
SIG=$(printf '%s' "$TS.$BODY" | openssl dgst -sha256 -hmac "$KEY" -hex | awk '{print $NF}')
curl -s -X POST "https://<n8n host>/webhook/<WEBHOOK_PATH>" -H "Content-Type: application/json" \
  -H "Calendly-Webhook-Signature: t=$TS,v1=$SIG" --data-binary "$BODY"
```

Then read the execution: `Authenticate Webhook` → `isAuthentic: true`, filter output empty.

In the webhook variant a reschedule arrives as `invitee.canceled` (with `payload.rescheduled: true`)
followed by `invitee.created`, so Slack shows "❌ Canceled" then "✅ Booked" — same as the original
Calendly workflow.

## Polling variant

- `List Scheduled Events`: `user`, `min_start_time = now − 14 days` (no-shows are marked after the
  meeting), `max_start_time = now + 365 days`, `sort=start_time:asc`, `count=100`. Omitting `status`
  returns active and canceled events.
- `Get Invitees`: `GET <event uri>/invitees?count=100` per event.
- State is per **invitee URI** (a reschedule creates a new invitee). Data Table columns, all strings:
  `invitee_uri`, `status` (`active`/`canceled`), `start_time` (exactly as Calendly returns it, e.g.
  `2026-10-14T17:00:00.000000Z`), `no_show` (`"true"`/`"false"`).
- Reschedule: the old invitee becomes `status: canceled, rescheduled: true` (recorded silently) and the
  new invitee has `old_invitee` set → one "🔁 Rescheduled" message with the new time.
- No-show: `invitee.no_show` becomes an object when the host marks it; back to `null` when removed.
- Seed the table with every current invitee in the window before publishing, otherwise the first run
  announces old bookings. Luxon parses Calendly's microsecond timestamps fine.
