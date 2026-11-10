const Offer = require('../../models/offer');
const { OFFER_TYPE } = require('../../constants/offerConstants');

const idOf = (value) => (value ? String(value._id || value) : null);

const liveOfferFilter = (now = new Date()) => ({
  deletedAt: null,
  isActive: true,
  $and: [
    { $or: [{ startDate: null }, { startDate: { $lte: now } }] },
    { expiryDate: { $gte: now } },
  ],
});

const pickBest = (productOffer, categoryOffer) => {
  if (!productOffer) return categoryOffer || null;
  if (!categoryOffer) return productOffer;
  return categoryOffer.discountPercent > productOffer.discountPercent ? categoryOffer : productOffer;
};

const toOfferView = (offer) =>
  offer
    ? {
        id: String(offer._id),
        name: offer.offerName,
        source: offer.offerType,
        discountPercent: offer.discountPercent,
        expiryDate: offer.expiryDate,
      }
    : null;

const getOfferMap = async (entries, now = new Date()) => {
  const result = new Map();
  const productIds = [...new Set(entries.map((e) => idOf(e.productId)).filter(Boolean))];
  const categoryIds = [...new Set(entries.map((e) => idOf(e.categoryId)).filter(Boolean))];
  if (productIds.length === 0) return result;

  const offers = await Offer.find({
    ...liveOfferFilter(now),
    $or: [
      { offerType: OFFER_TYPE.PRODUCT, productId: { $in: productIds } },
      { offerType: OFFER_TYPE.CATEGORY, categoryId: { $in: categoryIds } },
    ],
  }).lean();

  const byProduct = new Map();
  const byCategory = new Map();
  for (const offer of offers) {
    const bucket = offer.offerType === OFFER_TYPE.PRODUCT ? byProduct : byCategory;
    const key = idOf(offer.offerType === OFFER_TYPE.PRODUCT ? offer.productId : offer.categoryId);
    const current = bucket.get(key);
    if (!current || offer.discountPercent > current.discountPercent) bucket.set(key, offer);
  }

  for (const entry of entries) {
    const pid = idOf(entry.productId);
    if (!pid) continue;
    result.set(pid, pickBest(byProduct.get(pid), byCategory.get(idOf(entry.categoryId))));
  }
  return result;
};

const resolveDiscount = (offer, legacyPercent = 0) => {
  const legacy = Math.min(Math.max(Number(legacyPercent) || 0, 0), 100);
  const fromOffer = offer ? offer.discountPercent : 0;
  return {
    discountPercent: Math.max(fromOffer, legacy),
    offer: offer && fromOffer >= legacy ? toOfferView(offer) : null,
  };
};

module.exports = { liveOfferFilter, pickBest, toOfferView, getOfferMap, resolveDiscount };
