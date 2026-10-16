import { workflow, node, trigger, ifElse, expr } from '@n8n/workflow-sdk';

const scheduleTrigger = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: { name: 'Every 5 Minutes', parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] } }, position: [0, 0] },
  output: [{}]
});

const searchMeetings = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Search Booked Meetings',
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
    parameters: {
      method: 'POST',
      url: 'https://api.hubapi.com/crm/v3/objects/meetings/search',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{\n  "limit": 100,\n  "filterGroups": [{ "filters": [\n    { "propertyName": "hs_created_by_scheduling_page", "operator": "EQ", "value": "__SCHEDULING_PAGE_ID__" },\n    { "propertyName": "hs_lastmodifieddate", "operator": "GTE", "value": "{{ $now.minus({ days: __LOOKBACK_DAYS__ }).toMillis() }}" }\n  ] }],\n  "sorts": [{ "propertyName": "hs_lastmodifieddate", "direction": "ASCENDING" }],\n  "properties": ["hs_meeting_title", "hs_meeting_outcome", "hs_meeting_start_time"]\n}'),
      options: {}
    },
    credentials: { httpBearerAuth: { id: '__HUBSPOT_CREDENTIAL_ID__', name: '__HUBSPOT_CREDENTIAL_NAME__' } },
    position: [220, 0]
  },
  output: [{ total: 1, results: [{ id: '1001', properties: { hs_meeting_title: 'Discovery call', hs_meeting_outcome: 'SCHEDULED', hs_meeting_start_time: '2026-10-13T14:00:00Z' } }] }]
});

const getKnownMeetings = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Get Known Meetings',
    executeOnce: true,
    alwaysOutputData: true,
    parameters: { resource: 'row', operation: 'get', dataTableId: { __rl: true, mode: 'list', value: '__STATE_TABLE_ID__', cachedResultName: '__STATE_TABLE_NAME__' }, returnAll: true },
    position: [440, 0]
  },
  output: [{ id: 1, meeting_id: '1001', outcome: 'SCHEDULED', start_time: '2026-10-13T14:00:00Z' }]
});

const detectChanges = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Detect Changes',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: file('../code/hubspot-detect-changes.js') },
    position: [660, 0]
  },
  output: [{ meetingId: '1001', outcome: 'SCHEDULED', startTime: '2026-10-13T14:00:00Z', event: 'booked', gSheetStatus: 'Meeting', slackMsgStatus: '✅ Booked', parsedStartTime: '2026-10-13 10:00:00', parsedStartTimeSlack: 'Tuesday, 13 Oct 2026 10:00 AM ET' }]
});

const getMeetingContacts = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Get Meeting Contacts',
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
    parameters: {
      method: 'GET',
      url: expr('https://api.hubapi.com/crm/v3/objects/meetings/{{ $json.meetingId }}'),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: { parameters: [{ name: 'associations', value: 'contacts' }] },
      options: {}
    },
    credentials: { httpBearerAuth: { id: '__HUBSPOT_CREDENTIAL_ID__', name: '__HUBSPOT_CREDENTIAL_NAME__' } },
    position: [880, 0]
  },
  output: [{ id: '1001', associations: { contacts: { results: [{ id: '101', type: 'meeting_event_to_contact' }, { id: '102', type: 'meeting_event_to_contact' }] } } }]
});

const getContactDetails = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Get Contact Details',
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
    parameters: {
      method: 'POST',
      url: 'https://api.hubapi.com/crm/v3/objects/contacts/batch/read',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{\n  "properties": ["email", "firstname", "lastname"],\n  "inputs": {{ JSON.stringify([...new Set(($json.associations?.contacts?.results ?? []).map((contact) => contact.id))].map((id) => ({ id }))) }}\n}'),
      options: {}
    },
    credentials: { httpBearerAuth: { id: '__HUBSPOT_CREDENTIAL_ID__', name: '__HUBSPOT_CREDENTIAL_NAME__' } },
    position: [1100, 0]
  },
  output: [{ status: 'COMPLETE', results: [{ id: '101', properties: { email: 'jane@acme.com', firstname: 'Jane', lastname: 'Doe' } }, { id: '102', properties: { email: 'host@client.com', firstname: 'Host', lastname: 'Person' } }] }]
});

const getSheetRows = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Get Sheet Rows',
    executeOnce: true,
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
    parameters: {
      resource: 'sheet',
      operation: 'read',
      documentId: { __rl: true, mode: 'id', value: '__SHEET_ID__' },
      sheetName: { __rl: true, mode: 'list', value: '__TAB_LIST_VALUE__', cachedResultName: '__TAB_NAME__', cachedResultUrl: 'https://docs.google.com/spreadsheets/d/__SHEET_ID__/edit#gid=__TAB_GID__' },
      options: {}
    },
    credentials: { googleSheetsOAuth2Api: { id: '__SHEETS_CREDENTIAL_ID__', name: '__SHEETS_CREDENTIAL_NAME__' } },
    position: [1320, 0]
  },
  output: [{ row_number: 2, 'First Name': 'Jane', 'Last Name': 'Doe', Email: 'jane@acme.com', 'Deal Stage': 'Replied' }]
});

