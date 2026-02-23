// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Like {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title InfoFi
/// @notice On-chain request/offer/hire/deliver/rate marketplace with requester-authorized settlement.
contract InfoFi {
    enum RequestStatus {
        OPEN,
        HIRED,
        CLOSED
    }

    enum OfferStatus {
        OPEN,
        HIRED,
        CANCELLED
    }

    struct Request {
        address requester;
        address paymentToken; // address(0) = ETH
        uint256 maxAmount;
        uint64 createdAt;
        RequestStatus status;
        bytes32 hiredOfferId;
        string sourceURI;
        string question;
    }

    struct Offer {
        bytes32 requestId;
        address consultant;
        uint256 amount;
        uint64 etaSeconds;
        uint64 createdAt;
        OfferStatus status;
        string proofType;
    }

    struct Job {
        bytes32 requestId;
        bytes32 offerId;
        address requester;
        address consultant;
        address paymentToken;
        uint256 amount;
        uint256 remainingAmount;
        uint64 hiredAt;
        uint64 deliveredAt;
        bytes32 digestHash;
        string metadataURI;
        string proofTypeOrURI;
    }

    address public constant NATIVE_TOKEN = address(0);

    // ---- EIP-712 requester authorization ----
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256(bytes("InfoFi"));
    bytes32 private constant VERSION_HASH = keccak256(bytes("1"));
    bytes32 private constant PAYOUT_TYPEHASH =
        keccak256("Payout(bytes32 jobId,address token,address recipient,uint256 amount,uint256 nonce,uint256 deadline)");
    bytes32 private constant REFUND_TYPEHASH =
        keccak256("Refund(bytes32 jobId,address token,address funder,uint256 amount,uint256 nonce,uint256 deadline)");

    bytes32 public immutable DOMAIN_SEPARATOR;

    error AlreadyExists();
    error NotFound();
    error InvalidState();
    error InvalidAmount();
    error InvalidInput();
    error Unauthorized();
    error InvalidToken();
    error InvalidNonce();
    error SignatureExpired();
    error InvalidSignature();
    error AlreadyRated();

    event RequestPosted(
        bytes32 indexed requestId,
        address indexed requester,
        address indexed paymentToken,
        uint256 maxAmount,
        string sourceURI,
        string question
    );
    event OfferPosted(
        bytes32 indexed offerId,
        bytes32 indexed requestId,
        address indexed consultant,
        uint256 amount,
        uint64 etaSeconds,
        string proofType
    );
    event OfferHired(
        bytes32 indexed jobId,
        bytes32 indexed requestId,
        bytes32 indexed offerId,
        address requester,
        address consultant,
        address token,
        uint256 amount
    );
    event DigestDelivered(
        bytes32 indexed jobId,
        address indexed consultant,
        bytes32 digestHash,
        string metadataURI,
        string proofTypeOrURI
    );
    event PaidOut(bytes32 indexed jobId, address indexed token, address indexed recipient, uint256 amount);
    event Refunded(bytes32 indexed jobId, address indexed token, address indexed funder, uint256 amount);
    event Rated(bytes32 indexed jobId, address indexed rater, address indexed rated, uint8 stars, string uri);

    mapping(bytes32 requestId => Request request) public requests;
    mapping(bytes32 offerId => Offer offer) public offers;
    mapping(bytes32 jobId => Job job) public jobs;

    mapping(bytes32 jobId => uint256 nonce) public payoutNonces;
    mapping(bytes32 jobId => uint256 nonce) public refundNonces;
    mapping(bytes32 jobId => mapping(address rater => bool)) public hasRated;

    constructor() {
        uint256 chainId;
        assembly {
            chainId := chainid()
        }
        DOMAIN_SEPARATOR = keccak256(abi.encode(EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, chainId, address(this)));
    }

    function computeRequestId(
        address requester,
        string calldata sourceURI,
        string calldata question,
        bytes32 salt
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(requester, keccak256(bytes(sourceURI)), keccak256(bytes(question)), salt));
    }

    function computeOfferId(
        bytes32 requestId,
        address consultant,
        uint256 amount,
        uint64 etaSeconds,
        bytes32 salt
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(requestId, consultant, amount, etaSeconds, salt));
    }

    function computeJobId(bytes32 offerId, address requester) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(offerId, requester));
    }

    function postRequest(
        string calldata sourceURI,
        string calldata question,
        address paymentToken,
        uint256 maxAmount,
        bytes32 salt
    ) external returns (bytes32 requestId) {
        if (bytes(sourceURI).length == 0) revert InvalidInput();
        if (maxAmount == 0) revert InvalidAmount();
        requestId = computeRequestId(msg.sender, sourceURI, question, salt);
        if (requests[requestId].createdAt != 0) revert AlreadyExists();

        requests[requestId] = Request({
            requester: msg.sender,
            paymentToken: paymentToken,
            maxAmount: maxAmount,
            createdAt: uint64(block.timestamp),
            status: RequestStatus.OPEN,
            hiredOfferId: bytes32(0),
            sourceURI: sourceURI,
            question: question
        });

        emit RequestPosted(requestId, msg.sender, paymentToken, maxAmount, sourceURI, question);
    }

    function postOffer(
        bytes32 requestId,
        uint256 amount,
        uint64 etaSeconds,
        string calldata proofType,
        bytes32 salt
    ) external returns (bytes32 offerId) {
        Request storage req = requests[requestId];
        if (req.createdAt == 0) revert NotFound();
        if (req.status != RequestStatus.OPEN) revert InvalidState();
        if (amount == 0 || amount > req.maxAmount) revert InvalidAmount();

        offerId = computeOfferId(requestId, msg.sender, amount, etaSeconds, salt);
        if (offers[offerId].createdAt != 0) revert AlreadyExists();

        offers[offerId] = Offer({
            requestId: requestId,
            consultant: msg.sender,
            amount: amount,
            etaSeconds: etaSeconds,
            createdAt: uint64(block.timestamp),
            status: OfferStatus.OPEN,
            proofType: proofType
        });

        emit OfferPosted(offerId, requestId, msg.sender, amount, etaSeconds, proofType);
    }

    function hireOffer(bytes32 offerId) external payable returns (bytes32 jobId) {
        Offer storage offer = offers[offerId];
        if (offer.createdAt == 0) revert NotFound();
        if (offer.status != OfferStatus.OPEN) revert InvalidState();

        Request storage req = requests[offer.requestId];
        if (req.createdAt == 0) revert NotFound();
        if (req.status != RequestStatus.OPEN) revert InvalidState();
        if (msg.sender != req.requester) revert Unauthorized();
        if (offer.amount == 0 || offer.amount > req.maxAmount) revert InvalidAmount();

        address token = req.paymentToken;
        if (token == NATIVE_TOKEN) {
            if (msg.value != offer.amount) revert InvalidAmount();
        } else {
            if (msg.value != 0) revert InvalidAmount();
            _safeTransferFrom(token, msg.sender, address(this), offer.amount);
        }

        jobId = computeJobId(offerId, req.requester);
        if (jobs[jobId].hiredAt != 0) revert AlreadyExists();
        jobs[jobId] = Job({
            requestId: offer.requestId,
            offerId: offerId,
            requester: req.requester,
            consultant: offer.consultant,
            paymentToken: token,
            amount: offer.amount,
            remainingAmount: offer.amount,
            hiredAt: uint64(block.timestamp),
            deliveredAt: 0,
            digestHash: bytes32(0),
            metadataURI: "",
            proofTypeOrURI: ""
        });

        req.status = RequestStatus.HIRED;
        req.hiredOfferId = offerId;
        offer.status = OfferStatus.HIRED;

        emit OfferHired(jobId, offer.requestId, offerId, req.requester, offer.consultant, token, offer.amount);
    }

    function deliverDigest(
        bytes32 jobId,
        bytes32 digestHash,
        string calldata metadataURI,
        string calldata proofTypeOrURI
    ) external {
        Job storage job = jobs[jobId];
        if (job.hiredAt == 0) revert NotFound();
        if (msg.sender != job.consultant) revert Unauthorized();
        if (job.deliveredAt != 0) revert InvalidState();
        if (digestHash == bytes32(0)) revert InvalidInput();

        job.deliveredAt = uint64(block.timestamp);
        job.digestHash = digestHash;
        job.metadataURI = metadataURI;
        job.proofTypeOrURI = proofTypeOrURI;

        emit DigestDelivered(jobId, msg.sender, digestHash, metadataURI, proofTypeOrURI);
    }

    function rateJob(bytes32 jobId, uint8 stars, string calldata uri) external {
        Job storage job = jobs[jobId];
        if (job.hiredAt == 0) revert NotFound();
        if (job.deliveredAt == 0) revert InvalidState();
        if (stars == 0 || stars > 5) revert InvalidInput();
        if (msg.sender != job.requester && msg.sender != job.consultant) revert Unauthorized();
        if (hasRated[jobId][msg.sender]) revert AlreadyRated();

        hasRated[jobId][msg.sender] = true;
        address rated = msg.sender == job.requester ? job.consultant : job.requester;
        emit Rated(jobId, msg.sender, rated, stars, uri);
    }

    function payoutWithAuthorization(
        bytes32 jobId,
        address token,
        address payable recipient,
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external {
        Job storage job = jobs[jobId];
        if (job.hiredAt == 0) revert NotFound();
        if (job.deliveredAt == 0) revert InvalidState();
        if (token != job.paymentToken) revert InvalidToken();
        if (amount == 0 || amount > job.remainingAmount) revert InvalidAmount();
        if (nonce != payoutNonces[jobId]) revert InvalidNonce();
        if (block.timestamp > deadline) revert SignatureExpired();

        _verifyAuth(PAYOUT_TYPEHASH, jobId, token, recipient, amount, nonce, deadline, signature, job.requester);
        payoutNonces[jobId] = nonce + 1;
        _applyPayout(jobId, job, token, recipient, amount);
    }

    function payoutByRequester(bytes32 jobId, address payable recipient, uint256 amount) external {
        Job storage job = jobs[jobId];
        if (job.hiredAt == 0) revert NotFound();
        if (msg.sender != job.requester) revert Unauthorized();
        if (job.deliveredAt == 0) revert InvalidState();
        _applyPayout(jobId, job, job.paymentToken, recipient, amount);
    }

    function refundByRequester(bytes32 jobId, address payable funder, uint256 amount) external {
        Job storage job = jobs[jobId];
        if (job.hiredAt == 0) revert NotFound();
        if (msg.sender != job.requester) revert Unauthorized();
        if (funder != job.requester) revert Unauthorized();
        _applyRefund(jobId, job, job.paymentToken, funder, amount);
    }

    function refundWithAuthorization(
        bytes32 jobId,
        address token,
        address payable funder,
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external {
        Job storage job = jobs[jobId];
        if (job.hiredAt == 0) revert NotFound();
        if (token != job.paymentToken) revert InvalidToken();
        if (funder != job.requester) revert Unauthorized();
        if (amount == 0 || amount > job.remainingAmount) revert InvalidAmount();
        if (nonce != refundNonces[jobId]) revert InvalidNonce();
        if (block.timestamp > deadline) revert SignatureExpired();

        _verifyAuth(REFUND_TYPEHASH, jobId, token, funder, amount, nonce, deadline, signature, job.requester);
        refundNonces[jobId] = nonce + 1;
        _applyRefund(jobId, job, token, funder, amount);
    }

    function _applyPayout(bytes32 jobId, Job storage job, address token, address payable recipient, uint256 amount) internal {
        if (token != job.paymentToken) revert InvalidToken();
        if (amount == 0 || amount > job.remainingAmount) revert InvalidAmount();
        job.remainingAmount -= amount;
        if (job.remainingAmount == 0) {
            requests[job.requestId].status = RequestStatus.CLOSED;
        }
        _safeTransfer(token, recipient, amount);
        emit PaidOut(jobId, token, recipient, amount);
    }

    function _applyRefund(bytes32 jobId, Job storage job, address token, address payable funder, uint256 amount) internal {
        if (token != job.paymentToken) revert InvalidToken();
        if (funder != job.requester) revert Unauthorized();
        if (amount == 0 || amount > job.remainingAmount) revert InvalidAmount();
        job.remainingAmount -= amount;
        if (job.remainingAmount == 0) {
            requests[job.requestId].status = RequestStatus.CLOSED;
        }
        _safeTransfer(token, funder, amount);
        emit Refunded(jobId, token, funder, amount);
    }

    function _verifyAuth(
        bytes32 typeHash,
        bytes32 jobId,
        address token,
        address party,
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature,
        address expectedSigner
    ) internal view {
        if (expectedSigner == address(0)) revert Unauthorized();
        bytes32 structHash = keccak256(abi.encode(typeHash, jobId, token, party, amount, nonce, deadline));
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

        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) revert InvalidSignature();
        if (v != 27 && v != 28) revert InvalidSignature();

        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
        return signer;
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        if (token == NATIVE_TOKEN) {
            (bool sent, ) = payable(to).call{value: amount}("");
            require(sent, "ETH_TRANSFER_FAILED");
            return;
        }

        (bool tokenOk, bytes memory data) = token.call(abi.encodeWithSelector(IERC20Like.transfer.selector, to, amount));
        require(tokenOk && (data.length == 0 || abi.decode(data, (bool))), "TOKEN_TRANSFER_FAILED");
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20Like.transferFrom.selector, from, to, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "TOKEN_TRANSFER_FROM_FAILED");
    }
}
