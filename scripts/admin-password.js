// Reads the password from stdin; never pass it as a command-line argument.
const crypto = require('node:crypto');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
    input += chunk;
    if (input.length > 2048) process.exit(1);
});
process.stdin.on('end', () => {
    const password = input.replace(/\r?\n$/, '');
    if (password.length < 16 || password.length > 1024) {
        console.error('Use 16–1024 characters.');
        process.exitCode = 1;
        return;
    }
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, (error, key) => {
        if (error) throw error;
        console.log(`scrypt:${salt}:${key.toString('hex')}`);
    });
});
