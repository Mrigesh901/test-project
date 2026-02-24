/**
 * API Route: GET /api/blockchain/contract-info
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ARCHITECTURE DECISION: Why Next.js Serverless vs Express?
 * ─────────────────────────────────────────────────────────────────────────────
 * Your project already has an Express backend (server/app.js). Why add a
 * Next.js API route instead of adding to Express?
 *
 * 1. Serverless routes live inside the Next.js app → single deploy unit
 * 2. They auto-scale to 0 — no idle cost on free-tier / small VPS
 * 3. Each file in pages/api/ becomes an independent function — natural
 *    separation of concerns
 * 4. TypeScript types flow end-to-end from contract ABI to response
 *
 * For blockchain read calls (which are stateless eth_call operations),
 * serverless is a perfect fit.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW READING FROM A SMART CONTRACT WORKS (first principles):
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. We connect to an EVM node via JSON-RPC (HTTP or WebSocket)
 * 2. We call eth_call — this SIMULATES the transaction on the node WITHOUT
 *    broadcasting it to the network (no gas cost, instant response)
 * 3. The node executes the contract view function and returns ABI-encoded bytes
 * 4. Ethers.js decodes those bytes using the ABI into human-readable values
 *
 * This is fundamentally different from a write call (registerAsset) which:
 *   - Requires a signed transaction
 *   - Gets broadcast to all peers
 *   - Must be included in a block (~12 seconds on Ethereum mainnet)
 *   - Costs real gas
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { ethers } from "ethers";
import { GAME_ASSET_REGISTRY_ABI, RARITY_LABELS } from "@/chain/abi/GameAssetRegistry";

// ── Types ──────────────────────────────────────────────────────────────────

interface AssetResponse {
  assetId: number;
  owner: string;
  name: string;
  assetType: string;
  rarity: {
    value: number;
    label: string;
  };
  metadataURI: string;
  registeredAt: string;     // ISO 8601 timestamp
  registeredAtUnix: number;
}

interface StatsResponse {
  totalAssets: number;
  registrar: string;
  contractAddress: string;
  network: string;
  chainId: number;
  blockNumber: number;
}

interface ErrorResponse {
  error: string;
  code: string;
  details?: string;
}

type ApiResponse =
  | {
      success: true;
      data: AssetResponse | StatsResponse | AssetResponse[];
      meta: { queryType: string; responseTimeMs: number };
    }
  | { success: false; error: ErrorResponse };

// ── Configuration ──────────────────────────────────────────────────────────

/**
 * CONTRACT_ADDRESS: Set in .env.local after running the deploy script.
 *
 * Why env var and not hardcode?
 *   - You will redeploy to a new address when you fix bugs in the contract
 *   - Different networks (localhost/sepolia/mainnet) have different addresses
 *   - Env vars let you switch without a code change
 */
const CONTRACT_ADDRESS = process.env.GAME_ASSET_REGISTRY_ADDRESS || "";

/**
 * RPC_URL: The JSON-RPC endpoint of your EVM node.
 *
 * For local dev (after: npx hardhat node):
 *   NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545
 *
 * For Sepolia testnet:
 *   NEXT_PUBLIC_RPC_URL=https://rpc.sepolia.org
 *
 * As a blockchain ops engineer you already know this: production systems
 * should point to their OWN synced nodes, not public RPCs. Public RPCs are
 * rate-limited, shared, and can go down. Your DevOps spec includes
 * "RPC load balancing" — that's exactly this endpoint being HA.
 */
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545";

// ── In-memory cache ────────────────────────────────────────────────────────

/**
 * WHY CACHE HERE?
 * eth_call hits your RPC node on every request. Without caching:
 *   - 100 concurrent users = 100 simultaneous RPC calls
 *   - Public RPCs rate-limit you
 *   - Response time degrades under load
 *
 * This simple Map cache stores responses for 30 seconds.
 * Block time on Ethereum is ~12s, so data changes at most every block.
 * 30s = a good balance between freshness and RPC load.
 *
 * Production upgrade: swap this Map for Redis so all serverless instances
 * share the same cache (this Map is per-instance memory).
 */
