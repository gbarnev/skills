import { workflow, node, trigger, ifElse, expr } from '@n8n/workflow-sdk';

const webhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Webhook',
    parameters: { httpMethod: 'POST', path: '__WEBHOOK_PATH__', options: { rawBody: true } },
    position: [0, 0]
  },
  output: [{ headers: { 'calendly-webhook-signature': 't=1,v1=abc' }, body: { event: 'invitee.created', payload: { email: 'jane@acme.com', name: 'Jane Doe', scheduled_event: { event_type: '__EVENT_TYPE_URI__', name: 'Discovery Call', start_time: '2026-10-20T14:00:00.000000Z' } } } }]
});

const executionData = node({
  type: 'n8n-nodes-base.executionData',
  version: 1.1,
  config: {
    name: 'Execution Data',
    parameters: {
      dataToSave: {
        values: [
          { key: 'event', value: expr('{{ $json.body.event }}') },
          { key: 'email', value: expr('{{ $json.body.payload.email }}') },
          { key: 'name', value: expr('{{ $json.body.payload.name }}') },
          { key: 'event_name', value: expr('{{ $json.body.payload.scheduled_event.name }}') },
          { key: 'start_time', value: expr('{{ $json.body.payload.scheduled_event.start_time }}') },
          { key: 'timezone', value: expr('{{ $json.body.payload.timezone }}') }
        ]
      }
    },
    position: [220, 0]
  },
  output: [{ body: { event: 'invitee.created' } }]
});

const config = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Config',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      include: 'all',
      assignments: {
        assignments: [
          { id: 'b1f7c3a2-1d4e-4f6a-9b8c-0a1b2c3d4e51', name: 'webhookSecret', value: '__WEBHOOK_SECRET__', type: 'string' },
          { id: 'b1f7c3a2-1d4e-4f6a-9b8c-0a1b2c3d4e52', name: 'calendlyUserUri', value: '__CALENDLY_USER_URI__', type: 'string' },
          { id: 'b1f7c3a2-1d4e-4f6a-9b8c-0a1b2c3d4e53', name: 'calendlyEventUri', value: '__EVENT_TYPE_URI__', type: 'string' },
          { id: 'b1f7c3a2-1d4e-4f6a-9b8c-0a1b2c3d4e54', name: 'usedTimeZone', value: 'America/New_York', type: 'string' }
        ]
      },
      options: { includeBinary: true, stripBinary: false }
    },
    position: [440, 0]
  },
  output: [{ webhookSecret: 'secret', calendlyEventUri: '__EVENT_TYPE_URI__' }]
});

const authenticateWebhook = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Authenticate Webhook',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: file('../code/calendly-webhook-authenticate.js') },
    position: [660, 0]
  },
  output: [{ isAuthentic: true }]
});

const isAuthentic = ifElse({
  version: 2.3,
  config: {
    name: 'Is Authentic?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
        conditions: [{ leftValue: expr('{{ $json.isAuthentic }}'), rightValue: true, operator: { type: 'boolean', operation: 'equals' } }],
        combinator: 'and'
      },
      options: {}
    },
    position: [880, 0]
  }
});

const stopAndError = node({
  type: 'n8n-nodes-base.stopAndError',
  version: 1,
  config: { name: 'Stop and Error', parameters: { errorMessage: 'Unauthenticated request!' }, position: [1100, 200] },
  output: [{}]
});

const filterEventType = node({
  type: 'n8n-nodes-base.filter',
  version: 2.3,
  config: {
    name: 'Filter Calendly Event Type',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
        conditions: [{ leftValue: expr('{{ $json.body.payload.scheduled_event.event_type }}'), rightValue: expr("{{ $('Config').first().json.calendlyEventUri }}"), operator: { type: 'string', operation: 'equals' } }],
        combinator: 'and'
      },
      options: {}
    },
    position: [1100, -20]
  },
  output: [{ body: { event: 'invitee.created' } }]
});

