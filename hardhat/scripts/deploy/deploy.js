const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const Rarity = {
  0: "Common", 1: "Uncommon", 2: "Rare", 3: "Epic", 4: "Legendary",
};

async function main() {
  console.log("\n🚀 Deploying GameAssetRegistry...\n");
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const deployerBalance = await ethers.provider.getBalance(deployerAddress);
  console.log(`📋 Deployer address : ${deployerAddress}`);
  console.log(`💰 Deployer balance : ${ethers.formatEther(deployerBalance)} ETH`);

  const GameAssetRegistry = await ethers.getContractFactory("GameAssetRegistry");
  const registry = await GameAssetRegistry.deploy();
  await registry.waitForDeployment();
  const contractAddress = await registry.getAddress();
  console.log(`\n✅ GameAssetRegistry deployed at: ${contractAddress}`);

  const deployTx = registry.deploymentTransaction();
  if (deployTx) {
    const receipt = await deployTx.wait();
    console.log(`⛽ Gas used: ${receipt?.gasUsed.toString()}`);
  }

  console.log("\n📦 Registering seed assets...\n");
  const seedAssets = [
    { id: 1, owner: deployerAddress, name: "Dragon Sword", assetType: "weapon", rarity: 4, metadataURI: "ipfs://QmDragonSwordMetadata" },
    { id: 2, owner: deployerAddress, name: "Iron Shield", assetType: "armor", rarity: 0, metadataURI: "ipfs://QmIronShieldMetadata" },
    { id: 3, owner: "0x000000000000000000000000000000000000dEaD", name: "Shadow Rogue", assetType: "character", rarity: 3, metadataURI: "ipfs://QmShadowRogueMetadata" },
  ];

  for (const asset of seedAssets) {
    const tx = await registry.registerAsset(asset.id, asset.owner, asset.name, asset.assetType, asset.rarity, asset.metadataURI);
    await tx.wait();
    const rarityName = Rarity[asset.rarity];
    console.log(`  ✔ Asset #${asset.id} "${asset.name}" [${rarityName}]`);
  }

  const totalAssets = await registry.totalAssets();
  console.log(`\n📊 Total assets on-chain: ${totalAssets}`);

  const network = await ethers.provider.getNetwork();
  const deploymentInfo = {
    contractAddress,
    network: { name: network.name, chainId: network.chainId.toString() },
    deployedAt: new Date().toISOString(),
    deployer: deployerAddress,
  };

  const outputDir = path.join(__dirname, "../../artifacts");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "deployment.json"), JSON.stringify(deploymentInfo, null, 2));
  console.log(`\n✅ Deployment complete at ${contractAddress}\n`);
}

main().catch((err) => { console.error("❌", err); process.exit(1); });
