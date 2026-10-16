---
name: marlink-meeting-sync
description: Build, clone or debug Marlink's n8n "Handle Meeting Events" automations that sync a client's booking tool (Calendly or HubSpot Meetings) into the client's Leads Dashboard Google Sheet (Deal Stage + "Meeting Date & ET Time") and post booked / cancelled / rescheduled / no-show updates to the client's Slack channel, flagging unknown leads as "[NOT IN DASHBOARD]". Use whenever the user wants to connect a new Marlink or Marlink Accelerate client, says "integrate" or "do the same as the Calendly workflow" for a client, pastes a Calendly token or HubSpot service key together with a leads sheet or Slack channel, or asks why one of these meeting workflows failed — even if they don't name this skill.
---

# Marlink meeting sync (n8n)

Every Marlink client gets one n8n workflow that watches the client's booking tool. When a meeting is
booked, cancelled, rescheduled or marked no-show, it finds the lead in the client's **Leads Dashboard**
sheet, updates that row, and posts to the client's Slack channel. This skill holds the conventions,
three proven workflow templates, and the traps found while building them, so a new client takes one
short intake plus a render-validate-create pass instead of a rebuild.

## Conventions (keep these identical across clients)

| Booking change | Sheet "Deal Stage" | Slack status |
|---|---|---|
| Booked | `Meeting` | ✅ Booked |
| Rescheduled / time moved | `Meeting` (new time) | 🔁 Rescheduled |
| Cancelled | `Meeting Cancelled` | ❌ Canceled |
| No-show marked | `No show` | ⚠️ No-show |
| No-show removed | `Meeting` | ↩️ No-show removed |

- **Lead lookup**: the sheet's `Email` column, case-insensitive; a cell may hold several comma-separated
  addresses. A client can have several lead tabs (e.g. "Leads" and "LinkedIn Leads"); update every row
  that matches.
- **Sheet write**: `Deal Stage` and `Meeting Date & ET Time` (`yyyy-MM-dd HH:mm:ss`, America/New_York),
  matched on `row_number`. Nothing else in the row is touched.
- **Slack** (block message, posted as the shared bot):
  `*<Tool> Update*: ✅ Booked` / `*Lead:* [NOT IN DASHBOARD] Jane Doe, jane@acme.com` /
  `*Meeting Time:* Tuesday, 20 Oct 2026 10:00 AM ET` / link `<Client> Leads Dashboard`.
  If the lead isn't in the sheet, post with the `[NOT IN DASHBOARD]` prefix and skip the sheet write.
- **Where**: n8n folder **Marlink Accelerate**, name `<Calendly|HubSpot> Handle Meeting Events - <Client>`.
- **Shared credentials**: Google Sheets "Marly Google Sheets", Slack "Marly n8n Bot". Look up their
  IDs with `list_credentials`. Reuse the error workflow set on the existing meeting workflows (read
  `settings.errorWorkflow` from one with `get_workflow_details`).
- Every HTTP, Sheets and Slack node retries 3× with 5 s waits (`retryOnFail`), so brief API blips
  don't page anyone.

## Choose the variant

| Booking tool | Situation | Template (`assets/templates/`) |
|---|---|---|
| Calendly | paid plan (Standard or higher) | `calendly-webhook` — instant, HMAC-verified webhook |
| Calendly | free plan (creating a webhook → 403 "Please upgrade your Calendly account to Standard") | `calendly-poll` — checks every 5 min |
| HubSpot Meetings | service key / private-app token | `hubspot-poll` — checks every 5 min |

HubSpot can only push events through the "Send a webhook" workflow action, which needs Data Hub
Professional or Enterprise; polling avoids that cost. Polling variants keep a small **Data Table** of
what was already handled, which is what prevents duplicate Slack posts and lets each run look back days
without re-announcing anything. When the choice involves money (a Calendly upgrade), ask the user;
otherwise default to what works on the client's current plan.

## Intake

Ask the user only for what you can't discover:

1. **Client name and booking tool.**
2. **The API token.**
   - Calendly personal access token with `users:read`, `event_types:read`, `scheduled_events:read`
     (+ `webhooks:read`/`webhooks:write` for the webhook variant).
   - HubSpot service key: the `pat-…` string, not the numeric key ID.
3. **Which booking page / meeting type.** List them yourself, with recent booking counts, and recommend
   the active one.
4. **The sheet URL**, and which tab(s) to search.
5. **The Slack channel.** The bot must be in it: `/invite @Marly n8n Bot`.

Then ask the user to do two things only they can do:
- Add a `Meeting Date & ET Time` column to each tracked tab. You can read their sheets through n8n, but
  you shouldn't restructure a client's sheet.
