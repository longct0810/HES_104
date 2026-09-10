'use strict';

const crypto = require('crypto');

function decodeJsonBase64Url(part, label) {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    throw new Error(`Invalid JWT ${label}`);
  }
}

function constantTimeSignatureMatch(actualPart, expectedBuffer) {
  let actual;
  try {
    actual = Buffer.from(actualPart, 'base64url');
  } catch {
    return false;
  }
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
}

function verifyHs256(token, secret, options = {}) {
  if (typeof token !== 'string') throw new Error('JWT must be a string');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('JWT must contain 3 parts');

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJsonBase64Url(encodedHeader, 'header');
  const payload = decodeJsonBase64Url(encodedPayload, 'payload');

  if (header.alg !== 'HS256' || header.typ && header.typ !== 'JWT') {
    throw new Error('Only JWT HS256 is allowed');
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();

  if (!constantTimeSignatureMatch(encodedSignature, expected)) {
    throw new Error('Invalid JWT signature');
  }

  const now = Math.floor(Date.now() / 1000);
  const tolerance = Number(options.clockToleranceSec || 0);

  if (!Number.isFinite(Number(payload.exp)) || now - tolerance >= Number(payload.exp)) {
    throw new Error('JWT expired');
  }
  if (payload.nbf !== undefined && now + tolerance < Number(payload.nbf)) {
    throw new Error('JWT not active yet');
  }
  if (options.issuer && payload.iss !== options.issuer) {
    throw new Error('Invalid JWT issuer');
  }

  if (options.audience) {
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(options.audience)) throw new Error('Invalid JWT audience');
  }

  if (options.maxAgeSec !== undefined) {
    if (!Number.isFinite(Number(payload.iat))) throw new Error('JWT iat is required');
    if (Number(payload.iat) > now + tolerance) throw new Error('JWT iat is in the future');
    if (now - Number(payload.iat) > Number(options.maxAgeSec) + tolerance) {
      throw new Error('JWT exceeds maximum age');
    }
  }

  return payload;
}

function signHs256(payload, secret, options = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const finalPayload = {
    ...payload,
    iat: payload.iat ?? now,
    ...(options.issuer ? { iss: options.issuer } : {}),
    ...(options.audience ? { aud: options.audience } : {}),
  };

  if (options.expiresInSec !== undefined && finalPayload.exp === undefined) {
    finalPayload.exp = now + Number(options.expiresInSec);
  }
  if (options.jwtid && finalPayload.jti === undefined) finalPayload.jti = String(options.jwtid);
  if (options.subject && finalPayload.sub === undefined) finalPayload.sub = String(options.subject);

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(finalPayload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

module.exports = {
  verifyHs256,
  signHs256,
};
