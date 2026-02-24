/**
 * Blockchain Routes
 * ─────────────────────────────────────────────────────────────────────────────
 * API endpoints for interacting with the GameAssetRegistry smart contract.
 * All endpoints are read-only (view functions) and don't require authentication
 * for the purposes of this demo.
 *
 * Production considerations:
 *   - Add rate limiting to prevent abuse
 *   - Cache responses if contract data is queried frequently
 *   - Add authorization checks if write functions are added later
 *
 * Routes:
 *   GET /api/blockchain/health           - Health check
 *   GET /api/blockchain/stats            - Registry statistics
 *   GET /api/blockchain/asset/:assetId   - Get specific asset
 *   GET /api/blockchain/balance/:owner   - Get owner's asset count
 *   GET /api/blockchain/exists/:assetId  - Check if asset exists
 * ─────────────────────────────────────────────────────────────────────────────
 */

const express = require("express");
const blockchainController = require("../controllers/blockchainController");

const router = express.Router();

/**
 * Health Check Endpoint
 * Use this to verify blockchain connectivity before making other calls
 */
router.route("/health").get(blockchainController.health);

/**
 * Registry Statistics Endpoint
 * Returns total assets registered and registrar address
 */
router.route("/stats").get(blockchainController.getStats);

/**
 * Get Specific Asset
 * Fetch full details of an asset by ID
 * Includes owner, name, type, rarity, and metadata URI
 */
router.route("/asset/:assetId").get(blockchainController.getAsset);

/**
 * Get Asset Ownership Balance
 * Query how many assets a specific wallet address owns
 */
router.route("/balance/:owner").get(blockchainController.getBalance);

/**
 * Check Asset Existence
 * Quick boolean check if an asset ID has been registered
 */
router.route("/exists/:assetId").get(blockchainController.assetExists);

module.exports = router;
