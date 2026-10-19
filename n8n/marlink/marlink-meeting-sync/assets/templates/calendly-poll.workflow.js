import { workflow, node, trigger, ifElse, expr } from '@n8n/workflow-sdk';

const scheduleTrigger = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: { name: 'Every 5 Minutes', parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] } }, position: [0, 0] },
  output: [{}]
});

const listEvents = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'List Scheduled Events',
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
    parameters: {
      method: 'GET',
      url: 'https://api.calendly.com/scheduled_events',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          { name: 'user', value: '__CALENDLY_USER_URI__' },
          { name: 'min_start_time', value: expr("{{ $now.minus({ days: 14 }).toUTC().toISO() }}") },
          { name: 'max_start_time', value: expr("{{ $now.plus({ days: 365 }).toUTC().toISO() }}") },
          { name: 'sort', value: 'start_time:asc' },
          { name: 'count', value: '100' }
        ]
      },
      options: {}
    },
    credentials: { httpBearerAuth: { id: '__CALENDLY_CREDENTIAL_ID__', name: '__CALENDLY_CREDENTIAL_NAME__' } },
    position: [220, 0]
  },
  output: [{ collection: [{ uri: 'https://api.calendly.com/scheduled_events/abc', event_type: '__EVENT_TYPE_URI__', start_time: '2026-10-20T14:00:00.000000Z', status: 'active' }], pagination: { next_page: null } }]
});

const splitEvents = node({
  type: 'n8n-nodes-base.splitOut',
  version: 1,
  config: { name: 'Split Out Events', parameters: { fieldToSplitOut: 'collection', include: 'noOtherFields', options: {} }, position: [440, 0] },
  output: [{ uri: 'https://api.calendly.com/scheduled_events/abc', event_type: '__EVENT_TYPE_URI__', start_time: '2026-10-20T14:00:00.000000Z', status: 'active' }]
});

const filterEventType = node({
  type: 'n8n-nodes-base.filter',
  version: 2.3,
  config: {
    name: 'Filter Event Type',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
        conditions: [{ leftValue: expr('{{ $json.event_type }}'), rightValue: '__EVENT_TYPE_URI__', operator: { type: 'string', operation: 'equals' } }],
        combinator: 'and'
      },
      options: {}
    },
    position: [660, 0]
  },
  output: [{ uri: 'https://api.calendly.com/scheduled_events/abc', event_type: '__EVENT_TYPE_URI__', start_time: '2026-10-20T14:00:00.000000Z', status: 'active' }]
});

const getInvitees = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Get Invitees',
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
    parameters: {
      method: 'GET',
      url: expr('{{ $json.uri }}/invitees'),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: { parameters: [{ name: 'count', value: '100' }] },
      options: {}
    },
    credentials: { httpBearerAuth: { id: '__CALENDLY_CREDENTIAL_ID__', name: '__CALENDLY_CREDENTIAL_NAME__' } },
    position: [880, 0]
  },
  output: [{ collection: [{ uri: 'https://api.calendly.com/scheduled_events/abc/invitees/def', email: 'jane@acme.com', name: 'Jane Doe', status: 'active', no_show: null, rescheduled: false, old_invitee: null }] }]
});

const getKnownInvitees = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Get Known Invitees',
    executeOnce: true,
    alwaysOutputData: true,
    parameters: { resource: 'row', operation: 'get', dataTableId: { __rl: true, mode: 'list', value: '__STATE_TABLE_ID__', cachedResultName: '__STATE_TABLE_NAME__' }, returnAll: true },
    position: [1100, 0]
  },
  output: [{ id: 1, invitee_uri: 'https://api.calendly.com/scheduled_events/abc/invitees/def', status: 'active', start_time: '2026-10-20T14:00:00.000000Z', no_show: 'false' }]
});

const detectChanges = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Detect Changes',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: file('../code/calendly-poll-detect-changes.js') },
    position: [1320, 0]
  },
  output: [{ inviteeUri: 'https://api.calendly.com/scheduled_events/abc/invitees/def', status: 'active', startTime: '2026-10-20T14:00:00.000000Z', noShow: 'false', event: 'booked', gSheetStatus: 'Meeting', slackMsgStatus: '✅ Booked', leadEmail: 'jane@acme.com', calendlyName: 'Jane Doe', parsedStartTime: '2026-10-20 10:00:00', parsedStartTimeSlack: 'Tuesday, 20 Oct 2026 10:00 AM ET' }]
});

