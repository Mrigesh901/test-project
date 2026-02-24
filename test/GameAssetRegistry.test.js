/**
 * GameAssetRegistry — Contract Tests (JavaScript)
 *
 * WHY PLAIN JS INSTEAD OF TYPESCRIPT FOR TESTS?
 * ─────────────────────────────────────────────────────────────────────────────
 * ts-node (the TypeScript runner Hardhat uses) has known ESM/CJS conflicts
 * on Node 20 when the host project uses "module": "esnext" in its tsconfig.
 *
 * Plain .js test files are loaded directly by Node as CJS (no ts-node, no
 * compilation step, no module system ambiguity). The contract itself is still
 * written in Solidity and the API is still TypeScript — only the test runner
 * file is JS. This is a pragmatic tradeoff: production quality where it counts.
 *
 * Hardhat docs explicitly support .js test files.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

// Rarity enum — must match the Solidity contract values exactly
const Rarity = {
  Common:    0,
  Uncommon:  1,
  Rare:      2,
  Epic:      3,
  Legendary: 4,
};

describe("GameAssetRegistry", function () {

  /**
   * FIXTURE PATTERN:
   * Hardhat snapshots EVM state after first fixture run.
   * Each test gets a free instant snapshot revert — no re-deploy needed.
   * This keeps tests fully isolated while staying fast.
   */
  async function deployRegistryFixture() {
    const [owner, user1, user2] = await ethers.getSigners();
    const GameAssetRegistry = await ethers.getContractFactory("GameAssetRegistry");
    const registry = await GameAssetRegistry.deploy();
    await registry.waitForDeployment();
    return { registry, owner, user1, user2 };
  }

  async function deployWithAssetsFixture() {
    const { registry, owner, user1, user2 } = await deployRegistryFixture();
    // Seed two assets so tests that need existing data don't re-deploy
    await registry.registerAsset(1, owner.address, "Dragon Sword", "weapon", Rarity.Legendary, "ipfs://QmDragonSword");
    await registry.registerAsset(2, user1.address, "Iron Shield",  "armor",  Rarity.Common,    "ipfs://QmIronShield");
    return { registry, owner, user1, user2 };
  }

  // ── Deployment ─────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("sets the deployer as registrar", async function () {
      const { registry, owner } = await loadFixture(deployRegistryFixture);
      expect(await registry.registrar()).to.equal(owner.address);
    });

    it("starts with 0 total assets", async function () {
      const { registry } = await loadFixture(deployRegistryFixture);
      expect(await registry.totalAssets()).to.equal(0n); // BigInt on ethers v6
    });
  });

  // ── registerAsset() ────────────────────────────────────────────────────────

  describe("registerAsset()", function () {
    it("registers an asset and emits AssetRegistered event", async function () {
      const { registry, user1 } = await loadFixture(deployRegistryFixture);

      await expect(
        registry.registerAsset(1, user1.address, "Dragon Sword", "weapon", Rarity.Legendary, "ipfs://QmDragonSword")
      ).to.emit(registry, "AssetRegistered");

      expect(await registry.totalAssets()).to.equal(1n);
    });

    it("increments owner balance after registration", async function () {
      const { registry, user1 } = await loadFixture(deployRegistryFixture);

      expect(await registry.balanceOf(user1.address)).to.equal(0n);
      await registry.registerAsset(1, user1.address, "Sword",  "weapon", Rarity.Common, "ipfs://x");
      await registry.registerAsset(2, user1.address, "Shield", "armor",  Rarity.Rare,   "ipfs://y");
      expect(await registry.balanceOf(user1.address)).to.equal(2n);
    });

    it("reverts with NotRegistrar when non-deployer calls it", async function () {
      const { registry, user1 } = await loadFixture(deployRegistryFixture);

      await expect(
        registry.connect(user1).registerAsset(1, user1.address, "Sword", "weapon", Rarity.Common, "ipfs://x")
      ).to.be.revertedWithCustomError(registry, "NotRegistrar");
    });

    it("reverts on duplicate asset ID", async function () {
      const { registry, owner } = await loadFixture(deployRegistryFixture);

      await registry.registerAsset(1, owner.address, "Sword", "weapon", Rarity.Common, "ipfs://x");
      await expect(
        registry.registerAsset(1, owner.address, "Sword2", "weapon", Rarity.Rare, "ipfs://y")
      ).to.be.revertedWith("Asset ID already registered");
    });
  });

  // ── getAsset() ─────────────────────────────────────────────────────────────

  describe("getAsset()", function () {
    it("returns correct asset data", async function () {
      const { registry, owner } = await loadFixture(deployWithAssetsFixture);

      const [assetOwner, name, assetType, rarity] = await registry.getAsset(1);
      expect(assetOwner).to.equal(owner.address);
      expect(name).to.equal("Dragon Sword");
      expect(assetType).to.equal("weapon");
      expect(rarity).to.equal(BigInt(Rarity.Legendary)); // ethers v6 returns BigInt for uint8
    });

    it("reverts with AssetNotFound for unregistered ID", async function () {
      const { registry } = await loadFixture(deployWithAssetsFixture);

      await expect(registry.getAsset(999))
        .to.be.revertedWithCustomError(registry, "AssetNotFound")
        .withArgs(999);
    });
  });

  // ── transferAsset() ────────────────────────────────────────────────────────

  describe("transferAsset()", function () {
    it("transfers ownership and updates both balances", async function () {
      const { registry, owner, user2 } = await loadFixture(deployWithAssetsFixture);

      expect(await registry.balanceOf(owner.address)).to.equal(1n);
      expect(await registry.balanceOf(user2.address)).to.equal(0n);

      await expect(registry.transferAsset(1, user2.address))
        .to.emit(registry, "AssetTransferred");

      const [newOwner] = await registry.getAsset(1);
      expect(newOwner).to.equal(user2.address);
      expect(await registry.balanceOf(owner.address)).to.equal(0n);
      expect(await registry.balanceOf(user2.address)).to.equal(1n);
    });

    it("reverts with NotAssetOwner for non-owner caller", async function () {
      const { registry, user2 } = await loadFixture(deployWithAssetsFixture);

      await expect(registry.connect(user2).transferAsset(1, user2.address))
        .to.be.revertedWithCustomError(registry, "NotAssetOwner");
    });
  });

  // ── getRegistryStats() ────────────────────────────────────────────────────

  describe("getRegistryStats()", function () {
    it("returns correct total assets and registrar address", async function () {
      const { registry, owner } = await loadFixture(deployWithAssetsFixture);

      const [total, registrarAddr] = await registry.getRegistryStats();
      expect(total).to.equal(2n);
      expect(registrarAddr).to.equal(owner.address);
    });
  });

});
