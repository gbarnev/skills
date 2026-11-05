const result = $('Fetch Appointments').first().json.response?.returnvalue ?? {};
if (result.next_page_available) throw new Error('Zoho returned more than one page of appointments; add paging to Fetch Appointments');
// An empty result is the string "No Match Found", not an empty list.
const appointments = Array.isArray(result.response) ? result.response : [];
const known = new Map(
  $input.all()
    .filter((item) => item.json.booking_id)
    .map((item) => [String(item.json.booking_id), item.json]),
);

const STATUS = {
  booked: { gSheetStatus: 'Meeting', slackMsgStatus: '✅ Booked' },
  rescheduled: { gSheetStatus: 'Meeting', slackMsgStatus: '🔁 Rescheduled' },
  canceled: { gSheetStatus: 'Meeting Cancelled', slackMsgStatus: '❌ Canceled' },
  no_show: { gSheetStatus: 'No show', slackMsgStatus: '⚠️ No-show' },
  no_show_removed: { gSheetStatus: 'Meeting', slackMsgStatus: '↩️ No-show removed' },
};

// upcoming, yet_to_mark (past, not marked), ongoing and pending all mean the meeting still stands.
const group = (status) => (['cancel', 'completed', 'no_show'].includes(status) ? status : 'scheduled');

function detectEvent(status, startTime, previous) {
  const now = group(status);
  const before = previous ? group(previous.status) : null;
  if (now === 'cancel') return before === 'cancel' ? null : 'canceled';
  if (now === 'no_show') return before === 'no_show' ? null : 'no_show';
  if (before === 'no_show') return 'no_show_removed';
  if (now === 'completed') return null;
  if (!previous || before === 'cancel') return 'booked';
  return startTime !== previous.start_time ? 'rescheduled' : null;
}

const changes = [];
for (const appointment of appointments) {
  const bookingId = String(appointment.booking_id);
  const status = String(appointment.status ?? '').toLowerCase();
  const startTime = appointment.iso_start_time ?? '';
  const previous = known.get(bookingId);
  if (previous && previous.status === status && previous.start_time === startTime) continue;

  const event = detectEvent(status, startTime, previous);
  const start = DateTime.fromISO(startTime).setZone('__TIME_ZONE__');
  changes.push({
    json: {
      bookingId,
      status,
      startTime,
      event: event ?? '',
      gSheetStatus: event ? STATUS[event].gSheetStatus : '',
      slackMsgStatus: event ? STATUS[event].slackMsgStatus : '',
      leadEmail: appointment.customer_email ?? '',
      bookingName: appointment.customer_name ?? '',
      parsedStartTime: start.isValid ? start.toFormat('yyyy-MM-dd HH:mm:ss') : '',
      parsedStartTimeSlack: start.isValid ? start.toFormat('cccc, dd MMM yyyy h:mm a') + ' __TIME_ZONE_LABEL__' : '',
    },
  });
}

return changes;
