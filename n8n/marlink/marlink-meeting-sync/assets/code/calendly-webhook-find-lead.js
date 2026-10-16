const SHEET_ID = '__SHEET_ID__';
const DEFAULT_LINK_GID = __DEFAULT_LINK_GID__;
const TABS = [
  { node: 'Get __TAB1_NAME__ Rows', sheetName: '__TAB1_NAME__', gid: __TAB1_GID__ },
  { node: 'Get __TAB2_NAME__ Rows', sheetName: '__TAB2_NAME__', gid: __TAB2_GID__ },
];

const event = $('Parse Properties').first().json;
const payload = event.body?.payload ?? {};
const email = String(payload.email ?? '').trim().toLowerCase();

const rowEmails = (row) =>
  String(row.Email ?? '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);

const matches = [];
for (const tab of TABS) {
  for (const item of $(tab.node).all()) {
    if (email && item.json.row_number && rowEmails(item.json).includes(email)) {
      matches.push({
        sheetName: tab.sheetName,
        gid: tab.gid,
        row_number: item.json.row_number,
        firstName: item.json['First Name'] ?? '',
        lastName: item.json['Last Name'] ?? '',
      });
    }
  }
}

const gSheetLead = matches[0] ?? null;
const calendlyName = payload.name || [payload.first_name, payload.last_name].filter(Boolean).join(' ');
const sheetLeadName = gSheetLead ? [gSheetLead.firstName, gSheetLead.lastName].filter(Boolean).join(' ') : '';
const gid = gSheetLead?.gid ?? DEFAULT_LINK_GID;

return [{
  json: {
    ...event,
    matches,
    gSheetLead,
    leadName: calendlyName || sheetLeadName || 'Unknown',
    leadEmail: payload.email ?? '',
    dashboardUrl: 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/edit?gid=' + gid + '#gid=' + gid,
  },
  pairedItem: { item: 0 },
}];
