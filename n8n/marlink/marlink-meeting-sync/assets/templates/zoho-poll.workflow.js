import { workflow, node, trigger, ifElse, splitInBatches, nextBatch, expr } from '@n8n/workflow-sdk';

const scheduleTrigger = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: { name: 'Every 10 Minutes', parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 10 }] } }, position: [0, 0] },
  output: [{}]
});

const refreshToken = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Refresh Zoho Token',
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
    parameters: {
      method: 'POST',
      url: '__ZOHO_ACCOUNTS_URL__/oauth/v2/token',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpCustomAuth',
      options: {}
    },
    credentials: { httpCustomAuth: { id: '__ZOHO_CREDENTIAL_ID__', name: '__ZOHO_CREDENTIAL_NAME__' } },
    position: [220, 0]
  },
  output: [{ access_token: '1000.abc', api_domain: 'https://www.zohoapis.eu', token_type: 'Bearer', expires_in: 3600 }]
});

const fetchAppointments = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Fetch Appointments',
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
    parameters: {
      method: 'POST',
      url: expr('{{ $json.api_domain }}/bookings/v1/json/fetchappointment'),
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [{ name: 'Authorization', value: expr('Zoho-oauthtoken {{ $json.access_token }}') }] },
      sendBody: true,
      contentType: 'form-urlencoded',
      specifyBody: 'keypair',
      bodyParameters: {
        parameters: [{
          name: 'data',
          value: expr('{{ JSON.stringify({ "service_id": "__ZOHO_SERVICE_ID__", "from_time": $now.minus({ days: 14 }).toUTC().setLocale("en").toFormat("dd-MMM-yyyy HH:mm:ss"), "to_time": $now.plus({ days: 365 }).toUTC().setLocale("en").toFormat("dd-MMM-yyyy HH:mm:ss"), "per_page": 100 }) }}')
        }]
      },
      options: {}
    },
    position: [440, 0]
  },
  output: [{ response: { returnvalue: { response: [{ booking_id: '#IN-00001', status: 'upcoming', iso_start_time: '2026-10-20T14:00:00+00:00', customer_email: 'jane@acme.com', customer_name: 'Jane Doe', service_id: '__ZOHO_SERVICE_ID__' }], next_page_available: false, page: 1 }, status: 'success' } }]
});

const getKnownBookings = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Get Known Bookings',
    executeOnce: true,
    alwaysOutputData: true,
    parameters: { resource: 'row', operation: 'get', dataTableId: { __rl: true, mode: 'list', value: '__STATE_TABLE_ID__', cachedResultName: '__STATE_TABLE_NAME__' }, returnAll: true },
    position: [660, 0]
  },
  output: [{ id: 1, booking_id: '#IN-00001', status: 'upcoming', start_time: '2026-10-20T14:00:00+00:00' }]
});

const detectChanges = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Detect Changes',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: file('../code/zoho-poll-detect-changes.js') },
    position: [880, 0]
  },
  output: [{ bookingId: '#IN-00001', status: 'upcoming', startTime: '2026-10-20T14:00:00+00:00', event: 'booked', gSheetStatus: 'Meeting', slackMsgStatus: '✅ Booked', leadEmail: 'jane@acme.com', bookingName: 'Jane Doe', parsedStartTime: '2026-10-20 10:00:00', parsedStartTimeSlack: 'Tuesday, 20 Oct 2026 10:00 AM ET' }]
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
    position: [1100, 0]
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
    position: [1320, 0]
  },
  output: [{ row_number: 5, 'First Name': 'John', 'Last Name': 'Roe', Email: 'john@roe.com' }]
});

const matchLeads = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Match Leads',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: file('../code/zoho-poll-match-leads.js') },
    position: [1540, 0]
  },
  output: [{ bookingId: '#IN-00001', status: 'upcoming', startTime: '2026-10-20T14:00:00+00:00', event: 'booked', gSheetStatus: 'Meeting', slackMsgStatus: '✅ Booked', leadEmail: 'jane@acme.com', parsedStartTime: '2026-10-20 10:00:00', parsedStartTimeSlack: 'Tuesday, 20 Oct 2026 10:00 AM ET', matches: [{ sheetName: 'Leads', gid: 0, row_number: 2 }], gSheetLead: { sheetName: 'Leads', gid: 0, row_number: 2 }, leadName: 'Jane Doe', dashboardUrl: 'https://docs.google.com/spreadsheets/d/x/edit?gid=0#gid=0' }]
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
    position: [1760, -200]
  },
  output: [{ matches: [{ sheetName: 'Leads', gid: 0, row_number: 2 }], gSheetStatus: 'Meeting', parsedStartTime: '2026-10-20 10:00:00' }]
});

