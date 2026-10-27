'use strict';
/**
 * Derived stock status — never stored. Mirrors docs/DATA_MODEL.md exactly:
 *   variant.preorder            → "preorder"
 *   stock == 0                  → "soldout" ("restocking" when product.restockDate is set)
 *   stock <= lowStockThreshold  → "low"
 *   else                        → "instock"
 */

function lowThreshold(settings) {
  const n = Number(settings?.inventory?.lowStockThreshold);
  return Number.isFinite(n) ? n : 5;
}

function stockStatus(variant, product, settings) {
  if (variant && variant.preorder) return 'preorder';
  const stock = Number(variant?.stock) || 0;
  if (stock <= 0) return product && product.restockDate ? 'restocking' : 'soldout';
  if (stock <= lowThreshold(settings)) return 'low';
  return 'instock';
}

/** Product-level summary: best availability across variants. */
function productAvailability(product, settings) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  if (!variants.length) return product && product.restockDate ? 'restocking' : 'soldout';
  const statuses = variants.map((v) => stockStatus(v, product, settings));
  for (const s of ['instock', 'low', 'preorder', 'restocking', 'soldout']) if (statuses.includes(s)) return s;
  return 'soldout';
}

function totalStock(product) {
  return (product?.variants || []).reduce((n, v) => n + (Number(v.stock) || 0), 0);
}

module.exports = { stockStatus, productAvailability, totalStock, lowThreshold };
