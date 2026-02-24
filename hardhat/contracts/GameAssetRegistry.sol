// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title GameAssetRegistry
 * @author dantelabs
 * @notice On-chain registry for Web3 game assets. Each asset has an owner,
 *         a type, a rarity tier, and an arbitrary metadata URI (e.g. IPFS).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FIRST PRINCIPLES — Why does this contract exist?
 * ─────────────────────────────────────────────────────────────────────────────
 * Traditional game item databases live on a company's server. The company can:
 *   • Delete your items
 *   • Duplicate rare items (inflation)
 *   • Shut down and your items vanish
 *
 * By storing ownership + provenance on-chain:
 *   • Nobody can delete or duplicate an asset (consensus enforced)
 *   • The asset exists independently of our backend
 *   • Anyone can verify scarcity by reading the chain
 *
 * This contract is intentionally simple — production would extend it with
 * ERC-721 (NFT standard) but this version focuses on the core registry
 * pattern so the concepts are clear.
 * ─────────────────────────────────────────────────────────────────────────────
 */
contract GameAssetRegistry {

    // ─── DATA STRUCTURES ──────────────────────────────────────────────────────

    /**
     * @dev Rarity tiers. Stored as uint8 on-chain (1 byte) to save gas.
     * Why enum? Prevents invalid values — solidity will revert if you try to
     * assign a number outside the enum range.
     */
    enum Rarity { Common, Uncommon, Rare, Epic, Legendary }

    /**
     * @dev Core asset struct. Everything stored here is immutable after
     * registration — to update metadata you'd re-register or extend the struct.
     *
     * Solidity packs struct fields into 32-byte storage slots.
     * Layout here: owner(20) + assetType(1) + rarity(1) = 22 bytes → fits in
     * one slot alongside the other fields.
     */
    struct GameAsset {
        address owner;          // Who owns this asset right now
        string  name;           // Human-readable name e.g. "Dragon Sword"
        string  assetType;      // Category: "weapon", "armor", "character", etc
        Rarity  rarity;         // How rare is this asset
        string  metadataURI;    // IPFS/Arweave URI pointing to full metadata JSON
        uint256 registeredAt;   // Block timestamp when asset was registered
        bool    exists;         // Guard flag — prevents reading unregistered IDs
    }

    // ─── STATE ────────────────────────────────────────────────────────────────

    /**
     * @dev The registry itself. assetId → GameAsset.
     * Using a mapping (hash table) not an array because:
     *   • O(1) lookup regardless of registry size
     *   • We never need to iterate all assets on-chain (expensive)
     *   • Gaps in IDs are fine
     */
    mapping(uint256 => GameAsset) private _assets;

    /**
     * @dev Track how many assets each address owns.
     * Separate from the main mapping for cheap owner balance queries.
     */
    mapping(address => uint256) private _ownerBalance;

    /// @dev Total assets ever registered (never decrements — IDs are permanent)
    uint256 public totalAssets;

    /// @dev Contract deployer — the only address that can register assets
    ///      (In production you'd use OpenZeppelin's Ownable or AccessControl)
    address public immutable registrar;

    // ─── EVENTS ───────────────────────────────────────────────────────────────

    /**
     * @dev Events are the blockchain's equivalent of application logs.
     * They are stored in the transaction receipt (NOT in contract storage),
     * which makes them cheap to emit but not readable from other contracts.
     * Off-chain systems (like our API) index them via eth_getLogs.
     */
    event AssetRegistered(
        uint256 indexed assetId,
        address indexed owner,
        string  name,
        Rarity  rarity,
        uint256 timestamp
    );

    event AssetTransferred(
        uint256 indexed assetId,
        address indexed from,
        address indexed to,
        uint256 timestamp
    );

    // ─── ERRORS ───────────────────────────────────────────────────────────────

    /**
     * @dev Custom errors (Solidity 0.8+) are cheaper than require strings.
     * The error selector is just 4 bytes vs. encoding a whole string.
     */
    error NotRegistrar();
    error AssetNotFound(uint256 assetId);
    error NotAssetOwner(uint256 assetId, address caller);

    // ─── CONSTRUCTOR ──────────────────────────────────────────────────────────

    /**
     * @dev Called exactly ONCE when the contract is deployed.
     * msg.sender is the deployer's address.
     * `immutable` means registrar is set at deploy time and baked into
     * the bytecode — cheaper to read than a regular storage variable.
     */
    constructor() {
        registrar = msg.sender;
    }

    // ─── MODIFIERS ────────────────────────────────────────────────────────────

    /**
     * @dev Modifiers are reusable pre/post conditions.
     * The `_` is where the function body executes.
     * Think of them like middleware in Express.js.
     */
    modifier onlyRegistrar() {
        if (msg.sender != registrar) revert NotRegistrar();
        _;
    }

    modifier assetExists(uint256 assetId) {
        if (!_assets[assetId].exists) revert AssetNotFound(assetId);
        _;
    }

    // ─── WRITE FUNCTIONS ──────────────────────────────────────────────────────

    /**
     * @notice Register a new game asset on-chain.
     * @dev Only the registrar (deployer) can call this.
     *      In production: extend to allow any user to register their own assets.
     *
     * @param assetId    Unique identifier (your backend assigns this)
     * @param owner      Initial owner's wallet address
     * @param name       Human-readable asset name
     * @param assetType  Category string
     * @param rarity     Rarity enum value (0=Common … 4=Legendary)
     * @param metadataURI IPFS URI to full JSON metadata
     */
    function registerAsset(
        uint256 assetId,
        address owner,
        string calldata name,
        string calldata assetType,
        Rarity rarity,
        string calldata metadataURI
    ) external onlyRegistrar {
        // Prevent accidental overwrite of existing asset
        require(!_assets[assetId].exists, "Asset ID already registered");

        _assets[assetId] = GameAsset({
            owner:        owner,
            name:         name,
            assetType:    assetType,
            rarity:       rarity,
            metadataURI:  metadataURI,
            registeredAt: block.timestamp,
            exists:       true
        });

        _ownerBalance[owner]++;
        totalAssets++;

        emit AssetRegistered(assetId, owner, name, rarity, block.timestamp);
    }

    /**
     * @notice Transfer an asset to a new owner.
     * @dev Only the current owner can transfer.
     */
    function transferAsset(uint256 assetId, address to)
        external
        assetExists(assetId)
    {
        GameAsset storage asset = _assets[assetId];
        if (asset.owner != msg.sender) revert NotAssetOwner(assetId, msg.sender);

        address from = asset.owner;
        asset.owner = to;
        _ownerBalance[from]--;
        _ownerBalance[to]++;

        emit AssetTransferred(assetId, from, to, block.timestamp);
    }

    // ─── READ FUNCTIONS (VIEW) ────────────────────────────────────────────────

    /**
     * @notice Fetch full details for an asset.
     * @dev `view` functions don't modify state → no gas cost when called
     *      off-chain (eth_call). This is what our API will use.
     *
     * Returns a tuple — our API decodes this from the ABI-encoded response.
     */
    function getAsset(uint256 assetId)
        external
        view
        assetExists(assetId)
        returns (
            address owner,
            string memory name,
            string memory assetType,
            Rarity rarity,
            string memory metadataURI,
            uint256 registeredAt
        )
    {
        GameAsset storage a = _assets[assetId];
        return (a.owner, a.name, a.assetType, a.rarity, a.metadataURI, a.registeredAt);
    }

    /**
     * @notice Check if an asset ID has been registered.
     */
    function assetExistsCheck(uint256 assetId) external view returns (bool) {
        return _assets[assetId].exists;
    }

    /**
     * @notice How many assets does an address own?
     */
    function balanceOf(address owner) external view returns (uint256) {
        return _ownerBalance[owner];
    }

    /**
     * @notice Get registry stats — useful for our API dashboard endpoint.
     */
    function getRegistryStats()
        external
        view
        returns (uint256 total, address registrarAddress)
    {
        return (totalAssets, registrar);
    }
}
