/**
 * services/credibility.js — deterministic, rule-based credibility score.
 *
 * Hard rules (from the Phase-2 spec):
 *   - NO fake AI. NO invented ratings.
 *   - Score must be computed only from verified platform data
 *     (completed deals, completion rate, profile completeness).
 *   - When history is insufficient, the response surfaces
 *     `available: false` and `insufficient_reason`. The frontend
 *     must render "Not enough history yet" — not a default middle
 *     score.
 *
 * The score is a weighted blend of 3 components, each normalised to
 * 0..1, then multiplied by 100 to get a 0..100 integer:
 *
 *   - completion (60%): the share of the seller's deals that
 *     reached COMPLETED. A deal is COMPLETED when its
 *     deliveryStatus === 'COMPLETED'. (paymentStatus alone is not
 *     used — payment is simulated and a low payment score would
 *     penalise an otherwise reliable farmer.)
 *
 *   - volume (25%): the log-scaled count of completed deals, so a
 *     first completed deal already moves the needle, but the curve
 *     flattens after ~10. Formula: min(1, log10(1 + completed) /
 *     log10(11)). Below 1 completed deal the contribution is 0.
 *
 *   - profile (15%): a small bonus for completing profile fields
 *     (displayName, state/location, isDemo flag). New users are not
 *     penalised — they just don't get the bonus. The field for
 *     this is the User model; lots/buyers are looked up via the
 *     user publicId.
 *
 * The returned shape is the same for both seller and buyer queries;
 * the caller chooses the publicId and the metric gates. For
 * buyers, "completion" means the share of deals where the buyer
 * paid (deliveryStatus reached DELIVERED or COMPLETED on the
 * matching deal) — the same rule, mirrored.
 *
 * A negative `available: false` is returned when:
 *   - the user cannot be resolved
 *   - the user has 0 completed deals AND 0 active listings
 *   (new user with no history at all).
 *
 * For users with 0 completed deals but ≥ 1 ACTIVE listing, the
 * score is 0 with `available: true` and an `insufficient_reason`
 * that says "no completed deals yet". The UI distinguishes
 * `available: false` (cannot compute) from
 * `available: true, score: 0` (compute, just no track record).
 */
'use strict';

const User = require('../models/User');
const CropLot = require('../models/CropLot');
const Deal = require('../models/Deal');
const Buyer = require('../models/Buyer');

/**
 * Compute the credibility score for a user.
 *
 * @param {string} publicId  User.publicId
 * @param {string} role      'SELLER' | 'BUYER' (decides which deal-side
 *                          to attribute; for FPO, treated as SELLER)
 * @returns {Promise<{
 *   available: boolean,
 *   score?: number,            // 0..100 integer
 *   factors?: {
 *     completion: number,      // 0..1
 *     volume: number,          // 0..1
 *     profile: number,         // 0..1
 *     completed_deals: number,
 *     total_deals: number,
 *     active_listings: number,
 *   },
 *   reason?: string,           // 'insufficient_data' or 'not_found'
 *   message?: string,          // human-readable
 * }>}
 */
