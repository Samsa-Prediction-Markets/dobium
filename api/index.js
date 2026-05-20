/**
 * Vercel Serverless Entry Point
 * Wraps backend/server.js with error surfacing so crashes return JSON, not HTML 500.
 */

let app;
let initError = null;

try {
  app = require('../backend/server');
} catch (err) {
  initError = err;
  console.error('[api/index.js] Failed to load backend/server.js:', err.message, err.stack);
}

module.exports = (req, res) => {
  if (initError) {
    return res.status(500).json({
      error: 'Server initialization failed',
      message: initError.message,
      type: initError.constructor.name,
    });
  }
  return app(req, res);
};
