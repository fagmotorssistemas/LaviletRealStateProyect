/* eslint-disable @typescript-eslint/no-require-imports -- Node preload prevents real provider calls. */
// This audit suite uses simulated providers. Any unexpected network request
// must fail before reaching a CRM, model, database or messaging service.
globalThis.fetch = async () => { throw new Error('AUDIT_NETWORK_DISABLED') }
require('node:net').Socket.prototype.connect = function () { throw new Error('AUDIT_NETWORK_DISABLED') }
