'use strict';

/**
 * Dobium — Rust Engine Bridge
 *
 * Calls the compiled Rust binary (engine/target/release/dobium-engine)
 * via child_process, passing JSON on stdin and reading JSON from stdout.
 *
 * If the binary is not found (e.g. not yet compiled), falls back to the
 * pure-JS implementation in lib/payouts.js and logs a warning.
 *
 * Commands supported:
 *   settle(stake, probability, didWin) → { payout, platform_revenue, formula, ... }
 *   breakdown(stake, probability)      → TradeBreakdown
 *   resolve(trades, winningOutcomeId)  → ResolutionResult
 *   invest(b, qYes, qNo, side, stake)  → { invest_result, new_state }
 *   probability(b, qYes, qNo)          → { probability, probability_percent }
 *   Don't build the Rust engine at all
 *   Let the Node.js implementation handle LMSR calculations
 */

const { execFile } = require('child_process');
const path = require('path');
const { resolveMarket, settleTrade } = require('./payouts');

// Path to the compiled Rust binary (GNU toolchain — no MSVC needed)
const BINARY_WIN = path.join(__dirname, '..', 'engine', 'target', 'release', 'dobium-engine.exe');
const BINARY_GNU = path.join(__dirname, '..', 'engine', 'target', 'x86_64-pc-windows-gnu', 'release', 'dobium-engine.exe');
const BINARY_UNIX = path.join(__dirname, '..', 'engine', 'target', 'release', 'dobium-engine');

function getBinaryPath() {
  const fs = require('fs');
  if (fs.existsSync(BINARY_WIN)) return BINARY_WIN;
  if (fs.existsSync(BINARY_GNU)) return BINARY_GNU;
  if (fs.existsSync(BINARY_UNIX)) return BINARY_UNIX;
  return null;
}

/**
 * Run a command through the Rust engine binary.
 * @param {object} command - JSON command object
 * @returns {Promise<object>} Parsed JSON result from Rust
 */
function runEngine(command) {
  return new Promise((resolve, reject) => {
    const binaryPath = getBinaryPath();

    if (!binaryPath) {
      reject(new Error(
        'dobium-engine binary not found. ' +
        'Run: cd engine && cargo build --release'
      ));
      return;
    }

    const input = JSON.stringify(command);

    execFile(binaryPath, [], { timeout: 5000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Rust engine error: ${error.message}. stderr: ${stderr}`));
        return;
      }
      try {
        const result = JSON.parse(stdout.trim());
        if (result.error) {
          reject(new Error(`Rust engine: ${result.error}`));
        } else {
          resolve(result);
        }
      } catch (e) {
        reject(new Error(`Failed to parse Rust output: ${stdout}`));
      }
    }).stdin.end(input);
  });
}

// ── JS fallback (used when binary is unavailable) ──────────────────────────

function jsFallbackSettle(stake, probability, didWin) {
  console.warn('[dobium-engine] Using JS fallback for settle (binary not compiled)');
  return Promise.resolve(settleTrade(stake, probability, didWin));
}

function jsFallbackResolve(trades, winningOutcomeId) {
  console.warn('[dobium-engine] Using JS fallback for resolve (binary not compiled)');
  return Promise.resolve(resolveMarket(trades, winningOutcomeId));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Settle a single trade.
 *
 * @param {number} stake          - User's stake ($)
 * @param {number} probability    - Market probability at trade time (0–1)
 * @param {boolean} didWin        - Whether the trade won
 * @returns {Promise<{payout, platform_revenue, formula, won, stake, probability}>}
 */
async function settle(stake, probability, didWin) {
  try {
    return await runEngine({ command: 'settle', stake, probability, did_win: didWin });
  } catch (e) {
    if (e.message.includes('not found')) {
      return jsFallbackSettle(stake, probability, didWin);
    }
    throw e;
  }
}

/**
 * Get a full trade preview breakdown (for UI display).
 *
 * @param {number} stake
 * @param {number} probability
 * @returns {Promise<TradeBreakdown>}
 */
async function breakdown(stake, probability) {
  return runEngine({ command: 'breakdown', stake, probability });
}

/**
 * Resolve all trades in a market.
 *
 * @param {Array<{trade_id, user_id, stake, entry_prob, outcome_id}>} trades
 * @param {string} winningOutcomeId
 * @returns {Promise<ResolutionResult>}
 */
async function resolve(trades, winningOutcomeId) {
  try {
    return await runEngine({
      command: 'resolve',
      winning_outcome_id: winningOutcomeId,
      trades,
    });
  } catch (e) {
    if (e.message.includes('not found')) {
      return jsFallbackResolve(trades, winningOutcomeId);
    }
    throw e;
  }
}

/**
 * Invest on a YES/NO market and get new state.
 *
 * @param {number} b      - Liquidity parameter
 * @param {number} qYes   - Current YES pressure
 * @param {number} qNo    - Current NO pressure
 * @param {string} side   - "YES" or "NO"
 * @param {number} stake  - Amount to invest
 * @returns {Promise<{invest_result, new_state}>}
 */
async function invest(b, qYes, qNo, side, stake) {
  return runEngine({ command: 'invest', b, q_yes: qYes, q_no: qNo, side, stake });
}

/**
 * Get current market probability from LMSR state.
 *
 * @param {number} b
 * @param {number} qYes
 * @param {number} qNo
 * @returns {Promise<{probability, probability_percent}>}
 */
async function probability(b, qYes, qNo) {
  return runEngine({ command: 'probability', b, q_yes: qYes, q_no: qNo });
}

/**
 * Check if the Rust binary is available and functional.
 * @returns {Promise<boolean>}
 */
async function isAvailable() {
  try {
    const result = await breakdown(100, 0.5);
    return result && typeof result.win === 'object';
  } catch {
    return false;
  }
}

module.exports = {
  settle,
  breakdown,
  resolve,
  invest,
  probability,
  isAvailable,
};
