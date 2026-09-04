'use strict';

const crypto = require('crypto');
const hex = (n) => crypto.randomBytes(Math.ceil(n / 2)).toString('hex').slice(0, n).toUpperCase();
const UserId = () => `USR-${hex(8)}`;
module.exports = { UserId };