const getTab1Rows = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Get __TAB1_NAME__ Rows',
    executeOnce: true,
    alwaysOutputData: true,
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
    parameters: {
      resource: 'sheet',
      operation: 'read',
      documentId: { __rl: true, mode: 'id', value: '__SHEET_ID__' },
      sheetName: { __rl: true, mode: 'list', value: '__TAB1_LIST_VALUE__', cachedResultName: '__TAB1_NAME__', cachedResultUrl: 'https://docs.google.com/spreadsheets/d/__SHEET_ID__/edit#gid=__TAB1_GID__' },
      options: {}
    },
    credentials: { googleSheetsOAuth2Api: { id: '__SHEETS_CREDENTIAL_ID__', name: '__SHEETS_CREDENTIAL_NAME__' } },
    position: [1540, 0]
  },
  output: [{ row_number: 2, 'First Name': 'Jane', 'Last Name': 'Doe', Email: 'jane@acme.com' }]
});

const getTab2Rows = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Get __TAB2_NAME__ Rows',
    executeOnce: true,
    alwaysOutputData: true,
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
    parameters: {
      resource: 'sheet',
      operation: 'read',
      documentId: { __rl: true, mode: 'id', value: '__SHEET_ID__' },
      sheetName: { __rl: true, mode: 'list', value: '__TAB2_LIST_VALUE__', cachedResultName: '__TAB2_NAME__', cachedResultUrl: 'https://docs.google.com/spreadsheets/d/__SHEET_ID__/edit#gid=__TAB2_GID__' },
      options: {}
    },
    credentials: { googleSheetsOAuth2Api: { id: '__SHEETS_CREDENTIAL_ID__', name: '__SHEETS_CREDENTIAL_NAME__' } },
    position: [1760, 0]
  },
  output: [{ row_number: 5, 'First Name': 'John', 'Last Name': 'Roe', Email: 'john@roe.com' }]
});

const matchLeads = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Match Leads',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: file('../code/calendly-poll-match-leads.js') },
    position: [1980, 0]
  },
  output: [{ inviteeUri: 'https://api.calendly.com/scheduled_events/abc/invitees/def', status: 'active', startTime: '2026-10-20T14:00:00.000000Z', noShow: 'false', event: 'booked', gSheetStatus: 'Meeting', slackMsgStatus: '✅ Booked', leadEmail: 'jane@acme.com', parsedStartTime: '2026-10-20 10:00:00', parsedStartTimeSlack: 'Tuesday, 20 Oct 2026 10:00 AM ET', matches: [{ sheetName: 'Leads', gid: 0, row_number: 2 }], gSheetLead: { sheetName: 'Leads', gid: 0, row_number: 2 }, leadName: 'Jane Doe', dashboardUrl: 'https://docs.google.com/spreadsheets/d/x/edit?gid=0#gid=0' }]
});

const hasSheetUpdate = node({
  type: 'n8n-nodes-base.filter',
  version: 2.3,
  config: {
    name: 'In Dashboard With Update',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
        conditions: [
          { leftValue: expr('{{ !!$json.gSheetLead }}'), rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } },
          { leftValue: expr('{{ $json.event }}'), rightValue: '', operator: { type: 'string', operation: 'notEmpty', singleValue: true } }
        ],
        combinator: 'and'
      },
      options: {}
    },
    position: [2200, -200]
  },
  output: [{ matches: [{ sheetName: 'Leads', gid: 0, row_number: 2 }], gSheetStatus: 'Meeting', parsedStartTime: '2026-10-20 10:00:00' }]
});

const splitMatches = node({
  type: 'n8n-nodes-base.splitOut',
  version: 1,
  config: {
    name: 'Split Out Matches',
    parameters: { fieldToSplitOut: 'matches', include: 'selectedOtherFields', fieldsToInclude: 'gSheetStatus,parsedStartTime', options: {} },
    position: [2420, -200]
  },
  output: [{ matches: { sheetName: 'Leads', gid: 0, row_number: 2 }, gSheetStatus: 'Meeting', parsedStartTime: '2026-10-20 10:00:00' }]
});

const updateLeadMeeting = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Update Lead Meeting',
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
    parameters: {
      resource: 'sheet',
      operation: 'update',
      documentId: { __rl: true, mode: 'id', value: '__SHEET_ID__' },
      sheetName: { __rl: true, mode: 'name', value: expr('{{ $json.matches.sheetName }}') },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          row_number: expr('{{ $json.matches.row_number }}'),
          'Deal Stage': expr('{{ $json.gSheetStatus }}'),
          'Meeting Date & ET Time': expr('{{ $json.parsedStartTime }}')
        },
        matchingColumns: ['row_number'],
        schema: [
          { id: 'Deal Stage', displayName: 'Deal Stage', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true, removed: false },
          { id: 'Meeting Date & ET Time', displayName: 'Meeting Date & ET Time', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true, removed: false },
          { id: 'row_number', displayName: 'row_number', required: false, defaultMatch: false, display: true, type: 'number', canBeUsedToMatch: true, readOnly: true, removed: false }
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: false
      },
      options: {}
    },
    credentials: { googleSheetsOAuth2Api: { id: '__SHEETS_CREDENTIAL_ID__', name: '__SHEETS_CREDENTIAL_NAME__' } },
    position: [2640, -200]
  },
  output: [{ row_number: 2, 'Deal Stage': 'Meeting' }]
});

