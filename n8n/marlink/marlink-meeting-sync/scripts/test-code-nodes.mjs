#!/usr/bin/env node
// Runs every Code-node script in assets/code against stubbed n8n globals ($, $input, DateTime,
// this.helpers) for the status transitions and lead-matching cases these workflows must handle.
//
//   node scripts/test-code-nodes.mjs [config.json]
//
// Needs luxon (n8n's DateTime). If it isn't resolvable: `npm i --no-save luxon` in this folder.
// Pass a real client config to test the rendered code with that client's tabs/domains.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { fill } from './render-workflow.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const codeDir = path.join(here, '..', 'assets', 'code');
const templatesDir = path.join(here, '..', 'assets', 'templates');

function loadLuxon() {
  for (const base of [here, process.cwd()]) {
    try {
      return createRequire(path.join(base, 'noop.js'))('luxon');
    } catch {}
  }
  console.error('luxon not found — run `npm i --no-save luxon` in this folder (or any parent) and retry.');
  process.exit(2);
}
const { DateTime } = loadLuxon();
const require = createRequire(import.meta.url);

const defaultConfig = {
  ...JSON.parse(fs.readFileSync(path.join(templatesDir, 'calendly-poll.config.example.json'), 'utf8')),
  ...JSON.parse(fs.readFileSync(path.join(templatesDir, 'hubspot-poll.config.example.json'), 'utf8')),
};
const config = process.argv[2] ? { ...defaultConfig, ...JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) } : defaultConfig;
const code = (name, overrides = {}) => fill(fs.readFileSync(path.join(codeDir, name), 'utf8'), { ...config, ...overrides }, name);

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const run = (src, globals, self = {}) =>
  new AsyncFunction('require', 'DateTime', ...Object.keys(globals), src).call(self, require, DateTime, ...Object.values(globals));
const nodes = (map) => (name) => {
  if (!(name in map)) throw new Error(`test stub has no node "${name}"`);
  const items = map[name].map((json) => ({ json }));
  return { all: () => items, first: () => items[0] };
};
const input = (rows) => ({ all: () => rows.map((json) => ({ json })) });

let failures = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`}`);
}

const T1 = '2026-10-13T14:00:00Z';
const T2 = '2026-10-14T15:00:00Z';

// HubSpot: Detect Changes
{
  const src = code('hubspot-detect-changes.js');
  const meeting = (outcome, start = T1) => ({ id: '1', properties: { hs_meeting_outcome: outcome, hs_meeting_start_time: start } });
  const known = (outcome, start = T1) => ({ meeting_id: '1', outcome, start_time: start });
  const cases = [
    ['new booking', meeting('SCHEDULED'), [{}], 'booked'],
    ['new booking, empty outcome', meeting(null), [], 'booked'],
    ['unchanged', meeting('SCHEDULED'), [known('SCHEDULED')], null],
    ['cancelled', meeting('CANCELED'), [known('SCHEDULED')], 'canceled'],
    ['cancelled, time changed', meeting('CANCELED', T2), [known('CANCELED')], ''],
    ['no-show', meeting('NO_SHOW'), [known('SCHEDULED')], 'no_show'],
    ['no-show removed (completed)', meeting('COMPLETED'), [known('NO_SHOW')], 'no_show_removed'],
    ['completed', meeting('COMPLETED'), [known('SCHEDULED')], ''],
    ['time moved', meeting('SCHEDULED', T2), [known('SCHEDULED')], 'rescheduled'],
    ['marked rescheduled', meeting('RESCHEDULED'), [known('SCHEDULED')], 'rescheduled'],
    ['re-booked after cancel', meeting('SCHEDULED'), [known('CANCELED')], 'booked'],
  ];
  for (const [name, m, rows, want] of cases) {
    const out = await run(src, { $: nodes({ 'Search Booked Meetings': [{ results: [m] }] }), $input: input(rows) });
    check(`hubspot detect: ${name}`, out.length ? out[0].json.event : null, want);
  }
  const [booked] = await run(src, { $: nodes({ 'Search Booked Meetings': [{ results: [meeting('SCHEDULED')] }] }), $input: input([]) });
  check('hubspot detect: ET formatting', [booked.json.parsedStartTime, booked.json.parsedStartTimeSlack], ['2026-10-13 10:00:00', 'Tuesday, 13 Oct 2026 10:00 AM ET']);
}

