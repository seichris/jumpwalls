// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title GHBounties
/// @notice ETH + ERC20 escrow per (repo, issue). Repo maintainer approves payouts/refunds.
///         Funders can withdraw *their* remaining contribution after their chosen lock expires,
///         but only if no payout has occurred for the bounty.
contract GHBounties {
    enum BountyStatus {
        OPEN,
        IMPLEMENTED,
        CLOSED
    }

    struct Repo {
        address maintainer;
        bool exists;
    }

    struct Bounty {
        bytes32 repoHash;
        uint256 issueNumber;
        BountyStatus status;
        uint64 createdAt;
        string metadataURI; // optional (e.g. issue URL)
    }

    struct Claim {
        address claimer;
        uint64 createdAt;
        string metadataURI; // e.g. PR URL
    }

    // address(0) represents native ETH.
    address public constant NATIVE_TOKEN = address(0);

    error RepoAlreadyRegistered();
    error RepoNotRegistered();
    error BountyAlreadyExists();
    error BountyNotFound();
    error BountyNotOpen();
    error InvalidAmount();
    error InvalidToken();
    error RefundNotAvailable();
    error NothingToRefund();
    error Unauthorized();
    error InvalidNonce();
    error SignatureExpired();
    error InvalidSignature();
    error DaoNotAvailable();
    error PayoutModeLocked();
    error ClaimAuthRequired();

    // ---- EIP-712 payout/refund auth (trusted backend signer) ----
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256(bytes("GHBounties"));
    bytes32 private constant VERSION_HASH = keccak256(bytes("1"));

    bytes32 private constant PAYOUT_TYPEHASH =
        keccak256("Payout(bytes32 bountyId,address token,address recipient,uint256 amount,uint256 nonce,uint256 deadline)");
    bytes32 private constant REFUND_TYPEHASH =
        keccak256("Refund(bytes32 bountyId,address token,address funder,uint256 amount,uint256 nonce,uint256 deadline)");
    bytes32 private constant CLAIM_TYPEHASH =
        keccak256("Claim(bytes32 bountyId,address claimer,bytes32 claimHash,uint256 nonce,uint256 deadline)");

    bytes32 public immutable DOMAIN_SEPARATOR;
    address public immutable payoutAuthorizer; // trusted backend signer
    address public immutable dao; // optional Gnosis Safe (or other) address for escalation
    uint64 public immutable daoDelaySeconds;

    event RepoRegistered(bytes32 indexed repoHash, address indexed maintainer);
    event RepoMaintainerChanged(bytes32 indexed repoHash, address indexed oldMaintainer, address indexed newMaintainer);

    event BountyCreated(bytes32 indexed bountyId, bytes32 indexed repoHash, uint256 indexed issueNumber, string metadataURI);
    event BountyFunded(
        bytes32 indexed bountyId,
        address indexed token,
        address indexed funder,
        uint256 amount,
        uint64 lockedUntil
    );
    event ClaimSubmitted(bytes32 indexed bountyId, uint256 indexed claimId, address indexed claimer, string metadataURI);
    event StatusChanged(bytes32 indexed bountyId, BountyStatus status);
    event PaidOut(bytes32 indexed bountyId, address indexed token, address indexed recipient, uint256 amount);
    event Refunded(bytes32 indexed bountyId, address indexed token, address indexed funder, uint256 amount);

    mapping(bytes32 repoHash => Repo) public repos;
    mapping(bytes32 bountyId => Bounty) public bounties;

    // bountyId => token => escrow totals
    mapping(bytes32 bountyId => mapping(address token => uint256)) public escrowed;
    mapping(bytes32 bountyId => mapping(address token => uint256)) public totalFunded;
    mapping(bytes32 bountyId => mapping(address token => uint256)) public totalPaid;

    // Once any payout occurs (in any token), timeout withdrawals are disabled for this bounty.
    mapping(bytes32 bountyId => bool) public anyPayoutOccurred;

    // bountyId => token => funder => contributed (net of refunds/withdrawals)
    mapping(bytes32 bountyId => mapping(address token => mapping(address funder => uint256))) public contributions;
    // bountyId => token => funder => unix timestamp until which funds are not withdrawable
    mapping(bytes32 bountyId => mapping(address token => mapping(address funder => uint64))) public lockedUntil;

    // bountyId => claimId => Claim
    mapping(bytes32 bountyId => mapping(uint256 claimId => Claim claim)) public claims;
    mapping(bytes32 bountyId => uint256 nextClaimId) public nextClaimIds;

    mapping(bytes32 bountyId => uint256) public payoutNonces;
    mapping(bytes32 bountyId => uint256) public refundNonces;
    mapping(bytes32 bountyId => mapping(address claimer => uint256)) public claimNonces;

    uint64 public immutable defaultLockDuration; // seconds (e.g. 7 days)

    constructor(uint64 _defaultLockDuration, address _payoutAuthorizer, address _dao, uint64 _daoDelaySeconds) {
        defaultLockDuration = _defaultLockDuration;
        payoutAuthorizer = _payoutAuthorizer;
        dao = _dao;
        daoDelaySeconds = _daoDelaySeconds;

        uint256 chainId;
        assembly {
            chainId := chainid()
        }
        DOMAIN_SEPARATOR = keccak256(abi.encode(EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, chainId, address(this)));
    }

    // -------- Repo management --------

    /// @notice Register a repoHash with msg.sender as maintainer (opt-in).
    /// @dev GitHub admin verification is expected off-chain (GitHub App / OAuth).
    function registerRepo(bytes32 repoHash) external {
        Repo storage r = repos[repoHash];
        if (r.exists) revert RepoAlreadyRegistered();
        repos[repoHash] = Repo({maintainer: msg.sender, exists: true});
        emit RepoRegistered(repoHash, msg.sender);
    }

    function changeMaintainer(bytes32 repoHash, address newMaintainer) external {
        Repo storage r = repos[repoHash];
        if (!r.exists) revert RepoNotRegistered();
        if (msg.sender != r.maintainer) revert Unauthorized();
        address old = r.maintainer;
        r.maintainer = newMaintainer;
        emit RepoMaintainerChanged(repoHash, old, newMaintainer);
    }

    // -------- Bounties --------

    function computeBountyId(bytes32 repoHash, uint256 issueNumber) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(repoHash, issueNumber));
    }

    function createBounty(bytes32 repoHash, uint256 issueNumber, string calldata metadataURI) external returns (bytes32) {
        bytes32 bountyId = computeBountyId(repoHash, issueNumber);
        Bounty storage b = bounties[bountyId];
        if (b.createdAt != 0) revert BountyAlreadyExists();

        b.repoHash = repoHash;
        b.issueNumber = issueNumber;
        b.status = BountyStatus.OPEN;
        b.createdAt = uint64(block.timestamp);
        b.metadataURI = metadataURI;

        emit BountyCreated(bountyId, repoHash, issueNumber, metadataURI);
        return bountyId;
    }

    // -------- Funding --------

    /// @notice Fund a bounty with ETH and optionally set/extend your lock.
    /// @param lockDurationSeconds If 0, uses defaultLockDuration. Otherwise uses the provided duration.
    function fundBountyETH(bytes32 bountyId, uint64 lockDurationSeconds) external payable {
        _fund(bountyId, NATIVE_TOKEN, msg.value, lockDurationSeconds);
    }

    /// @notice Fund a bounty with an ERC20 token. Requires prior approval.
    /// @param token ERC20 address (must be non-zero)
    /// @param amount Token amount (in token decimals, e.g. USDC 6)
    /// @param lockDurationSeconds If 0, uses defaultLockDuration. Otherwise uses the provided duration.
    function fundBountyToken(bytes32 bountyId, address token, uint256 amount, uint64 lockDurationSeconds) external {
        if (token == NATIVE_TOKEN) revert InvalidToken();
        if (amount == 0) revert InvalidAmount();

        Bounty storage b = bounties[bountyId];
        if (b.createdAt == 0) revert BountyNotFound();
        if (b.status != BountyStatus.OPEN) revert BountyNotOpen();

        // Pull tokens from funder.
        bool ok = IERC20(token).transferFrom(msg.sender, address(this), amount);
        require(ok, "TOKEN_TRANSFER_FROM_FAILED");

        _updateContributionAndLock(bountyId, token, amount, lockDurationSeconds);
        emit BountyFunded(bountyId, token, msg.sender, amount, lockedUntil[bountyId][token][msg.sender]);
    }

    function _fund(bytes32 bountyId, address token, uint256 amount, uint64 lockDurationSeconds) internal {
        if (amount == 0) revert InvalidAmount();

        Bounty storage b = bounties[bountyId];
        if (b.createdAt == 0) revert BountyNotFound();
        if (b.status != BountyStatus.OPEN) revert BountyNotOpen();

        _updateContributionAndLock(bountyId, token, amount, lockDurationSeconds);
        emit BountyFunded(bountyId, token, msg.sender, amount, lockedUntil[bountyId][token][msg.sender]);
    }

    function _updateContributionAndLock(bytes32 bountyId, address token, uint256 amount, uint64 lockDurationSeconds) internal {
        escrowed[bountyId][token] += amount;
        totalFunded[bountyId][token] += amount;
        contributions[bountyId][token][msg.sender] += amount;

        uint64 dur = lockDurationSeconds == 0 ? defaultLockDuration : lockDurationSeconds;
        uint64 until = uint64(block.timestamp) + dur;
        uint64 prev = lockedUntil[bountyId][token][msg.sender];
        if (until > prev) lockedUntil[bountyId][token][msg.sender] = until;
    }

    // -------- Claims --------

    function submitClaim(bytes32 bountyId, string calldata claimMetadataURI) external returns (uint256 claimId) {
        if (payoutAuthorizer != address(0)) revert ClaimAuthRequired();
        Bounty storage b = bounties[bountyId];
        if (b.createdAt == 0) revert BountyNotFound();

        claimId = nextClaimIds[bountyId]++;
        claims[bountyId][claimId] =
            Claim({claimer: msg.sender, createdAt: uint64(block.timestamp), metadataURI: claimMetadataURI});
        emit ClaimSubmitted(bountyId, claimId, msg.sender, claimMetadataURI);
    }

    function submitClaimWithAuthorization(
        bytes32 bountyId,
        string calldata claimMetadataURI,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external returns (uint256 claimId) {
        Bounty storage b = bounties[bountyId];
        if (b.createdAt == 0) revert BountyNotFound();

        bytes32 claimHash = keccak256(bytes(claimMetadataURI));
        _verifyClaimAuth(bountyId, msg.sender, claimHash, nonce, deadline, signature, payoutAuthorizer);
        claimNonces[bountyId][msg.sender] = nonce + 1;

        claimId = nextClaimIds[bountyId]++;
        claims[bountyId][claimId] =
            Claim({claimer: msg.sender, createdAt: uint64(block.timestamp), metadataURI: claimMetadataURI});
        emit ClaimSubmitted(bountyId, claimId, msg.sender, claimMetadataURI);
    }

    // -------- Maintainer controls --------

    function setStatus(bytes32 bountyId, BountyStatus status) external {
        bountyId; // silence unused var warning
        status;
        // Legacy maintainer controls are intentionally disabled. Use backend authorization or DAO escalation.
        revert Unauthorized();
    }

    function payout(bytes32 bountyId, address token, address payable recipient, uint256 amount) external {
        bountyId;
        token;
        recipient;
        amount;
        // Legacy maintainer payout is intentionally disabled. Use payoutWithAuthorization or daoPayout.
        revert Unauthorized();
    }

    /// @notice Maintainer-driven refund (any time, any amount up to contribution).
    function refund(bytes32 bountyId, address token, address payable funder, uint256 amount) external {
        bountyId;
        token;
        funder;
        amount;
        // Legacy maintainer refund is intentionally disabled. Use refundWithAuthorization or daoRefund.
        revert Unauthorized();
    }

    // -------- Backend-authorized actions (no repo registration required) --------

    function payoutWithAuthorization(
        bytes32 bountyId,
        address token,
        address payable recipient,
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external {
        Bounty storage b = bounties[bountyId];
        if (b.createdAt == 0) revert BountyNotFound();
        if (b.status == BountyStatus.CLOSED) revert BountyNotOpen();
        if (amount == 0 || amount > escrowed[bountyId][token]) revert InvalidAmount();

        _verifyAuth(PAYOUT_TYPEHASH, bountyId, token, recipient, amount, nonce, deadline, signature, payoutAuthorizer);
        payoutNonces[bountyId] = nonce + 1;

        // Backend-authorized payouts don't decrement individual funder contributions.
        // Disable timeout withdrawals once any payout occurs for this bounty.
        anyPayoutOccurred[bountyId] = true;
        _payout(bountyId, token, recipient, amount);
    }

    function refundWithAuthorization(
        bytes32 bountyId,
        address token,
        address payable funder,
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external {
        Bounty storage b = bounties[bountyId];
        if (b.createdAt == 0) revert BountyNotFound();

        _verifyAuth(REFUND_TYPEHASH, bountyId, token, funder, amount, nonce, deadline, signature, payoutAuthorizer);
        refundNonces[bountyId] = nonce + 1;

        _refund(bountyId, token, funder, amount);
    }

    // -------- DAO escalation (Safe can call directly, no dedicated UI required) --------

    function daoPayout(bytes32 bountyId, address token, address payable recipient, uint256 amount) external {
        _requireDaoEscalated(bountyId);
        if (amount == 0 || amount > escrowed[bountyId][token]) revert InvalidAmount();
        // DAO payouts don't decrement individual funder contributions.
        anyPayoutOccurred[bountyId] = true;
        _payout(bountyId, token, recipient, amount);
    }

    function daoRefund(bytes32 bountyId, address token, address payable funder, uint256 amount) external {
        _requireDaoEscalated(bountyId);
        _refund(bountyId, token, funder, amount);
    }

    // -------- Funder-driven payout (no GitHub, no backend) --------

    /// @notice A funder can directly pay out up to their own remaining contribution.
    /// @dev This is only available if no backend/DAO payout has occurred (since those payouts don't decrement contributions).
    function funderPayout(bytes32 bountyId, address token, address payable recipient, uint256 amount) external {
        Bounty storage b = bounties[bountyId];
        if (b.createdAt == 0) revert BountyNotFound();
        if (b.status == BountyStatus.CLOSED) revert BountyNotOpen();
        if (anyPayoutOccurred[bountyId]) revert PayoutModeLocked();

        uint256 contributed = contributions[bountyId][token][msg.sender];
        if (amount == 0 || amount > contributed) revert InvalidAmount();
        if (amount > escrowed[bountyId][token]) revert InvalidAmount();

        contributions[bountyId][token][msg.sender] = contributed - amount;
        _payout(bountyId, token, recipient, amount);
    }

    // -------- Internal helpers --------

    function _requireDaoEscalated(bytes32 bountyId) internal view {
        if (dao == address(0) || msg.sender != dao) revert Unauthorized();
        Bounty storage b = bounties[bountyId];
        if (b.createdAt == 0) revert BountyNotFound();
        if (block.timestamp < uint256(b.createdAt) + uint256(daoDelaySeconds)) revert DaoNotAvailable();
    }

    function _payout(bytes32 bountyId, address token, address payable recipient, uint256 amount) internal {
        escrowed[bountyId][token] -= amount;
        totalPaid[bountyId][token] += amount;

        if (token == NATIVE_TOKEN) {
            (bool ok, ) = recipient.call{value: amount}("");
            require(ok, "ETH_TRANSFER_FAILED");
        } else {
            bool ok = IERC20(token).transfer(recipient, amount);
            require(ok, "TOKEN_TRANSFER_FAILED");
        }

        emit PaidOut(bountyId, token, recipient, amount);
    }

    function _refund(bytes32 bountyId, address token, address payable funder, uint256 amount) internal {
        uint256 contributed = contributions[bountyId][token][funder];
        if (amount == 0 || amount > contributed) revert InvalidAmount();
        if (amount > escrowed[bountyId][token]) revert InvalidAmount();

        contributions[bountyId][token][funder] = contributed - amount;
        escrowed[bountyId][token] -= amount;

        if (token == NATIVE_TOKEN) {
            (bool ok, ) = funder.call{value: amount}("");
            require(ok, "ETH_TRANSFER_FAILED");
        } else {
            bool ok = IERC20(token).transfer(funder, amount);
            require(ok, "TOKEN_TRANSFER_FAILED");
        }

        emit Refunded(bountyId, token, funder, amount);
    }

    function _verifyAuth(
        bytes32 typeHash,
        bytes32 bountyId,
        address token,
        address party,
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature,
        address expectedSigner
    ) internal view {
        if (block.timestamp > deadline) revert SignatureExpired();
        if (expectedSigner == address(0)) revert Unauthorized();

        if (typeHash == PAYOUT_TYPEHASH) {
            if (nonce != payoutNonces[bountyId]) revert InvalidNonce();
        } else if (typeHash == REFUND_TYPEHASH) {
            if (nonce != refundNonces[bountyId]) revert InvalidNonce();
        } else {
            revert InvalidSignature();
        }

        bytes32 structHash = keccak256(abi.encode(typeHash, bountyId, token, party, amount, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        address recovered = _recoverSigner(digest, signature);
        if (recovered != expectedSigner) revert InvalidSignature();
    }

    function _verifyClaimAuth(
        bytes32 bountyId,
        address claimer,
        bytes32 claimHash,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature,
        address expectedSigner
    ) internal view {
        if (block.timestamp > deadline) revert SignatureExpired();
        if (expectedSigner == address(0)) revert Unauthorized();
        if (nonce != claimNonces[bountyId][claimer]) revert InvalidNonce();

        bytes32 structHash = keccak256(abi.encode(CLAIM_TYPEHASH, bountyId, claimer, claimHash, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        address recovered = _recoverSigner(digest, signature);
        if (recovered != expectedSigner) revert InvalidSignature();
    }

    function _recoverSigner(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) revert InvalidSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        // EIP-2: enforce low-s
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) revert InvalidSignature();
        if (v != 27 && v != 28) revert InvalidSignature();
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
        return signer;
    }

    // -------- Timeout withdrawal --------

    /// @notice Funder can withdraw their full remaining contribution after their lock expires,
    ///         only if no payout has occurred for the bounty.
    function withdrawAfterTimeout(bytes32 bountyId, address token) external {
        Bounty storage b = bounties[bountyId];
        if (b.createdAt == 0) revert BountyNotFound();
        if (anyPayoutOccurred[bountyId]) revert RefundNotAvailable();

        uint64 until = lockedUntil[bountyId][token][msg.sender];
        if (block.timestamp < until) revert RefundNotAvailable();

        uint256 amt = contributions[bountyId][token][msg.sender];
        if (amt == 0) revert NothingToRefund();
        if (amt > escrowed[bountyId][token]) revert InvalidAmount();

        contributions[bountyId][token][msg.sender] = 0;
        escrowed[bountyId][token] -= amt;

        if (token == NATIVE_TOKEN) {
            (bool ok, ) = payable(msg.sender).call{value: amt}("");
            require(ok, "ETH_TRANSFER_FAILED");
        } else {
            bool ok = IERC20(token).transfer(msg.sender, amt);
            require(ok, "TOKEN_TRANSFER_FAILED");
        }

        emit Refunded(bountyId, token, msg.sender, amt);
    }

    // -------- Convenience views --------

    function getTotals(bytes32 bountyId, address token) external view returns (uint256 _escrowed, uint256 _funded, uint256 _paid) {
        return (escrowed[bountyId][token], totalFunded[bountyId][token], totalPaid[bountyId][token]);
    }

    function getContribution(bytes32 bountyId, address token, address funder) external view returns (uint256 amount, uint64 _lockedUntil) {
        return (contributions[bountyId][token][funder], lockedUntil[bountyId][token][funder]);
    }
}
