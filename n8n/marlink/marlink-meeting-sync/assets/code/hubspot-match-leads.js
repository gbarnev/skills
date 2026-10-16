const INTERNAL_DOMAINS = __INTERNAL_EMAIL_DOMAINS__;
const sheetRows = $input.all().map((item) => item.json);
const changes = $('Detect Changes').all();
const contactResponses = $('Get Contact Details').all();

const rowEmails = (row) =>
  String(row.Email ?? '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);

return changes.map((change, index) => {
  const contacts = (contactResponses[index]?.json.results ?? [])
    .map((contact) => ({
      email: String(contact.properties.email ?? '').trim().toLowerCase(),
      firstName: contact.properties.firstname ?? '',
      lastName: contact.properties.lastname ?? '',
    }))
    .filter((contact) => contact.email);
  const external = contacts.filter((contact) => !INTERNAL_DOMAINS.some((domain) => contact.email.endsWith('@' + domain)));
  const candidates = external.length ? external : contacts;

  let gSheetLead = null;
  let lead = candidates[0] ?? { email: '', firstName: '', lastName: '' };
  for (const contact of candidates) {
    const row = sheetRows.find((sheetRow) => rowEmails(sheetRow).includes(contact.email));
    if (row) {
      gSheetLead = row;
      lead = contact;
      break;
    }
  }

  return {
    json: {
      ...change.json,
      gSheetLead,
      leadEmail: lead.email,
      leadFirstName: lead.firstName || gSheetLead?.['First Name'] || '',
      leadLastName: lead.lastName || gSheetLead?.['Last Name'] || '',
    },
  };
});
