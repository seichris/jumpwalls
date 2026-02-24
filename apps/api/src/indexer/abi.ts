import { parseAbi } from "viem";

export const ghBountiesAbi = parseAbi([
  "event RepoRegistered(bytes32 indexed repoHash, address indexed maintainer)",
  "event RepoMaintainerChanged(bytes32 indexed repoHash, address indexed oldMaintainer, address indexed newMaintainer)",
  "event BountyCreated(bytes32 indexed bountyId, bytes32 indexed repoHash, uint256 indexed issueNumber, string metadataURI)",
  "event BountyFunded(bytes32 indexed bountyId, address indexed token, address indexed funder, uint256 amount, uint64 lockedUntil)",
  "event ClaimSubmitted(bytes32 indexed bountyId, uint256 indexed claimId, address indexed claimer, string metadataURI)",
  "event StatusChanged(bytes32 indexed bountyId, uint8 status)",
  "event PaidOut(bytes32 indexed bountyId, address indexed token, address indexed recipient, uint256 amount)",
  "event Refunded(bytes32 indexed bountyId, address indexed token, address indexed funder, uint256 amount)"
]);

export const infoFiAbi = parseAbi([
  "event RequestPosted(bytes32 indexed requestId, address indexed requester, address indexed paymentToken, uint256 maxAmount, string sourceURI, string question)",
  "event OfferPosted(bytes32 indexed offerId, bytes32 indexed requestId, address indexed consultant, uint256 amount, uint64 etaSeconds, string proofType)",
  "event OfferHired(bytes32 indexed jobId, bytes32 indexed requestId, bytes32 indexed offerId, address requester, address consultant, address token, uint256 amount)",
  "event RequestMaxAmountUpdated(bytes32 indexed requestId, uint256 oldMaxAmount, uint256 newMaxAmount)",
  "event DigestDelivered(bytes32 indexed jobId, address indexed consultant, bytes32 digestHash, string metadataURI, string proofTypeOrURI)",
  "event PaidOut(bytes32 indexed jobId, address indexed token, address indexed recipient, uint256 amount)",
  "event Refunded(bytes32 indexed jobId, address indexed token, address indexed funder, uint256 amount)",
  "event Rated(bytes32 indexed jobId, address indexed rater, address indexed rated, uint8 stars, string uri)"
]);