// HubSpot: Match Leads (skips internal host contact, matches comma-separated Email cells)
{
  const src = code('hubspot-match-leads.js');
  const internal = config.INTERNAL_EMAIL_DOMAINS[0];
  const out = await run(src, {
    $: nodes({
      'Detect Changes': [{ meetingId: '1', event: 'booked' }, { meetingId: '2', event: 'booked' }],
      'Get Contact Details': [
        { results: [{ properties: { email: `host@${internal}`, firstname: 'Host' } }, { properties: { email: 'Jane@Acme.com ', firstname: 'Jane', lastname: 'Doe' } }] },
        { results: [{ properties: { email: `host@${internal}` } }, { properties: { email: 'bob@other.com', firstname: 'Bob' } }] },
      ],
    }),
    $input: input([{ row_number: 5, Email: 'x@y.com, jane@acme.com' }]),
  });
  check('hubspot match: lead in sheet', [out[0].json.gSheetLead?.row_number, out[0].json.leadEmail], [5, 'jane@acme.com']);
  check('hubspot match: not in sheet, internal skipped', [out[1].json.gSheetLead, out[1].json.leadEmail, out[1].json.leadFirstName], [null, 'bob@other.com', 'Bob']);
}

// Calendly polling: Detect Changes
{
  const src = code('calendly-poll-detect-changes.js');
  const invitee = (extra = {}) => ({ uri: 'I1', email: 'jane@acme.com', name: 'Jane Doe', status: 'active', no_show: null, rescheduled: false, old_invitee: null, ...extra });
  const known = (extra = {}) => ({ invitee_uri: 'I1', status: 'active', start_time: T1, no_show: 'false', ...extra });
  const cases = [
    ['new booking', invitee(), [{}], 'booked'],
    ['unchanged', invitee(), [known()], null],
    ['cancelled', invitee({ status: 'canceled' }), [known()], 'canceled'],
    ['cancel caused by reschedule (silent)', invitee({ status: 'canceled', rescheduled: true }), [known()], ''],
    ['new invitee from reschedule', invitee({ old_invitee: 'I0' }), [], 'rescheduled'],
    ['booked and cancelled between checks', invitee({ status: 'canceled' }), [], 'canceled'],
    ['no-show marked', invitee({ no_show: { uri: 'N' } }), [known()], 'no_show'],
    ['no-show removed', invitee(), [known({ no_show: 'true' })], 'no_show_removed'],
    ['no-show unchanged', invitee({ no_show: { uri: 'N' } }), [known({ no_show: 'true' })], null],
  ];
  for (const [name, inv, rows, want] of cases) {
    const out = await run(src, {
      $: nodes({ 'Filter Event Type': [{ uri: 'E1', start_time: '2026-10-13T14:00:00.000000Z' }], 'Get Invitees': [{ collection: [inv] }] }),
      $input: input(rows.map((r) => (r.start_time ? { ...r, start_time: '2026-10-13T14:00:00.000000Z' } : r))),
    });
    check(`calendly detect: ${name}`, out.length ? out[0].json.event : null, want);
  }
  const zones = [
    ['America/New_York', 'ET', ['2026-10-13 10:00:00', 'Tuesday, 13 Oct 2026 10:00 AM ET']],
    ['Europe/Sofia', '(Sofia)', ['2026-10-13 17:00:00', 'Tuesday, 13 Oct 2026 5:00 PM (Sofia)']],
  ];
  for (const [zone, label, want] of zones) {
    const [booked] = await run(code('calendly-poll-detect-changes.js', { TIME_ZONE: zone, TIME_ZONE_LABEL: label }), {
      $: nodes({ 'Filter Event Type': [{ uri: 'E1', start_time: '2026-10-13T14:00:00.000000Z' }], 'Get Invitees': [{ collection: [invitee()] }] }),
      $input: input([]),
    });
    check(`calendly detect: ${zone} formatting`, [booked.json.parsedStartTime, booked.json.parsedStartTimeSlack], want);
  }
}

