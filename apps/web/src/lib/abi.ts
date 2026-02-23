import { parseAbi } from "viem";

export const infoFiAbi = parseAbi([
  "function computeRequestId(address requester, string sourceURI, string question, bytes32 salt) pure returns (bytes32)",
  "function computeOfferId(bytes32 requestId, address consultant, uint256 amount, uint64 etaSeconds, bytes32 salt) pure returns (bytes32)",
  "function computeJobId(bytes32 offerId, address requester) pure returns (bytes32)",
  "function requests(bytes32 requestId) view returns (address requester, address paymentToken, uint256 maxAmount, uint64 createdAt, uint8 status, bytes32 hiredOfferId, string sourceURI, string question)",
  "function offers(bytes32 offerId) view returns (bytes32 requestId, address consultant, uint256 amount, uint64 etaSeconds, uint64 createdAt, uint8 status, string proofType)",
  "function jobs(bytes32 jobId) view returns (bytes32 requestId, bytes32 offerId, address requester, address consultant, address paymentToken, uint256 amount, uint256 remainingAmount, uint64 hiredAt, uint64 deliveredAt, bytes32 digestHash, string metadataURI, string proofTypeOrURI)",
  "function payoutNonces(bytes32 jobId) view returns (uint256)",
  "function refundNonces(bytes32 jobId) view returns (uint256)",
  "function postRequest(string sourceURI, string question, address paymentToken, uint256 maxAmount, bytes32 salt) returns (bytes32)",
  "function postOffer(bytes32 requestId, uint256 amount, uint64 etaSeconds, string proofType, bytes32 salt) returns (bytes32)",
  "function hireOffer(bytes32 offerId) payable returns (bytes32)",
  "function deliverDigest(bytes32 jobId, bytes32 digestHash, string metadataURI, string proofTypeOrURI)",
  "function payoutByRequester(bytes32 jobId, address recipient, uint256 amount)",
  "function refundByRequester(bytes32 jobId, address funder, uint256 amount)",
  "function payoutWithAuthorization(bytes32 jobId, address token, address recipient, uint256 amount, uint256 nonce, uint256 deadline, bytes signature)",
  "function refundWithAuthorization(bytes32 jobId, address token, address funder, uint256 amount, uint256 nonce, uint256 deadline, bytes signature)",
  "function rateJob(bytes32 jobId, uint8 stars, string uri)",

  "event RequestPosted(bytes32 indexed requestId, address indexed requester, address indexed paymentToken, uint256 maxAmount, string sourceURI, string question)",
  "event OfferPosted(bytes32 indexed offerId, bytes32 indexed requestId, address indexed consultant, uint256 amount, uint64 etaSeconds, string proofType)",
  "event OfferHired(bytes32 indexed jobId, bytes32 indexed requestId, bytes32 indexed offerId, address requester, address consultant, address token, uint256 amount)",
  "event DigestDelivered(bytes32 indexed jobId, address indexed consultant, bytes32 digestHash, string metadataURI, string proofTypeOrURI)",
  "event PaidOut(bytes32 indexed jobId, address indexed token, address indexed recipient, uint256 amount)",
  "event Refunded(bytes32 indexed jobId, address indexed token, address indexed funder, uint256 amount)",
  "event Rated(bytes32 indexed jobId, address indexed rater, address indexed rated, uint8 stars, string uri)"
]);

export const erc20Abi = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)"
]);

export const gatewayWalletAbi = parseAbi([
  "function deposit(address token, uint256 value)"
]);
