const events = $('Filter Event Type').all().map((item) => item.json);
const inviteeResponses = $('Get Invitees').all();
const known = new Map(
  $input.all()
    .filter((item) => item.json.invitee_uri)
    .map((item) => [item.json.invitee_uri, item.json]),
);

const STATUS = {
  booked: { gSheetStatus: 'Meeting', slackMsgStatus: '✅ Booked' },
  rescheduled: { gSheetStatus: 'Meeting', slackMsgStatus: '🔁 Rescheduled' },
  canceled: { gSheetStatus: 'Meeting Cancelled', slackMsgStatus: '❌ Canceled' },
  no_show: { gSheetStatus: 'No show', slackMsgStatus: '⚠️ No-show' },
  no_show_removed: { gSheetStatus: 'Meeting', slackMsgStatus: '↩️ No-show removed' },
};

function detectEvent(invitee, state, previous) {
  if (state.status === 'canceled') {
    if (previous?.status === 'canceled') return null;
    return invitee.rescheduled ? null : 'canceled';
  }
  if (state.no_show === 'true') return previous?.no_show === 'true' ? null : 'no_show';
  if (previous?.no_show === 'true') return 'no_show_removed';
  if (!previous || previous.status === 'canceled') return invitee.old_invitee ? 'rescheduled' : 'booked';
  return null;
}

const changes = [];
events.forEach((event, index) => {
  for (const invitee of inviteeResponses[index]?.json.collection ?? []) {
    const state = { status: invitee.status, start_time: event.start_time, no_show: invitee.no_show ? 'true' : 'false' };
    const previous = known.get(invitee.uri);
    if (previous && previous.status === state.status && previous.start_time === state.start_time && previous.no_show === state.no_show) continue;

    const kind = detectEvent(invitee, state, previous);
    const start = DateTime.fromISO(event.start_time).setZone('__TIME_ZONE__');
    changes.push({
      json: {
        inviteeUri: invitee.uri,
        status: state.status,
        startTime: state.start_time,
        noShow: state.no_show,
        event: kind ?? '',
        gSheetStatus: kind ? STATUS[kind].gSheetStatus : '',
        slackMsgStatus: kind ? STATUS[kind].slackMsgStatus : '',
        leadEmail: invitee.email ?? '',
        calendlyName: invitee.name || [invitee.first_name, invitee.last_name].filter(Boolean).join(' '),
        parsedStartTime: start.isValid ? start.toFormat('yyyy-MM-dd HH:mm:ss') : '',
        parsedStartTimeSlack: start.isValid ? start.toFormat('cccc, dd MMM yyyy h:mm a') + ' __TIME_ZONE_LABEL__' : '',
      },
    });
  }
});

return changes;
