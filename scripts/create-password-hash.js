'use strict';
const { hashPassword } = require('../auth');

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('Run this command in an interactive terminal so the password is not echoed or passed as an argument.');
  process.exit(1);
}

const stdin = process.stdin;
const stdout = process.stdout;
stdout.write('New FormBridge password (minimum 14 characters): ');
stdin.setRawMode(true);
stdin.resume();
let password = '';
stdin.on('data', chunk => {
  for (const char of chunk.toString('utf8')) {
    if (char === '\u0003') { stdout.write('\nCancelled.\n'); process.exit(1); }
    if (char === '\r' || char === '\n') {
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
      if (password.length < 14 || password.length > 256) {
        stdout.write('Password must be between 14 and 256 characters.\n');
        process.exit(1);
      }
      stdout.write(hashPassword(password) + '\n');
      password = '';
      process.exit(0);
    }
    if (char === '\u007f' || char === '\b') password = password.slice(0, -1);
    else if (char >= ' ') password += char;
  }
});