const CACHE_TTL_MS = 30_000;
const _cache = new Map<string, { data: unknown; expiresAt: number }>();

function getCached<T>(key: string): T | null {
  const entry = _cache.get(key);
  if (entry && Date.now() < entry.expiresAt) return entry.data as T;
  _cache.delete(key);
  return null;
}
function setCache(key: string, data: unknown): void {
  _cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ── Ethers.js provider + contract (lazy singleton) ─────────────────────────

/**
 * We create the provider once and reuse it across requests.
 * Creating a new JsonRpcProvider on every request would:
 *   - Open a new HTTP connection each time (slow)
 *   - Not benefit from connection keep-alive
 *
 * The singleton pattern here gives us connection reuse within a serverless
 * instance's lifetime.
 */
let _provider: ethers.JsonRpcProvider | null = null;
let _contract: ethers.Contract | null = null;

function getContract(): ethers.Contract {
  if (!_provider || !_contract) {
    _provider = new ethers.JsonRpcProvider(RPC_URL);
    /**
     * Contract(address, abi, provider):
     *   address → WHERE is the contract on-chain
     *   abi     → WHAT functions does it have (encoding/decoding schema)
     *   provider → HOW do we talk to the chain (no signer = read-only)
     *
     * Read-only is intentional — a public API should never hold a private key
     * that can write transactions. Write operations go through a separate
     * authenticated endpoint.
     */
    _contract = new ethers.Contract(CONTRACT_ADDRESS, GAME_ASSET_REGISTRY_ABI, _provider);
  }
  return _contract;
}

// ── Data fetchers ──────────────────────────────────────────────────────────

async function fetchAsset(assetId: number): Promise<AssetResponse> {
  const key = `asset:${assetId}`;
  const cached = getCached<AssetResponse>(key);
  if (cached) return cached;

  const contract = getContract();

  /**
   * contract.getAsset(assetId) does the following under the hood:
   *   1. Encodes: functionSelector(4 bytes) + abi.encode(uint256 assetId)
   *   2. Sends: eth_call { to: CONTRACT_ADDRESS, data: encodedCall }
   *   3. Receives: ABI-encoded return tuple
   *   4. Decodes: into the 6 values we destructure below
   *
   * This is a pure read — no gas, no transaction, no waiting for blocks.
   */
  const [owner, name, assetType, rarityValue, metadataURI, registeredAtBN] =
    await contract.getAsset(assetId);

  const registeredAtUnix = Number(registeredAtBN);
  const asset: AssetResponse = {
    assetId,
    owner,
    name,
    assetType,
    rarity: {
      value: Number(rarityValue),
      label: RARITY_LABELS[Number(rarityValue)] ?? "Unknown",
    },
    metadataURI,
    registeredAt: new Date(registeredAtUnix * 1000).toISOString(),
    registeredAtUnix,
  };

  setCache(key, asset);
  return asset;
}

async function fetchStats(): Promise<StatsResponse> {
  const key = "registry:stats";
  const cached = getCached<StatsResponse>(key);
  if (cached) return cached;

  const contract = getContract();
  const provider = _provider!;

  /**
   * Promise.all fires both RPC calls simultaneously.
   * Sequential awaits would be: (latency1 + latency2) total time.
   * Parallel gives: max(latency1, latency2) — roughly half the wait.
   */
  const [statsResult, blockNumber] = await Promise.all([
    contract.getRegistryStats(),
    provider.getBlockNumber(),
  ]);

  const network = await provider.getNetwork();

  const stats: StatsResponse = {
    totalAssets: Number(statsResult.total),
    registrar: statsResult.registrarAddress,
    contractAddress: CONTRACT_ADDRESS,
    network: network.name,
    chainId: Number(network.chainId),
    blockNumber,
  };

  setCache(key, stats);
  return stats;
}

async function fetchAllAssets(total: number): Promise<AssetResponse[]> {
  const limit = Math.min(total, 50); // Safety cap — no unbounded RPC calls
  const ids = Array.from({ length: limit }, (_, i) => i + 1);
  // Fire all eth_calls in parallel — this is fine for a small registry
  // For 1000+ assets, use pagination (?page=1&size=20)
  return Promise.all(ids.map(fetchAsset));
}

// ── Main API handler ───────────────────────────────────────────────────────

/**
 * Query parameters:
 *   ?assetId=1     → fetch single asset by ID
 *   ?query=stats   → fetch registry stats + current block
 *   ?query=all     → fetch all registered assets
 *   (no params)    → defaults to registry stats
 *
 * Example calls:
 *   GET /api/blockchain/contract-info
 *   GET /api/blockchain/contract-info?assetId=1
 *   GET /api/blockchain/contract-info?query=all
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: { error: "Method not allowed", code: "METHOD_NOT_ALLOWED" },
    });
  }

  if (!CONTRACT_ADDRESS) {
    return res.status(503).json({
      success: false,
      error: {
        error: "Contract address not configured",
        code: "MISSING_CONFIG",
        details:
          "Set GAME_ASSET_REGISTRY_ADDRESS in .env.local after running: npx hardhat run scripts/deploy/deploy.ts --network localhost",
      },
    });
  }

  const startTime = Date.now();
  const { assetId, query } = req.query;

  try {
    let data: AssetResponse | StatsResponse | AssetResponse[];
    let queryType: string;

    if (assetId !== undefined) {
      const id = parseInt(assetId as string, 10);
      if (isNaN(id) || id < 1) {
        return res.status(400).json({
          success: false,
          error: {
            error: "Invalid assetId",
            code: "INVALID_PARAM",
            details: "assetId must be a positive integer e.g. ?assetId=1",
          },
        });
      }
      data = await fetchAsset(id);
      queryType = "single_asset";
    } else if (query === "all") {
      const stats = await fetchStats();
      data = await fetchAllAssets(stats.totalAssets);
      queryType = "all_assets";
    } else {
      data = await fetchStats();
      queryType = "registry_stats";
    }

    /**
     * Cache-Control: tells CDNs (Cloudflare, CloudFront) to cache the response.
     *   s-maxage=30 → CDN caches for 30s
     *   stale-while-revalidate=60 → serve stale while fetching fresh in background
     *
     * This means even if 10,000 users hit this endpoint simultaneously,
     * only ~1 request per 30s actually reaches your RPC node.
     * THIS is how you hit <200ms at scale without expensive infrastructure.
     */
    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");

    return res.status(200).json({
      success: true,
      data,
      meta: { queryType, responseTimeMs: Date.now() - startTime },
    });
  } catch (err: unknown) {
    console.error("[blockchain/contract-info]", err);

    if (err instanceof Error) {
      if (err.message.includes("AssetNotFound")) {
        return res.status(404).json({
          success: false,
          error: {
            error: "Asset not found",
            code: "ASSET_NOT_FOUND",
            details: "No asset with that ID has been registered in the contract",
          },
        });
      }
      if (err.message.includes("ECONNREFUSED") || err.message.includes("could not detect network")) {
        return res.status(503).json({
          success: false,
          error: {
            error: "Blockchain node unreachable",
            code: "RPC_UNAVAILABLE",
            details: `Cannot connect to RPC at ${RPC_URL}. Run: npx hardhat node`,
          },
        });
      }
    }

    return res.status(500).json({
      success: false,
      error: {
        error: "Internal server error",
        code: "INTERNAL_ERROR",
        details: err instanceof Error ? err.message : String(err),
      },
    });
  }
}
