export type InfoFiRequest = {
  id: string;
  requestId: string;
  requester: string;
  paymentToken: string;
  maxAmountWei: string;
  sourceURI: string;
  question: string;
  status: string;
  hiredOfferId: string | null;
  chainId: number;
  contractAddress: string;
  createdAt: string;
  updatedAt: string;
};

export type InfoFiOffer = {
  id: string;
  offerId: string;
  requestId: string;
  consultant: string;
  amountWei: string;
  etaSeconds: number;
  proofType: string;
  status: string;
  chainId: number;
  contractAddress: string;
  createdAt: string;
  updatedAt: string;
};

export type InfoFiPayout = {
  id: string;
  jobId: string;
  token: string;
  recipient: string;
  amountWei: string;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  createdAt: string;
};

export type InfoFiRefund = {
  id: string;
  jobId: string;
  token: string;
  funder: string;
  amountWei: string;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  createdAt: string;
};

export type InfoFiRating = {
  id: string;
  jobId: string;
  rater: string;
  rated: string;
  stars: number;
  uri: string;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  createdAt: string;
};

export type InfoFiDigest = {
  id: string;
  jobId: string;
  sourceURI: string | null;
  question: string | null;
  digest: string;
  digestHash: string;
  metadataURI: string;
  consultantAddress: string;
  proof: string | null;
  citationsJson: string | null;
  fairUseVerdict: string | null;
  fairUseRiskLevel: string | null;
  fairUseScore: number | null;
  fairUsePolicyVersion: string | null;
  fairUseReportJson: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InfoFiReimbursementSuggestedPayout = {
  recipient: string;
  amountWei: string;
  reason: "x402_reimbursement" | "consultant_labor";
};

export type InfoFiReimbursementVerifiedCitation = {
  index: number;
  url: string;
  chainId: number;
  token: string;
  normalizedToken: string | null;
  amountWei: string;
  payTo: string;
  txHash: string;
  purchasedAt: string | null;
  payer: string;
  payerSource: "transfer_log" | "native_transfer" | "consultant_fallback";
  verificationNote: string | null;
};

export type InfoFiReimbursementUnverifiedCitation = {
  index: number;
  reason: string;
  citation: {
    type: "x402";
    url: string | null;
    chainId: number | null;
    token: string | null;
    amountWei: string | null;
    payTo: string | null;
    txHash: string | null;
  };
};

export type InfoFiReimbursementPreview = {
  jobId: string;
  chainId: number;
  paymentToken: string;
  remainingWei: string;
  reimbursementTotalWei: string;
  canAutoSettle: boolean;
  suggestedPayouts: InfoFiReimbursementSuggestedPayout[];
  verifiedCitations: InfoFiReimbursementVerifiedCitation[];
  unverifiedCitations: InfoFiReimbursementUnverifiedCitation[];
  totalsByPayer: Array<{ payer: string; amountWei: string }>;
  totalsByPayTo: Array<{ payTo: string; amountWei: string }>;
  notes: string[];
};

export type InfoFiJobBase = {
  id: string;
  jobId: string;
  requestId: string;
  offerId: string;
  requester: string;
  consultant: string;
  paymentToken: string;
  amountWei: string;
  remainingWei: string;
  digestHash: string | null;
  metadataURI: string | null;
  proofTypeOrURI: string | null;
  hiredAt: string;
  deliveredAt: string | null;
  chainId: number;
  contractAddress: string;
  createdAt: string;
  updatedAt: string;
};

export type InfoFiJob = InfoFiJobBase & {
  status: string;
};

export type InfoFiJobWithDetails = InfoFiJob & {
  payouts: InfoFiPayout[];
  refunds: InfoFiRefund[];
  ratings: InfoFiRating[];
  digest: InfoFiDigest | null;
};

export type InfoFiRequestWithDetails = InfoFiRequest & {
  offers: InfoFiOffer[];
  job: InfoFiJobBase | null;
};
