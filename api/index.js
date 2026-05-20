/**
 * Vercel Serverless Function Wrapper
 * Exports the Express app as a handler for Vercel Functions
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');

// Import the Express app setup from backend/server.js
// Since we can't directly require server.js (it tries to start a server),
// we'll set up a minimal Express app here that handles API routing

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(morgan('short'));

// ============================================================================
// API ROUTES (Import from backend/server.js structure)
// ============================================================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'dobium-api', environment: 'vercel' });
});

// API placeholder - import routes from backend
try {
  // Stub: In production, you'd import specific route handlers from backend/
  // For now, this demonstrates the structure
  const apiRoutes = require('../backend/server');
} catch (err) {
  console.warn('Backend routes not available in serverless');
}

// Serve frontend static files
const FRONTEND_DIST = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(FRONTEND_DIST, { maxAge: '1h' }));

// SPA fallback - serve index.html for non-API routes
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(path.join(FRONTEND_DIST, 'index.html'), (err) => {
    if (err) {
      res.status(404).json({ error: 'Frontend not built. Run: npm run frontend:build' });
    }
  });
});

// Export for Vercel
module.exports = app;