const splitMatches = node({
  type: 'n8n-nodes-base.splitOut',
  version: 1,
  config: {
    name: 'Split Out Matches',
    parameters: { fieldToSplitOut: 'matches', include: 'selectedOtherFields', fieldsToInclude: 'gSheetStatus,parsedStartTime', options: {} },
    position: [1980, -200]
  },
  output: [{ matches: { sheetName: 'Leads', gid: 0, row_number: 2 }, gSheetStatus: 'Meeting', parsedStartTime: '2026-10-20 10:00:00' }]
});

// The Sheets update resolves its tab from the first item only, so update one match at a time.
const loopMatches = splitInBatches({ version: 3, config: { name: 'Loop Over Matches', parameters: { batchSize: 1, options: {} }, position: [2200, -200] } });

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
          '__TIME_COLUMN__': expr('{{ $json.parsedStartTime }}')
        },
        matchingColumns: ['row_number'],
        schema: [
          { id: 'Deal Stage', displayName: 'Deal Stage', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true, removed: false },
          { id: '__TIME_COLUMN__', displayName: '__TIME_COLUMN__', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true, removed: false },
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
      blocksUi: expr('{{ {\n  "text": "Zoho Bookings meeting " + $json.slackMsgStatus,\n  "blocks": [\n    {\n      "type": "section",\n      "text": {\n        "type": "mrkdwn",\n        "text": "*Zoho Bookings Update*: " + $json.slackMsgStatus\n          + "\\n*Lead:* " + ($json.gSheetLead ? "" : "[NOT IN DASHBOARD] ") + $json.leadName + ", " + $json.leadEmail\n          + "\\n*Meeting Time:* " + $json.parsedStartTimeSlack\n          + "\\n<" + $json.dashboardUrl + "|__DASHBOARD_LABEL__>"\n      }\n    }\n  ]\n} }}'),
      otherOptions: {}
    },
    credentials: { slackApi: { id: '__SLACK_CREDENTIAL_ID__', name: '__SLACK_CREDENTIAL_NAME__' } },
    position: [1980, 0]
  },
  output: [{ ok: true }]
});

const saveBookingState = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Save Booking State',
    parameters: {
      resource: 'row',
      operation: 'upsert',
      dataTableId: { __rl: true, mode: 'list', value: '__STATE_TABLE_ID__', cachedResultName: '__STATE_TABLE_NAME__' },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'booking_id', condition: 'eq', keyValue: expr("{{ $('Match Leads').item.json.bookingId }}") }] },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          booking_id: expr("{{ $('Match Leads').item.json.bookingId }}"),
          status: expr("{{ $('Match Leads').item.json.status }}"),
          start_time: expr("{{ $('Match Leads').item.json.startTime }}")
        },
        matchingColumns: [],
        schema: [
          { id: 'booking_id', displayName: 'booking_id', required: false, defaultMatch: false, display: true, type: 'string', readOnly: false, removed: false },
          { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', readOnly: false, removed: false },
          { id: 'start_time', displayName: 'start_time', required: false, defaultMatch: false, display: true, type: 'string', readOnly: false, removed: false }
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: false
      },
      options: {}
    },
    position: [2200, 100]
  },
  output: [{ id: 2, booking_id: '#IN-00001', status: 'upcoming', start_time: '2026-10-20T14:00:00+00:00' }]
});

export default workflow('zoho-meeting-events-poll', '__WORKFLOW_NAME__')
  .add(scheduleTrigger)
  .to(refreshToken)
  .to(fetchAppointments)
  .to(getKnownBookings)
  .to(detectChanges)
  .to(getTab1Rows)
  .to(getTab2Rows)
  .to(matchLeads)
  .to(hasSheetUpdate.to(splitMatches.to(loopMatches.onEachBatch(updateLeadMeeting.to(nextBatch(loopMatches))))))
  .add(matchLeads)
  .to(shouldNotify
    .onTrue(sendSlackMessage.to(saveBookingState))
    .onFalse(saveBookingState));