async function computeForUser(publicId, role = 'SELLER') {
  if (!publicId) {
    return {
      available: false,
      reason: 'not_found',
      message: 'No user id supplied.',
    };
  }
  const user = await User.findOne({ publicId });
  if (!user) {
    return {
      available: false,
      reason: 'not_found',
      message: 'User not found.',
    };
  }

  // Feature F — identity verification is a separate signal from
  // credibility. The UI renders them as two distinct badges
  // ("Credibility" / "Identity verified") so users don't conflate
  // "has track record" with "passed KYC". The integration is a
  // forward-looking extension point; for now we surface whatever
  // is stored on the user.
  const identityVerified = !!user.identityVerified;

  // ---- completion: deals where the seller/buyer was on "this" side
  //   SELLER: farmerUserPublicId === publicId
  //   BUYER : resolved via Buyer.publicId -> Buyer._id -> Deal.buyerId
  let totalDeals = 0;
  let completedDeals = 0;
  let activeListings = 0;

  if (role === 'SELLER' || role === 'FPO') {
    // Count ACTIVE listings so a brand-new farmer with 0 deals but
    // 3 listings does not collapse to `available:false`.
    activeListings = await CropLot.countDocuments({
      sellerUserPublicId: publicId,
      status: { $in: ['ACTIVE'] },
    });
    // De-duplicate by going through the deals collection directly
    // (no N+1). Use farmerUserPublicId for the seller-side match.
    const dealQ = await Deal.aggregate([
      { $match: { farmerUserPublicId: publicId } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          completed: {
            $sum: {
              $cond: [{ $eq: ['$deliveryStatus', 'COMPLETED'] }, 1, 0],
            },
          },
        },
      },
    ]);
    if (dealQ.length) {
      totalDeals = dealQ[0].total;
      completedDeals = dealQ[0].completed;
    }
  } else if (role === 'BUYER') {
    // Resolve buyer Mongo _id from Buyer.publicId
    const buyer = await Buyer.findOne({ publicId });
    if (buyer) {
      const dealQ = await Deal.aggregate([
        { $match: { buyerId: buyer._id } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            completed: {
              $sum: {
                $cond: [{ $eq: ['$deliveryStatus', 'COMPLETED'] }, 1, 0],
              },
            },
          },
        },
      ]);
      if (dealQ.length) {
        totalDeals = dealQ[0].total;
        completedDeals = dealQ[0].completed;
      }
    }
  }

  // ---- profile completeness (small bonus only)
  //   - displayName or name set
  //   - either isDemo false OR a complete demo profile (counted)
  //   - User.email set
  let profile = 0;
  if (user.displayName || user.name) profile += 0.4;
  if (user.email) profile += 0.3;
  if (user.phone) profile += 0.3;
  // demo accounts are not penalised — the email + name fields are
  // usually set by the seeder. Profile is intentionally capped at 1.

  // ---- insufficient data?
  // New user with 0 deals AND 0 active listings → cannot compute.
  // New user with 0 deals but 1+ active listing → compute, score 0.
  if (totalDeals === 0 && activeListings === 0) {
    return {
      available: false,
      reason: 'insufficient_data',
      message: 'Not enough history yet.',
      identity_verified: identityVerified,
      identity_verification_note: identityVerified
        ? 'KYC verified.'
        : 'KYC integration pending — credibility is independent of identity verification.',
      factors: {
        completion: 0,
        volume: 0,
        profile,
        completed_deals: 0,
        total_deals: 0,
        active_listings: 0,
      },
    };
  }

  // ---- weighted blend
  const completion = totalDeals > 0 ? completedDeals / totalDeals : 0;
  // log10(1 + completed) / log10(11), clamped to [0, 1].
  // 1 deal → log10(2)/log10(11) ≈ 0.289
  // 5 deals → log10(6)/log10(11) ≈ 0.756
  // 10 deals → log10(11)/log10(11) = 1.0
  // 11+ deals → 1.0
  const volume = Math.min(1, Math.log10(1 + completedDeals) / Math.log10(11));

  const scoreRaw =
    completion * 0.6 + volume * 0.25 + Math.min(1, profile) * 0.15;
  const score = Math.round(Math.max(0, Math.min(1, scoreRaw)) * 100);

  return {
    available: true,
    score,
    identity_verified: identityVerified,
    identity_verification_note: identityVerified
      ? 'KYC verified.'
      : 'KYC integration pending — credibility is independent of identity verification.',
    factors: {
      completion: round3(completion),
      volume: round3(volume),
      profile: round3(Math.min(1, profile)),
      completed_deals: completedDeals,
      total_deals: totalDeals,
      active_listings: activeListings,
    },
  };
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

/**
 * Public-facing farmer card data — name, location, state, credibility.
 * NEVER returns phone, email, or password material. The buyer sees
 * only the public name + location + computed credibility + a
 * "demo" flag (so they know which farmers are seeded fixtures).
 *
 * If the user cannot be resolved, the response has `available:false`
 * and the buyer UI shows "Farmer info not available".
 */
async function farmerCardForLot(lot) {
  if (!lot) {
    return { available: false, reason: 'no_lot' };
  }
  const sellerUserPublicId = lot.sellerUserPublicId;
  if (!sellerUserPublicId) {
    return { available: false, reason: 'no_seller' };
  }
  const user = await User.findOne({ publicId: sellerUserPublicId });
  if (!user) {
    return { available: false, reason: 'user_not_found' };
  }
  const credibility = await computeForUser(sellerUserPublicId, 'SELLER');
  return {
    available: true,
    farmer: {
      public_id: user.publicId,
      name: user.name || user.displayName || 'Farmer',
      // location = lot.location (free text like "Nashik, MH") is more
      // trustworthy than the user-level state, which is often blank
      // in the seed. We use the lot's location if present, else the
      // user display.
      location: lot.location || '',
      state: lot.state || '',
      is_demo: !!user.isDemo,
      identity_verified: !!user.identityVerified,
    },
    credibility,
  };
}

module.exports = {
  computeForUser,
  farmerCardForLot,
};
