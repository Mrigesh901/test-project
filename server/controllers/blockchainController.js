/**
 * Blockchain Controller
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles all interactions with the GameAssetRegistry smart contract.
 * Uses ethers.js to call contract methods and query on-chain data.
 *
 * ARCHITECTURE:
 *   1. Provider: connects to the blockchain (hardhat node / Sepolia RPC)
 *   2. Contract: loaded from ABI + address
 *   3. Methods: read-only (view) calls, no gas cost
 *
 * ERROR HANDLING:
 *   - Contract not found: likely deployment script hasn't run
 *   - Network error: hardhat node down or RPC unreachable
 *   - Invalid asset ID: asset doesn't exist on-chain
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

// Type definitions for clarity (JSDoc)
/**
 * @typedef {Object} GameAsset
 * @property {string} owner - Wallet address of the asset owner
 * @property {string} name - Asset name (e.g., "Dragon Sword")
 * @property {string} assetType - Category (weapon, armor, character, etc.)
 * @property {number} rarity - Rarity level (0=Common to 4=Legendary)
 * @property {string} metadataURI - IPFS/Arweave URI pointing to JSON metadata
 * @property {string} registeredAt - Block timestamp when asset was registered
 */

/**
 * @typedef {Object} RegistryStats
 * @property {number} totalAssets - Total assets registered in the contract
 * @property {string} registrar - Address of the contract registrar
 */

// Rarity enum (must match contract definition)
const RARITY_NAMES = ["Common", "Uncommon", "Rare", "Epic", "Legendary"];

/**
 * Load contract deployment info from the shared volume
 * When Docker deploys the contract, it saves deployment.json to a shared volume.
 * This file contains the contract address for the current network.
 *
 * @returns {Object} { contractAddress, network, deployedAt, deployer }
 * @throws {Error} If deployment.json doesn't exist or is invalid
 */
function loadDeploymentInfo() {
  try {
    // Check common locations for the deployment artifact.
    const candidatePaths = [
      path.join('/app/artifacts', 'deployment.json'), // Docker volume mount
      path.join(__dirname, '../artifacts/deployment.json'), // local dev layout
    ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        const data = fs.readFileSync(p, 'utf-8');
        return JSON.parse(data);
      }
    }

    throw new Error(
      `deployment.json not found. Checked: ${candidatePaths.join(', ')}. ` +
        'Make sure the hardhat deployer service has completed.'
    );
  } catch (err) {
    console.error("❌ Failed to load deployment info:", err.message);
    throw err;
  }
}

/**
 * Get or create the contract provider & instance
 * Lazy-loaded on first use to avoid errors if the network isn't ready yet.
 *
 * @returns {Promise<{provider: ethers.Provider, contract: ethers.Contract, deploymentInfo: Object}>}
 */
/**
 * Load the contract ABI from the compiled artifacts
 * This ensures the ABI always matches the deployed contract
 *
 * @returns {Array} The contract ABI from compiled artifacts
 */
function loadContractABI() {
  try {
    const artifactCandidates = [
      '/app/artifacts/contracts/GameAssetRegistry.sol/GameAssetRegistry.json', // Docker
      path.join(__dirname, '../../artifacts/contracts/GameAssetRegistry.sol/GameAssetRegistry.json'), // local
    ];

    for (const artifactPath of artifactCandidates) {
      console.log(`Checking for artifact at: ${artifactPath}`);
      if (fs.existsSync(artifactPath)) {
        console.log(`✓ Found artifact, parsing ABI...`);
        const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
        console.log(`✓ Loaded ABI from: ${artifactPath} (${artifact.abi.length} functions)`);
        return artifact.abi;
      }
    }

    throw new Error(
      `Contract artifact not found. Checked: ${artifactCandidates.join(', ')}`
    );
  } catch (err) {
    console.error("❌ Failed to load contract ABI:", err.message);
    throw err;
  }
}

let _cachedContract = null;

async function getContractInstance() {
  if (_cachedContract) {
    return _cachedContract;
  }

  const deploymentInfo = loadDeploymentInfo();
  // For Docker: use service discovery (hardhat:8545)
  // For local dev: use localhost:8545
  // Can be overridden with HARDHAT_RPC_URL env var
  const rpcUrl =
    process.env.HARDHAT_RPC_URL || "http://hardhat:8545";

  // Create a provider (connection to the blockchain)
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  // Load the ABI from compiled artifacts (not hardcoded!)
  // This ensures the ABI always matches the actual deployed contract
  const ABI = loadContractABI();

  // Create contract instance (read-only, no signer needed for view calls)
  const contract = new ethers.Contract(
    deploymentInfo.contractAddress,
    ABI,
    provider
  );

  _cachedContract = {
    provider,
    contract,
    deploymentInfo,
  };

  return _cachedContract;
}

/**
 * Get detailed information about a specific asset
 *
 * GET /api/blockchain/asset/:assetId
 *
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @returns {Promise<void>}
 *
 * @example
 * GET /api/blockchain/asset/1
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "assetId": 1,
 *     "owner": "0x...",
 *     "name": "Dragon Sword",
 *     "assetType": "weapon",
 *     "rarity": "Legendary",
 *     "metadataURI": "ipfs://Qm...",
 *     "registeredAt": 1234567890
 *   }
 * }
 */