// Calendly polling: Match Leads across both tabs
{
  const src = code('calendly-poll-match-leads.js');
  const out = await run(src, {
    $: nodes({
      'Detect Changes': [{ leadEmail: 'jane@acme.com', calendlyName: 'Jane Doe', event: 'booked' }, { leadEmail: 'Bob@B.com', calendlyName: '', event: 'booked' }],
      [`Get ${config.TAB1_NAME} Rows`]: [{}],
      [`Get ${config.TAB2_NAME} Rows`]: [{ row_number: 9, Email: 'bob@b.com', 'First Name': 'Bob', 'Last Name': 'B' }],
    }),
  });
  check('calendly match: not in dashboard', [out[0].json.gSheetLead, out[0].json.leadName], [null, 'Jane Doe']);
  check('calendly match: found in second tab', [out[1].json.matches.map((m) => `${m.sheetName}:${m.row_number}`), out[1].json.leadName], [[`${config.TAB2_NAME}:9`], 'Bob B']);
  check('calendly match: link points at matched tab', out[1].json.dashboardUrl.endsWith(`gid=${config.TAB2_GID}#gid=${config.TAB2_GID}`), true);
}

// Calendly webhook: signature check
{
  const src = code('calendly-webhook-authenticate.js');
  const secret = 'test-secret';
  const body = JSON.stringify({ event: 'invitee.created', payload: { email: 'jane@acme.com' } });
  const sign = (raw, key = secret, t = '1791979200') => `t=${t},v1=` + crypto.createHmac('sha256', key).update(`${t}.${raw}`).digest('hex');
  const auth = async (headers, raw) => {
    const items = [{ json: { headers, body: JSON.parse(body) }, binary: raw === undefined ? undefined : { data: {} } }];
    const self = { helpers: { getBinaryDataBuffer: async () => Buffer.from(raw, 'utf8') } };
    const out = await run(src, { $: () => ({ first: () => ({ json: { webhookSecret: secret } }) }), $input: { all: () => items } }, self);
    return out[0].json.isAuthentic;
  };
  check('webhook auth: valid signature', await auth({ 'Calendly-Webhook-Signature': sign(body) }, body), true);
  check('webhook auth: tampered body', await auth({ 'calendly-webhook-signature': sign(body) }, body.replace('jane', 'evil')), false);
  check('webhook auth: wrong secret', await auth({ 'calendly-webhook-signature': sign(body, 'other') }, body), false);
  check('webhook auth: missing header', await auth({}, body), false);
  check('webhook auth: missing raw body', await auth({ 'calendly-webhook-signature': sign(body) }, undefined), false);
}

// Calendly webhook: Find Lead Rows
{
  const src = code('calendly-webhook-find-lead.js');
  const find = async (email, tab1, tab2, payloadExtra = {}) => {
    const out = await run(src, {
      $: nodes({
        'Parse Properties': [{ body: { payload: { email, ...payloadExtra } }, gSheetStatus: 'Meeting' }],
        [`Get ${config.TAB1_NAME} Rows`]: tab1,
        [`Get ${config.TAB2_NAME} Rows`]: tab2,
      }),
    });
    return out[0].json;
  };
  const both = await find('Jane@Acme.com', [{ row_number: 2, Email: 'jane@acme.com' }], [{ row_number: 7, Email: 'JANE@acme.com' }], { name: 'Jane Doe' });
  check('webhook find: match in both tabs', both.matches.map((m) => `${m.sheetName}:${m.row_number}`), [`${config.TAB1_NAME}:2`, `${config.TAB2_NAME}:7`]);
  const none = await find('nobody@z.com', [{}], [{}], { first_name: 'No', last_name: 'Body' });
  check('webhook find: not in dashboard', [none.gSheetLead, none.leadName], [null, 'No Body']);
}

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
