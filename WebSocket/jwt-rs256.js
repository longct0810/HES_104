'use strict';

const crypto = require('crypto');

function decodeJsonBase64Url(part, label) {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    throw new Error(`Invalid JWT ${label}`);
  }
}

function parseJwt(token) {
  if (typeof token !== 'string') throw new Error('JWT must be a string');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('JWT must contain 3 parts');

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  return {
    encodedHeader,
    encodedPayload,
    encodedSignature,
    header: decodeJsonBase64Url(encodedHeader, 'header'),
    payload: decodeJsonBase64Url(encodedPayload, 'payload'),
  };
}

function verifyStandardClaims(payload, options = {}) {
  const now = Math.floor(Date.now() / 1000);
  const tolerance = Number(options.clockToleranceSec || 0);
  const exp = Number(payload.exp);
  const iat = Number(payload.iat);

  if (!Number.isFinite(exp) || now - tolerance >= exp) {
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

  if (!Number.isFinite(iat)) throw new Error('JWT iat is required');
  if (iat > now + tolerance) throw new Error('JWT iat is in the future');
  if (exp <= iat) throw new Error('JWT exp must be later than iat');

  if (options.maxAgeSec !== undefined) {
    const maxAgeSec = Number(options.maxAgeSec);
    if (now - iat > maxAgeSec + tolerance) {
      throw new Error('JWT exceeds maximum age');
    }
    if (exp - iat > maxAgeSec + tolerance) {
      throw new Error('JWT lifetime exceeds maximum age');
    }
  }
}

function verifyRs256(token, publicKey, options = {}) {
  const parsed = parseJwt(token);
  const { header, payload, encodedHeader, encodedPayload, encodedSignature } = parsed;

  if (header.alg !== 'RS256' || (header.typ && header.typ !== 'JWT')) {
    throw new Error('Only JWT RS256 is allowed');
  }
  if (options.keyId && header.kid !== options.keyId) {
    throw new Error('Invalid JWT key id');
  }

  let signature;
  try {
    signature = Buffer.from(encodedSignature, 'base64url');
  } catch {
    throw new Error('Invalid JWT signature encoding');
  }

  const valid = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    publicKey,
    signature
  );
  if (!valid) throw new Error('Invalid JWT signature');

  verifyStandardClaims(payload, options);
  return payload;
}

function signRs256(payload, privateKey, options = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    ...(options.keyId ? { kid: String(options.keyId) } : {}),
  };
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
  const signature = crypto.sign(
    'RSA-SHA256',
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    privateKey
  ).toString('base64url');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function validateRsaPublicKey(publicKeyPem, minimumBits = 2048) {
  let key;
  try {
    key = crypto.createPublicKey(publicKeyPem);
  } catch {
    throw new Error('WS JWT public key is not a valid PEM public key');
  }

  const type = key.asymmetricKeyType;
  if (type !== 'rsa') {
    throw new Error(`WS JWT public key must be RSA, got ${type || 'unknown'}`);
  }

  const modulusLength = Number(key.asymmetricKeyDetails?.modulusLength || 0);
  if (modulusLength && modulusLength < minimumBits) {
    throw new Error(`WS JWT RSA public key must be at least ${minimumBits} bits`);
  }

  return key;
}

module.exports = {
  parseJwt,
  verifyRs256,
  signRs256,
  validateRsaPublicKey,
};
