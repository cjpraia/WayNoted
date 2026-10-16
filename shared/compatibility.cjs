const records = require('./compatibility.json')
module.exports = Object.fromEntries(Object.entries(records).map(([key, value]) => [key, Buffer.from(value, 'base64').toString('utf8')]))
