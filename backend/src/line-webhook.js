
import crypto from 'node:crypto';

// ตรวจสอบว่าข้อความส่งมาจาก LINE จริง
export function verifyLineSignature(rawBody, signature, channelSecret) {
  if (!channelSecret || !signature || !Buffer.isBuffer(rawBody)) {
    return false;
  }

  const expected = crypto
    .createHmac('sha256', channelSecret)
    .update(rawBody)
    .digest();

  let received;
  try {
    received = Buffer.from(signature, 'base64');
  } catch {
    return false;
  }

  return received.length === expected.length &&
    crypto.timingSafeEqual(received, expected);
}

// ดึงข้อความจาก LINE Webhook
export function extractLineMessages(payload) {
  if (!payload || !Array.isArray(payload.events)) {
    return [];
  }

  return payload.events
    .filter(event =>
      event.type === 'message' &&
      event.message?.type === 'text' &&
      event.message.id
    )
    .map(event => ({
      messageId: String(event.message.id),
      groupId: event.source?.groupId || null,
      rawText: event.message.text,
      receivedAt: new Date(event.timestamp).toISOString()
    }));
}
