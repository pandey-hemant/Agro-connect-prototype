/**
 * utils/publicId.js — generators for human-readable IDs.
 *
 * Mirrors the Python backend's format:
 *   CL-<12 hex uppercase>   crop lots
 *   OFFER-<12 hex uppercase>
 *   DEAL-<12 hex uppercase>
 *   B-<6 digit zero-padded>  buyers
 *   FPO-<8 hex uppercase>    FPOs
 *   Q-<12 hex uppercase>     quality assessments
 *   DEMAND-<12 hex uppercase>
 *   ISS-<12 hex uppercase>   issues/disputes (Feature I)
 */
'use strict';

const crypto = require('crypto');

const hex = (n) =>
  crypto
    .randomBytes(Math.ceil(n / 2))
    .toString('hex')
    .slice(0, n)
    .toUpperCase();

const numPad = (n) =>
  // n in 1..1e8  ->  zero-padded 6 chars
  String(Math.floor(Math.random() * Math.pow(10, n))).padStart(n, '0');

const CropLotId = () => `CL-${hex(12)}`;
const OfferId = () => `OFFER-${hex(12)}`;
const DealId = () => `DEAL-${hex(12)}`;
const BuyerId = () => `B-${numPad(6)}`;
const FPOId = () => `FPO-${hex(8)}`;
const QualityId = () => `Q-${hex(12)}`;
const DemandId = () => `DEMAND-${hex(12)}`;
const IssueId = () => `ISS-${hex(12)}`;
// DealVerification records (Feature B) get a DV-... publicId. The
// prefix is descriptive so log lines and API responses can tell
// verifications apart from deals and offers at a glance.
const VerificationId = () => `DV-${hex(12)}`;

module.exports = {
  CropLotId,
  OfferId,
  DealId,
  BuyerId,
  FPOId,
  QualityId,
  DemandId,
  IssueId,
  VerificationId,
};
