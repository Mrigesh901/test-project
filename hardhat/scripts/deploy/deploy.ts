/**
 * Deployment Script: GameAssetRegistry
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS SCRIPT DOES:
 *   1. Compiles the contract (if not already compiled)
 *   2. Gets a signer (your wallet) from hardhat config
 *   3. Deploys the contract — sends a transaction creating it on-chain
 *   4. Registers 3 seed assets so the contract has data for our API to read
 *   5. Saves the deployed address to a JSON file so the API can load it
 *
 * WHY SEED DATA?
 * A freshly deployed contract has no assets. For the API to return interesting
 * data immediately, we seed it during deployment. In production this would be
 * replaced by users registering assets through your game's UI.
 *
 * RUN:
 *   npx hardhat run scripts/deploy/deploy.ts --network localhost
 *   npx hardhat run scripts/deploy/deploy.ts --network sepolia
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Rarity lookup (use array to avoid TypeScript enum syntax which breaks
// strip-only mode in some Node loaders).
const Rarity = [
  'Common',
  'Uncommon',
  'Rare',
  'Epic',
  'Legendary',
] as const;

async function main() {
  console.log("\n🚀 Deploying GameAssetRegistry...\n");

  // ── Step 1: Get deployer account ──────────────────────────────────────────
  /**
   * getSigners() returns the accounts configured in hardhat.config.ts.
   * On localhost, Hardhat auto-provides 20 funded test accounts.
   * On Sepolia, it uses your DEPLOYER_PRIVATE_KEY from .env.local.
   */
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const deployerBalance = await ethers.provider.getBalance(deployerAddress);

  console.log(`📋 Deployer address : ${deployerAddress}`);
  console.log(`💰 Deployer balance : ${ethers.formatEther(deployerBalance)} ETH`);

  // ── Step 2: Deploy the contract ───────────────────────────────────────────
  /**
   * getContractFactory() finds the compiled artifact for "GameAssetRegistry".
   * deploy() sends the constructor transaction to the network.
   * waitForDeployment() waits for the transaction to be mined (included in a block).
   *
   * Gas explanation:
   * Every transaction costs gas. Deployment is the most expensive because
   * you're storing the entire bytecode on-chain. View calls (read-only) are free.
   */
  const GameAssetRegistry = await ethers.getContractFactory("GameAssetRegistry");
  const registry = await GameAssetRegistry.deploy();
  await registry.waitForDeployment();

  const contractAddress = await registry.getAddress();
  console.log(`\n✅ GameAssetRegistry deployed at: ${contractAddress}`);

  // Get the transaction receipt to show gas used
  const deployTx = registry.deploymentTransaction();
  if (deployTx) {
    const receipt = await deployTx.wait();
    console.log(`⛽ Gas used for deployment: ${receipt?.gasUsed.toString()}`);
    console.log(`🔗 Tx hash: ${deployTx.hash}`);
  }

  // ── Step 3: Seed initial assets ───────────────────────────────────────────
  console.log("\n📦 Registering seed assets...\n");

  const seedAssets = [
    {
      id: 1,
      owner: deployerAddress,
      name: "Dragon Sword",
      assetType: "weapon",
      rarity: 4, // Legendary
      metadataURI: "ipfs://QmDragonSwordMetadata",
    },
    {
      id: 2,
      owner: deployerAddress,
      name: "Iron Shield",
      assetType: "armor",
      rarity: 0, // Common
      metadataURI: "ipfs://QmIronShieldMetadata",
    },
    {
      id: 3,
      owner: "0x000000000000000000000000000000000000dEaD", // burn address as second "user"
      name: "Shadow Rogue",
      assetType: "character",
      rarity: 3, // Epic
      metadataURI: "ipfs://QmShadowRogueMetadata",
    },
  ];

  for (const asset of seedAssets) {
    const tx = await registry.registerAsset(
      asset.id,
      asset.owner,
      asset.name,
      asset.assetType,
      asset.rarity,
      asset.metadataURI
    );
    await tx.wait();
    const rarityName = Rarity[asset.rarity];
    console.log(`  ✔ Asset #${asset.id} "${asset.name}" [${rarityName}] → tx: ${tx.hash}`);
  }

  const totalAssets = await registry.totalAssets();
  console.log(`\n📊 Total assets on-chain: ${totalAssets}`);

  // ── Step 4: Save deployment info ──────────────────────────────────────────
  /**
   * We save the deployed address + ABI to a JSON file.
   * Our Next.js API imports this to know WHERE the contract is and
   * HOW to call it (the ABI is the interface definition).
   *
   * WHY SAVE ABI HERE?
   * The ABI (Application Binary Interface) is the "schema" of the contract.
   * It tells ethers.js what functions exist, what parameters they take,
   * and what they return. Without it, you'd have to encode raw hex calls.
   */
  const network = await ethers.provider.getNetwork();
  const deploymentInfo = {
    contractAddress,
    network: {
      name: network.name,
      chainId: network.chainId.toString(),
    },
    deployedAt: new Date().toISOString(),
    deployer: deployerAddress,
    // We'll write a small ABI with just the functions our API needs
    // Full ABI lives in src/artifacts after compilation
  };

    // In Docker: /app/artifacts is mounted as the hardhat_artifacts volume
  // This is how deployment.json is shared with frontend/backend containers
  const outputDir = path.join(__dirname, "../../artifacts");
  fs.mkdirSync(outputDir, { recursive: true });

  const deploymentPath = path.join(outputDir, "deployment.json");
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`\n💾 Deployment info saved to: ${deploymentPath}`);

  console.log("\n─────────────────────────────────────────────────");
  console.log("✅ Deployment complete!");
  console.log(`📍 Contract: ${contractAddress}`);
  console.log(`🌐 Network:  ${network.name} (chainId: ${network.chainId})`);
  console.log("─────────────────────────────────────────────────");
  console.log("\nNext step: Start your Next.js dev server and hit");
  console.log("  GET /api/blockchain/contract-info?assetId=1\n");
}

main().catch((err) => {
  console.error("❌ Deployment failed:", err);
  process.exit(1);
});