const shouldNotify = ifElse({
  version: 2.3,
  config: {
    name: 'Should Notify?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
        conditions: [{ leftValue: expr('{{ $json.event }}'), rightValue: '', operator: { type: 'string', operation: 'notEmpty', singleValue: true } }],
        combinator: 'and'
      },
      options: {}
    },
    position: [2200, 100]
  }
});

const sendSlackMessage = node({
  type: 'n8n-nodes-base.slack',
  version: 2.5,
  config: {
    name: 'Send Slack Message',
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
    parameters: {
      resource: 'message',
      operation: 'post',
      authentication: 'accessToken',
      select: 'channel',
      channelId: { __rl: true, mode: 'list', value: '__SLACK_CHANNEL_ID__', cachedResultName: '__SLACK_CHANNEL_NAME__' },
      messageType: 'block',
      blocksUi: expr('{{ {\n  "text": "Calendly meeting " + $json.slackMsgStatus,\n  "blocks": [\n    {\n      "type": "section",\n      "text": {\n        "type": "mrkdwn",\n        "text": "*Calendly Update*: " + $json.slackMsgStatus\n          + "\\n*Lead:* " + ($json.gSheetLead ? "" : "[NOT IN DASHBOARD] ") + $json.leadName + ", " + $json.leadEmail\n          + "\\n*Meeting Time:* " + $json.parsedStartTimeSlack\n          + "\\n<" + $json.dashboardUrl + "|__DASHBOARD_LABEL__>"\n      }\n    }\n  ]\n} }}'),
      otherOptions: {}
    },
    credentials: { slackApi: { id: '__SLACK_CREDENTIAL_ID__', name: '__SLACK_CREDENTIAL_NAME__' } },
    position: [2420, 0]
  },
  output: [{ ok: true }]
});

const saveInviteeState = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Save Invitee State',
    parameters: {
      resource: 'row',
      operation: 'upsert',
      dataTableId: { __rl: true, mode: 'list', value: '__STATE_TABLE_ID__', cachedResultName: '__STATE_TABLE_NAME__' },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'invitee_uri', condition: 'eq', keyValue: expr("{{ $('Match Leads').item.json.inviteeUri }}") }] },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          invitee_uri: expr("{{ $('Match Leads').item.json.inviteeUri }}"),
          status: expr("{{ $('Match Leads').item.json.status }}"),
          start_time: expr("{{ $('Match Leads').item.json.startTime }}"),
          no_show: expr("{{ $('Match Leads').item.json.noShow }}")
        },
        matchingColumns: [],
        schema: [
          { id: 'invitee_uri', displayName: 'invitee_uri', required: false, defaultMatch: false, display: true, type: 'string', readOnly: false, removed: false },
          { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', readOnly: false, removed: false },
          { id: 'start_time', displayName: 'start_time', required: false, defaultMatch: false, display: true, type: 'string', readOnly: false, removed: false },
          { id: 'no_show', displayName: 'no_show', required: false, defaultMatch: false, display: true, type: 'string', readOnly: false, removed: false }
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: false
      },
      options: {}
    },
    position: [2640, 100]
  },
  output: [{ id: 2, invitee_uri: 'https://api.calendly.com/scheduled_events/abc/invitees/def', status: 'active', start_time: '2026-10-20T14:00:00.000000Z', no_show: 'false' }]
});

export default workflow('calendly-meeting-events-poll', '__WORKFLOW_NAME__')
  .add(scheduleTrigger)
  .to(listEvents)
  .to(splitEvents)
  .to(filterEventType)
  .to(getInvitees)
  .to(getKnownInvitees)
  .to(detectChanges)
  .to(getTab1Rows)
  .to(getTab2Rows)
  .to(matchLeads)
  .to(hasSheetUpdate.to(splitMatches.to(updateLeadMeeting)))
  .add(matchLeads)
  .to(shouldNotify
    .onTrue(sendSlackMessage.to(saveInviteeState))
    .onFalse(saveInviteeState));