const matchLeads = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Match Leads',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: file('../code/hubspot-match-leads.js') },
    position: [1540, 0]
  },
  output: [{ meetingId: '1001', outcome: 'SCHEDULED', startTime: '2026-10-13T14:00:00Z', event: 'booked', gSheetStatus: 'Meeting', slackMsgStatus: '✅ Booked', parsedStartTime: '2026-10-13 10:00:00', parsedStartTimeSlack: 'Tuesday, 13 Oct 2026 10:00 AM ET', gSheetLead: { row_number: 2, 'First Name': 'Jane', 'Last Name': 'Doe', Email: 'jane@acme.com' }, leadEmail: 'jane@acme.com', leadFirstName: 'Jane', leadLastName: 'Doe' }]
});

const inDashboard = node({
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
    position: [1760, -200]
  },
  output: [{ meetingId: '1001', gSheetLead: { row_number: 2 }, gSheetStatus: 'Meeting', parsedStartTime: '2026-10-13 10:00:00' }]
});

const updateLeadRow = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Update Lead Meeting',
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
    parameters: {
      resource: 'sheet',
      operation: 'update',
      documentId: { __rl: true, mode: 'id', value: '__SHEET_ID__' },
      sheetName: { __rl: true, mode: 'list', value: '__TAB_LIST_VALUE__', cachedResultName: '__TAB_NAME__', cachedResultUrl: 'https://docs.google.com/spreadsheets/d/__SHEET_ID__/edit#gid=__TAB_GID__' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          row_number: expr('{{ $json.gSheetLead.row_number }}'),
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
    position: [1980, -200]
  },
  output: [{ row_number: 2, 'Deal Stage': 'Meeting', 'Meeting Date & ET Time': '2026-10-13 10:00:00' }]
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
    position: [1760, 100]
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
      blocksUi: expr('{{ {\n  "text": "HubSpot meeting " + $json.slackMsgStatus,\n  "blocks": [\n    {\n      "type": "section",\n      "text": {\n        "type": "mrkdwn",\n        "text": "*HubSpot Update*: " + $json.slackMsgStatus\n          + "\\n*Lead:* " + ($json.gSheetLead ? "" : "[NOT IN DASHBOARD] ") + $json.leadFirstName + " " + $json.leadLastName + ", " + $json.leadEmail\n          + "\\n*Meeting Time:* " + $json.parsedStartTimeSlack\n          + "\\n<https://docs.google.com/spreadsheets/d/__SHEET_ID__/edit?gid=__TAB_GID__#gid=__TAB_GID__|__DASHBOARD_LABEL__>"\n      }\n    }\n  ]\n} }}'),
      otherOptions: {}
    },
    credentials: { slackApi: { id: '__SLACK_CREDENTIAL_ID__', name: '__SLACK_CREDENTIAL_NAME__' } },
    position: [1980, 0]
  },
  output: [{ ok: true }]
});

const saveMeetingState = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Save Meeting State',
    parameters: {
      resource: 'row',
      operation: 'upsert',
      dataTableId: { __rl: true, mode: 'list', value: '__STATE_TABLE_ID__', cachedResultName: '__STATE_TABLE_NAME__' },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'meeting_id', condition: 'eq', keyValue: expr("{{ $('Match Leads').item.json.meetingId }}") }] },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          meeting_id: expr("{{ $('Match Leads').item.json.meetingId }}"),
          outcome: expr("{{ $('Match Leads').item.json.outcome }}"),
          start_time: expr("{{ $('Match Leads').item.json.startTime }}")
        },
        matchingColumns: [],
        schema: [
          { id: 'meeting_id', displayName: 'meeting_id', required: false, defaultMatch: false, display: true, type: 'string', readOnly: false, removed: false },
          { id: 'outcome', displayName: 'outcome', required: false, defaultMatch: false, display: true, type: 'string', readOnly: false, removed: false },
          { id: 'start_time', displayName: 'start_time', required: false, defaultMatch: false, display: true, type: 'string', readOnly: false, removed: false }
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: false
      },
      options: {}
    },
    position: [2200, 100]
  },
  output: [{ id: 1, meeting_id: '1001', outcome: 'SCHEDULED', start_time: '2026-10-13T14:00:00Z' }]
});

export default workflow('hubspot-meeting-events', '__WORKFLOW_NAME__')
  .add(scheduleTrigger)
  .to(searchMeetings)
  .to(getKnownMeetings)
  .to(detectChanges)
  .to(getMeetingContacts)
  .to(getContactDetails)
  .to(getSheetRows)
  .to(matchLeads)
  .to(inDashboard.to(updateLeadRow))
  .add(matchLeads)
  .to(shouldNotify
    .onTrue(sendSlackMessage.to(saveMeetingState))
    .onFalse(saveMeetingState));
