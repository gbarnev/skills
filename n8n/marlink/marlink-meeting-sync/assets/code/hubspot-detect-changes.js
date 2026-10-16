const meetings = $('Search Booked Meetings').first().json.results ?? [];
const known = new Map(
  $input.all()
    .filter((item) => item.json.meeting_id)
    .map((item) => [String(item.json.meeting_id), item.json]),
);

const STATUS = {
  booked: { gSheetStatus: 'Meeting', slackMsgStatus: '✅ Booked' },
  rescheduled: { gSheetStatus: 'Meeting', slackMsgStatus: '🔁 Rescheduled' },
  canceled: { gSheetStatus: 'Meeting Cancelled', slackMsgStatus: '❌ Canceled' },
  no_show: { gSheetStatus: 'No show', slackMsgStatus: '⚠️ No-show' },
  no_show_removed: { gSheetStatus: 'Meeting', slackMsgStatus: '↩️ No-show removed' },
};

function detectEvent(outcome, startTime, previous) {
  if (outcome === 'CANCELED') return previous?.outcome === 'CANCELED' ? null : 'canceled';
  if (outcome === 'NO_SHOW') return previous?.outcome === 'NO_SHOW' ? null : 'no_show';
  if (outcome === 'RESCHEDULED') return 'rescheduled';
  if (previous?.outcome === 'NO_SHOW') return 'no_show_removed';
  if (outcome === 'COMPLETED') return null;
  if (!previous || previous.outcome === 'CANCELED') return 'booked';
  return startTime !== previous.start_time ? 'rescheduled' : null;
}

const changes = [];
for (const meeting of meetings) {
  const meetingId = String(meeting.id);
  const outcome = meeting.properties.hs_meeting_outcome || 'SCHEDULED';
  const startTime = meeting.properties.hs_meeting_start_time || '';
  const previous = known.get(meetingId);
  if (previous && previous.outcome === outcome && previous.start_time === startTime) continue;

  const event = detectEvent(outcome, startTime, previous);
  const start = DateTime.fromISO(startTime).setZone('America/New_York');
  changes.push({
    json: {
      meetingId,
      outcome,
      startTime,
      event: event ?? '',
      gSheetStatus: event ? STATUS[event].gSheetStatus : '',
      slackMsgStatus: event ? STATUS[event].slackMsgStatus : '',
      parsedStartTime: start.isValid ? start.toFormat('yyyy-MM-dd HH:mm:ss') : '',
      parsedStartTimeSlack: start.isValid ? start.toFormat('cccc, dd MMM yyyy h:mm a') + ' ET' : '',
    },
  });
}

return changes;
