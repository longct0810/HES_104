'use strict';

// Chạy script này trên WEB APP/server quản trị key, KHÔNG nên tạo private key trên HES production.
// Usage: node scripts/generate-ws-rsa-keypair.js /secure/output/dir

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const outputDir = path.resolve(process.argv[2] || './ws-keys-output');
fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 3072,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const privatePath = path.join(outputDir, 'webapp-ws-private.pem');
const publicPath = path.join(outputDir, 'webapp-ws-public.pem');
fs.writeFileSync(privatePath, privateKey, { mode: 0o600 });
fs.writeFileSync(publicPath, publicKey, { mode: 0o644 });

console.log(`PRIVATE (WEB APP ONLY): ${privatePath}`);
console.log(`PUBLIC  (COPY TO HES):  ${publicPath}`);