const parseProperties = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Parse Properties',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      include: 'all',
      assignments: {
        assignments: [
          { id: 'c2a8d4b3-2e5f-4a7b-8c9d-1b2c3d4e5f61', name: 'gSheetStatus', value: expr("{{ $json.body.event === 'invitee.created' ? \"Meeting\" :\n  $json.body.event === 'invitee.canceled' ? \"Meeting Cancelled\" :\n  $json.body.event === 'invitee_no_show.created' ? \"No show\" :\n  $json.body.event === 'invitee_no_show.deleted' ? \"Meeting\" :\n  undefined\n}}"), type: 'string' },
          { id: 'c2a8d4b3-2e5f-4a7b-8c9d-1b2c3d4e5f62', name: 'slackMsgStatus', value: expr("{{ $json.body.event === 'invitee.created' ? \"✅ Booked\" :\n  $json.body.event === 'invitee.canceled' ? \"❌ Canceled\" :\n  $json.body.event === 'invitee_no_show.created' ? \"⚠️ No-show\" :\n  $json.body.event === 'invitee_no_show.deleted' ? \"↩️ No-show removed\" :\n  undefined\n}}"), type: 'string' },
          { id: 'c2a8d4b3-2e5f-4a7b-8c9d-1b2c3d4e5f63', name: 'parsed_start_time', value: expr("{{ DateTime.fromISO($json.body.payload.scheduled_event.start_time).setZone('America/New_York').toFormat('yyyy-MM-dd HH:mm:ss') }}"), type: 'string' },
          { id: 'c2a8d4b3-2e5f-4a7b-8c9d-1b2c3d4e5f64', name: 'parsed_start_time_slack', value: expr("{{ DateTime.fromISO($json.body.payload.scheduled_event.start_time).setZone('America/New_York').toFormat('cccc, dd MMM yyyy h:mm a') + ' ET' }}"), type: 'string' }
        ]
      },
      options: { includeBinary: false }
    },
    position: [1320, -20]
  },
  output: [{ body: { event: 'invitee.created', payload: { email: 'jane@acme.com' } }, gSheetStatus: 'Meeting', slackMsgStatus: '✅ Booked', parsed_start_time: '2026-10-20 10:00:00', parsed_start_time_slack: 'Tuesday, 20 Oct 2026 10:00 AM ET' }]
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
    position: [1540, -20]
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
    position: [1760, -20]
  },
  output: [{ row_number: 5, 'First Name': 'John', 'Last Name': 'Roe', Email: 'john@roe.com' }]
});

const findLeadRows = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Find Lead Rows',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: file('../code/calendly-webhook-find-lead.js') },
    position: [1980, -20]
  },
  output: [{ gSheetStatus: 'Meeting', slackMsgStatus: '✅ Booked', parsed_start_time: '2026-10-20 10:00:00', parsed_start_time_slack: 'Tuesday, 20 Oct 2026 10:00 AM ET', matches: [{ sheetName: 'Leads', gid: 0, row_number: 2, firstName: 'Jane', lastName: 'Doe' }], gSheetLead: { sheetName: 'Leads', gid: 0, row_number: 2 }, leadName: 'Jane Doe', leadEmail: 'jane@acme.com', dashboardUrl: 'https://docs.google.com/spreadsheets/d/x/edit?gid=0#gid=0' }]
});

const splitOutMatches = node({
  type: 'n8n-nodes-base.splitOut',
  version: 1,
  config: {
    name: 'Split Out Matches',
    parameters: { fieldToSplitOut: 'matches', include: 'noOtherFields', options: {} },
    position: [2200, -200]
  },
  output: [{ sheetName: 'Leads', gid: 0, row_number: 2 }]
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
      sheetName: { __rl: true, mode: 'name', value: expr('{{ $json.sheetName }}') },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          row_number: expr('{{ $json.row_number }}'),
          'Deal Stage': expr("{{ $('Find Lead Rows').first().json.gSheetStatus }}"),
          'Meeting Date & ET Time': expr("{{ $('Find Lead Rows').first().json.parsed_start_time }}")
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
    position: [2420, -200]
  },
  output: [{ row_number: 2, 'Deal Stage': 'Meeting', 'Meeting Date & ET Time': '2026-10-20 10:00:00' }]
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
      blocksUi: expr('{{ {\n  "text": "Calendly meeting " + $json.slackMsgStatus,\n  "blocks": [\n    {\n      "type": "section",\n      "text": {\n        "type": "mrkdwn",\n        "text": "*Calendly Update*: " + $json.slackMsgStatus\n          + "\\n*Lead:* " + ($json.gSheetLead ? "" : "[NOT IN DASHBOARD] ") + $json.leadName + ", " + $json.leadEmail\n          + "\\n*Meeting Time:* " + $json.parsed_start_time_slack\n          + "\\n<" + $json.dashboardUrl + "|__DASHBOARD_LABEL__>"\n      }\n    }\n  ]\n} }}'),
      otherOptions: {}
    },
    credentials: { slackApi: { id: '__SLACK_CREDENTIAL_ID__', name: '__SLACK_CREDENTIAL_NAME__' } },
    position: [2200, 100]
  },
  output: [{ ok: true }]
});

export default workflow('calendly-meeting-events-webhook', '__WORKFLOW_NAME__')
  .add(webhook)
  .to(executionData)
  .to(config)
  .to(authenticateWebhook)
  .to(isAuthentic
    .onTrue(filterEventType.to(parseProperties.to(getTab1Rows.to(getTab2Rows.to(findLeadRows)))))
    .onFalse(stopAndError))
  .add(findLeadRows)
  .to(splitOutMatches.to(updateLeadMeeting))
  .add(findLeadRows)
  .to(sendSlackMessage);
