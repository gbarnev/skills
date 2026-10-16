const crypto = require('crypto');

const secret = $('Config').first().json.webhookSecret;

const results = [];
for (const [index, item] of $input.all().entries()) {
  const headers = item.json.headers ?? {};
  const signatureHeader = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === 'calendly-webhook-signature' || key.toLowerCase() === 'webhook-signature',
  )?.[1];

  if (!signatureHeader) {
    results.push({ json: { ...item.json, isAuthentic: false, error: 'Missing webhook-signature header' }, pairedItem: { item: index } });
    continue;
  }

  if (!item.binary?.data) {
    results.push({ json: { ...item.json, isAuthentic: false, error: 'Missing raw body' }, pairedItem: { item: index } });
    continue;
  }
  const rawBodyText = (await this.helpers.getBinaryDataBuffer(index, 'data')).toString('utf8');

  const parts = String(signatureHeader).split(',');
  const timestamp = parts.find((part) => part.startsWith('t='))?.split('=')[1];
  const signature = parts.find((part) => part.startsWith('v1='))?.split('=')[1];

  if (!timestamp || !signature) {
    results.push({ json: { ...item.json, isAuthentic: false, error: 'Header format does not match expected t=,v1= format' }, pairedItem: { item: index } });
    continue;
  }

  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(timestamp + '.' + rawBodyText).digest('hex'), 'hex');
  const received = Buffer.from(signature, 'hex');
  const isAuthentic = expected.length === received.length && crypto.timingSafeEqual(expected, received);

  results.push({ json: { ...item.json, isAuthentic }, pairedItem: { item: index } });
}

return results;