- Create an n8n **Bearer Auth** credential holding the token and tell you its name. The n8n MCP can't
  create credentials, and tokens must live in credentials, not in node fields.

Discover the rest yourself; `references/n8n-build.md` lists the exact MCP calls:
- tabs and their list values
- header columns
- the Slack channel ID
- credential IDs
- the folder ID
- the error workflow

## Build

1. **Verify the token and collect IDs** with read-only API calls (see `references/calendly.md` or
   `references/hubspot.md`):
   - Calendly: user, organization and event-type URIs.
   - HubSpot: the scheduling page ID and the client's internal email domains.
   - Check that the plan supports what you're about to build.
2. **Polling variants: create the state Data Table and seed it** with the current state of every existing
   booking for the tracked page or event type. Otherwise the first run announces old meetings.
   - Columns for HubSpot: `meeting_id, outcome, start_time`.
   - Columns for Calendly: `invitee_uri, status, start_time, no_show`.
3. **Write a config JSON** next to the template's `*.config.example.json`, but outside any git repo,
   because it may hold a webhook secret. Then render:
   `node scripts/render-workflow.mjs assets/templates/<variant>.workflow.js <config.json> <out.js>`.
   - Single-tab client on a two-tab template: delete the second `Get … Rows` node and its line in the
     `TABS` array of the Code-node file.
   - Three tabs: add one more of each.
4. **Test the logic**: `node scripts/test-code-nodes.mjs <config.json>` (needs `luxon`; run
   `npm i --no-save luxon` if it's missing).
5. **Create the workflow**: run `validate_workflow` on the rendered code, then `create_workflow_from_code`
   with `projectId` + `folderId`.
6. **Attach credentials and settings** with `update_workflow`:
   - `setNodeCredential` on every HTTP, Sheets and Slack node. Auto-assignment skips HTTP nodes.
   - `setWorkflowSettings` with `errorWorkflow`, `callerPolicy: workflowsFromSameOwner`,
     `executionOrder: v1`.
7. **Read it back** with `get_workflow_details` and check the connections. The sheet-update branch must
   sit above (run before) the Slack branch, and state is saved only after Slack succeeds, so a failed
   post is retried on the next run.
8. **Test without side effects, then publish.**
   - Polling: a manual `execute_workflow` should stop at `Detect Changes` with nothing new.
   - Webhook: publish first, then send the signed, non-matching request from `references/calendly.md`.
   - Then `publish_workflow`, and for the webhook variant create the Calendly webhook subscription with
     the same signing key.
9. **Check it's running.** A few runs later, `search_workflow_executions` should show only `success`.

**Ask before any test that posts to the client's Slack or writes to the client's sheet.** It's the
client's live data. The cleanest live test is to leave the most recent real booking out of the seed,
so the first run processes it, but only with the user's OK.

## Secrets and judgement calls

- **Tokens.** Keep them out of chat output, configs, commits and node parameters. If you must call an
  API directly, keep the token in a mode-600 temp file and delete it when done.
- **The webhook signing secret** is generated fresh per client (32 random characters). It sits in the
  workflow's Config node, because Code nodes can't read credentials. Never commit it.
- **Over-broad token scopes**: mention it once. If the user decides to keep the token, don't raise it
  again.
- **Small UI-only actions** (adding a column, creating a credential, inviting the bot): ask the user
  with exact steps rather than building a workaround.
- **Lead declines the calendar invite**: neither tool records this. Tell the user the client's team
  should mark the meeting as cancelled (for HubSpot, set the meeting's Outcome to "Canceled"). Cancels
  through the booking emails' links are picked up automatically.

## Files

- `assets/templates/*.workflow.js`: n8n Workflow SDK templates with `__PLACEHOLDER__` values and
  `file('../code/…')` Code nodes. Each has a `*.config.example.json` listing every key.
- `assets/code/*.js`: the Code-node scripts (status detection, lead matching, Calendly signature check),
  the same logic as the live workflows.
- `scripts/render-workflow.mjs`: fills placeholders and inlines the code into SDK-valid output. It fails
  on missing keys or leftover placeholders.
- `scripts/test-code-nodes.mjs`: runs every Code-node script against the status-transition and matching
  cases.
- `references/calendly.md`: scopes, discovery, plan limits, webhook subscription and signing, the signed
  test request, reschedule and no-show semantics.
- `references/hubspot.md`: service keys, booking pages, meeting properties, contact lookup, what HubSpot
  can't see, transient 500s.
- `references/n8n-build.md`: the MCP calls for each step, SDK validator traps, node behaviours the
  templates rely on, how to read failed executions.
