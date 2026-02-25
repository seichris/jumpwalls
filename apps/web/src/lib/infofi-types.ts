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
