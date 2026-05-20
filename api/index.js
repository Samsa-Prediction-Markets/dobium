/**
 * Vercel Serverless Entry Point
 *
 * Imports the real Express app from backend/server.js and exports it for Vercel.
 * backend/server.js guards app.listen() behind `require.main === module`, so
 * it won't try to bind a port here — Vercel handles that automatically.
 */

const app = require('../backend/server');

module.exports = app;
