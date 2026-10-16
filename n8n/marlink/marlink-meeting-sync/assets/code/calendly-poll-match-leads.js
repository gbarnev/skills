const SHEET_ID = '__SHEET_ID__';
const DEFAULT_LINK_GID = __DEFAULT_LINK_GID__;
const TABS = [
  { node: 'Get __TAB1_NAME__ Rows', sheetName: '__TAB1_NAME__', gid: __TAB1_GID__ },
  { node: 'Get __TAB2_NAME__ Rows', sheetName: '__TAB2_NAME__', gid: __TAB2_GID__ },
];
const tabRows = TABS.map((tab) => ({ ...tab, rows: $(tab.node).all().map((item) => item.json).filter((row) => row.row_number) }));

const rowEmails = (row) =>
  String(row.Email ?? '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);

return $('Detect Changes').all().map((change) => {
  const email = String(change.json.leadEmail ?? '').trim().toLowerCase();
  const matches = [];
  for (const tab of tabRows) {
    for (const row of tab.rows) {
      if (email && rowEmails(row).includes(email)) {
        matches.push({ sheetName: tab.sheetName, gid: tab.gid, row_number: row.row_number, firstName: row['First Name'] ?? '', lastName: row['Last Name'] ?? '' });
      }
    }
  }
  const gSheetLead = matches[0] ?? null;
  const sheetLeadName = gSheetLead ? [gSheetLead.firstName, gSheetLead.lastName].filter(Boolean).join(' ') : '';
  const gid = gSheetLead?.gid ?? DEFAULT_LINK_GID;
  return {
    json: {
      ...change.json,
      matches,
      gSheetLead,
      leadName: change.json.calendlyName || sheetLeadName || 'Unknown',
      dashboardUrl: 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/edit?gid=' + gid + '#gid=' + gid,
    },
    pairedItem: { item: 0 },
  };
});