exports.getAsset = async (req, res) => {
  try {
    const { assetId } = req.params;

    if (!assetId || isNaN(assetId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid assetId. Must be a number.",
      });
    }

    const { contract } = await getContractInstance();

    // Call the contract's view function (free, no gas)
    const [owner, name, assetType, rarity, metadataURI, registeredAt] =
      await contract.getAsset(BigInt(assetId));

    const rarityName = RARITY_NAMES[rarity] || "Unknown";

    res.status(200).json({
      success: true,
      data: {
        assetId: parseInt(assetId),
        owner,
        name,
        assetType,
        rarity: rarityName,
        rarityValue: Number(rarity),
        metadataURI,
        registeredAt: registeredAt.toString(),
        // Pretty-print the timestamp for debugging
        registeredDate: new Date(
          parseInt(registeredAt) * 1000
        ).toISOString(),
      },
    });
  } catch (err) {
    console.error("❌ Error fetching asset:", err.message);

    if (err.message.includes("AssetNotFound")) {
      return res.status(404).json({
        success: false,
        error: "Asset not found on-chain.",
      });
    }

    if (
      err.message.includes("ECONNREFUSED") ||
      err.message.includes("NetworkError")
    ) {
      return res.status(503).json({
        success: false,
        error:
          "Blockchain node is unreachable. Is the hardhat node running?",
      });
    }

    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

/**
 * Get registry statistics
 *
 * GET /api/blockchain/stats
 *
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @returns {Promise<void>}
 *
 * @example
 * GET /api/blockchain/stats
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "totalAssets": 3,
 *     "registrar": "0x...",
 *     "contractAddress": "0x...",
 *     "network": {
 *       "name": "localhost",
 *       "chainId": 31337
 *     }
 *   }
 * }
 */
exports.getStats = async (req, res) => {
  try {
    const { contract, deploymentInfo } = await getContractInstance();

    const [total, registrar] = await contract.getRegistryStats();

    res.status(200).json({
      success: true,
      data: {
        totalAssets: total.toString(),
        registrar,
        contractAddress: deploymentInfo.contractAddress,
        network: deploymentInfo.network,
        deployedAt: deploymentInfo.deployedAt,
      },
    });
  } catch (err) {
    console.error("❌ Error fetching stats:", err.message);

    if (
      err.message.includes("ECONNREFUSED") ||
      err.message.includes("NetworkError")
    ) {
      return res.status(503).json({
        success: false,
        error:
          "Blockchain node is unreachable. Is the hardhat node running?",
      });
    }

    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

/**
 * Get assets owned by a specific address
 *
 * GET /api/blockchain/balance/:owner
 *
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @returns {Promise<void>}
 *
 * @example
 * GET /api/blockchain/balance/0x1234...5678
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "owner": "0x1234...5678",
 *     "balance": 5,
 *     "message": "User owns 5 assets"
 *   }
 * }
 */
exports.getBalance = async (req, res) => {
  try {
    const { owner } = req.params;

    // Basic validation: check if it looks like an Ethereum address
    if (!owner || !owner.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({
        success: false,
        error: "Invalid owner address. Must be a valid Ethereum address.",
      });
    }

    const { contract } = await getContractInstance();

    const balance = await contract.balanceOf(owner);

    res.status(200).json({
      success: true,
      data: {
        owner,
        balance: balance.toString(),
        message: `User owns ${balance.toString()} assets`,
      },
    });
  } catch (err) {
    console.error("❌ Error fetching balance:", err.message);

    if (
      err.message.includes("ECONNREFUSED") ||
      err.message.includes("NetworkError")
    ) {
      return res.status(503).json({
        success: false,
        error:
          "Blockchain node is unreachable. Is the hardhat node running?",
      });
    }

    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

/**
 * Check if an asset exists
 *
 * GET /api/blockchain/exists/:assetId
 *
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @returns {Promise<void>}
 *
 * @example
 * GET /api/blockchain/exists/1
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "assetId": 1,
 *     "exists": true
 *   }
 * }
 */
exports.assetExists = async (req, res) => {
  try {
    const { assetId } = req.params;

    if (!assetId || isNaN(assetId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid assetId. Must be a number.",
      });
    }

    const { contract } = await getContractInstance();

    const exists = await contract.assetExistsCheck(BigInt(assetId));

    res.status(200).json({
      success: true,
      data: {
        assetId: parseInt(assetId),
        exists,
      },
    });
  } catch (err) {
    console.error("❌ Error checking asset existence:", err.message);

    if (
      err.message.includes("ECONNREFUSED") ||
      err.message.includes("NetworkError")
    ) {
      return res.status(503).json({
        success: false,
        error:
          "Blockchain node is unreachable. Is the hardhat node running?",
      });
    }

    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

/**
 * Health check endpoint
 * Verifies that the blockchain connection is working
 *
 * GET /api/blockchain/health
 *
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @returns {Promise<void>}
 */
exports.health = async (req, res) => {
  try {
    const { provider, deploymentInfo } = await getContractInstance();

    // Test the connection by fetching the current block
    const blockNumber = await provider.getBlockNumber();

    res.status(200).json({
      success: true,
      data: {
        status: "healthy",
        blockNumber,
        contractAddress: deploymentInfo.contractAddress,
        network: deploymentInfo.network,
      },
    });
  } catch (err) {
    console.error("❌ Blockchain health check failed:", err.message);

    res.status(503).json({
      success: false,
      status: "unhealthy",
      error: err.message,
    });
  }
};
