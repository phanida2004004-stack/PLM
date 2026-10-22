
const ACCEPT_PATTERNS = [
  /\bACCEPT(?:ED)?\b/i,
  /\bACC\.?\s*LOT\b/i,
  /ผลผ่าน/,
  /ผ่านการตรวจ/
];

const REJECT_PATTERNS = [
  /\bREJECT(?:ED)?\b/i,
  /ไม่ผ่าน/,
  /ปฏิเสธล็อต/
];

export function parseLineQC(rawText) {
  const text = String(rawText || '').trim();

  const sapMatch = text.match(
    /(?:SAP\s*(?:NO\.?|NUMBER)?\s*[:：-]?\s*)(\d{6,12})/i
  );

  const standaloneSap = text.match(
    /(?:^|\n)\s*(\d{6,12})\s*(?=\n|$)/m
  );

  const lotMatch = text.match(
    /\bINV\d{2,4}[-_][A-Z0-9-]+\b/i
  );

  const qtyMatch = text.match(
    /(?:QTY|QUANTITY|ยอด|จำนวน)\s*[:：]?\s*([\d,]+)/i
  );

  const hasAccept = ACCEPT_PATTERNS.some(p => p.test(text));
  const hasReject = REJECT_PATTERNS.some(p => p.test(text));

  let qcResult = null;
  let reviewStatus = 'pending';

  if (hasAccept && hasReject) {
    reviewStatus = 'conflict';
  } else if (hasAccept) {
    qcResult = 'ACCEPT';
  } else if (hasReject) {
    qcResult = 'REJECT';
  }

  const sapNo = sapMatch?.[1] || standaloneSap?.[1] || null;
  const lotNo = lotMatch?.[0] || null;

  const quantity = qtyMatch
    ? Number(qtyMatch[1].replace(/,/g, ''))
    : null;

  return {
    sapNo,
    lotNo,
    quantity,
    qcResult,
    reviewStatus,
    rawText: text
  };
}
