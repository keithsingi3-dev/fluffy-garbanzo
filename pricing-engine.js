/**
 * Boma Mabati Factory Ltd — Pricing Engine
 * ==========================================
 * A Node.js service that generates instant quotes for roofing materials.
 * Reads product catalog, applies volume discounts, calculates delivery fees,
 * and suggests upsells/bundles.
 *
 * Usage:
 *   const engine = require('./pricing-engine');
 *   const quote = engine.generateQuote({ productId: 'corrugated-28g', quantity: 20, location: 'Nairobi CBD', color: 'Red' });
 *
 * Output:
 *   {
 *     success: true,
 *     quote: { items: [...], subtotal, discount, deliveryFee, total, upsells: [...], bundles: [...] },
 *     formatted: { text: "..." }  // Ready for WhatsApp/SMS display
 *   }
 */

const fs = require('fs');
const path = require('path');

// ─── Load Product Catalog ───────────────────────────────────────────────────
let catalog;
try {
  catalog = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'product-catalog.json'), 'utf-8')
  );
} catch (err) {
  console.error('Failed to load product catalog:', err.message);
  catalog = { categories: [], upsell_paths: [], bundles: [], ai_agent_context: {} };
}

// ─── Build a flat product lookup map ────────────────────────────────────────
const productsMap = {};
const categoryMap = {};

for (const cat of catalog.categories) {
  categoryMap[cat.id] = cat;
  for (const product of cat.products) {
    productsMap[product.id] = {
      ...product,
      category_id: cat.id,
      category_name: cat.name,
    };
  }
}

// ─── Volume Discount Tiers (KES per sheet) ─────────────────────────────────
// Based on industry norms for roofing materials in Kenya
const VOLUME_DISCOUNT_TIERS = [
  { min: 1, max: 10, discount_percent: 0 },
  { min: 11, max: 50, discount_percent: 3 },
  { min: 51, max: 100, discount_percent: 5 },
  { min: 101, max: 200, discount_percent: 7 },
  { min: 201, max: Infinity, discount_percent: 10 },
];

// ─── Delivery Fee Zones (Nairobi area) ──────────────────────────────────────
const DELIVERY_ZONES = [
  {
    zone: 'Zone 1 — Nairobi CBD & Industrial Area',
    keywords: ['cbd', 'industrial area', 'city centre', 'town', 'nairobi cbd'],
    fee_kes: 1500,
  },
  {
    zone: 'Zone 2 — Nairobi Suburbs (within 15km)',
    keywords: [
      'westlands', 'kilimani', 'kilimambogo', 'lavington', 'kileleshwa',
      'parklands', 'highridge', 'hurligham', 'spring valley', 'karen',
      'langata', 'south b', 'south c', 'madaraka', 'ngong road',
      'adams', 'kawangware', 'dagoretti', 'uhuru gardens',
      'buruburu', 'donholm', 'embakasi', 'komarock', 'tassia',
      'fedha', 'pipeline', 'utawala', 'njiru', 'runda',
      'kasarani', 'roysambu', 'zimmerman', 'githurai',
      'mwiki', 'michuki', 'kayole', 'kangundo road',
      'juja road', 'thika road', 'limuru road', 'naivasha road',
    ],
    fee_kes: 2000,
  },
  {
    zone: 'Zone 3 — Nairobi Outskirts (15–30km)',
    keywords: [
      'ruiru', 'juja', 'kikuyu', 'ngong', 'ongata rongai',
      'kitengela', 'molongo', 'syokimau', 'athiriver', 'athi river',
      'mavoko', 'mlolongo', 'kiambu', 'thindigua', 'kabete',
      'githunguri', 'kinoo', 'karuri', 'ndumberi', 'tigoni',
    ],
    fee_kes: 3000,
  },
  {
    zone: 'Zone 4 — Greater Nairobi / Peri-urban (30km+)',
    keywords: [],
    fee_kes: 4500,
    note: 'Call for exact delivery cost — depends on distance.',
  },
];

// ─── Helper: Find delivery zone ─────────────────────────────────────────────
function findDeliveryZone(location) {
  if (!location) return DELIVERY_ZONES[DELIVERY_ZONES.length - 1]; // default to farthest

  const loc = location.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '');

  for (const zone of DELIVERY_ZONES) {
    for (const keyword of zone.keywords) {
      if (loc.includes(keyword)) return zone;
    }
  }

  // Default to Zone 3 (outskirts) for unknown locations
  return DELIVERY_ZONES[2];
}

// ─── Helper: Calculate volume discount ──────────────────────────────────────
function getVolumeDiscount(quantity, basePrice) {
  for (const tier of VOLUME_DISCOUNT_TIERS) {
    if (quantity >= tier.min && quantity <= tier.max) {
      return {
        tier: `Qty ${tier.min}–${tier.max === Infinity ? '200+' : tier.max}`,
        discount_percent: tier.discount_percent,
        savings_kes: Math.round(basePrice * quantity * (tier.discount_percent / 100)),
      };
    }
  }
  return { tier: 'None', discount_percent: 0, savings_kes: 0 };
}

// ─── Helper: Get upsell suggestions for a product ───────────────────────────
function getUpsellPaths(productId) {
  const paths = catalog.upsell_paths || [];
  return paths
    .filter(p => p.from === productId)
    .map(p => ({
      to_product_id: p.to,
      to_product_name: productsMap[p.to]?.name || p.to,
      extra_per_unit_kes: p.price_difference_kes,
      message: p.message,
    }));
}

// ─── Helper: Check if a bundle applies ───────────────────────────────────────
function findApplicableBundles(productId, quantity) {
  const bundles = catalog.bundles || [];
  return bundles
    .filter(b => {
      // Bundle applies if it contains the requested product
      const item = b.items.find(i => i.product_id === productId);
      return item && quantity >= item.quantity * 0.8; // 80% of bundle qty qualifies
    })
    .map(b => ({
      bundle_id: b.id,
      bundle_name: b.name,
      description: b.description,
      discount_percentage: b.discount_percentage,
      items: b.items,
      message: b.message,
    }));
}

// ─── Main: Generate Quote ───────────────────────────────────────────────────
function generateQuote(options) {
  const {
    productId,
    quantity = 1,
    location,
    color,
    items = [],         // For multi-item quotes
  } = options;

  // ── Single product quote ────────────────────────────────────────────────
  if (productId) {
    const product = productsMap[productId];
    if (!product) {
      return {
        success: false,
        error: `Product "${productId}" not found.`,
        quote: null,
      };
    }

    const qty = Math.max(1, Math.round(quantity));
    const unitPrice = product.base_price_kes || 0;
    const colorSurcharge = (color && product.color_options?.includes(color))
      ? (product.color_surcharge_kes || 0)
      : 0;

    const effectiveUnitPrice = unitPrice + colorSurcharge;
    const subtotal = effectiveUnitPrice * qty;
    const discount = getVolumeDiscount(qty, effectiveUnitPrice);
    const afterDiscount = subtotal - discount.savings_kes;

    const deliveryZone = findDeliveryZone(location);
    const deliveryFee = deliveryZone.fee_kes;

    const grandTotal = afterDiscount + deliveryFee;

    // Upsells
    const upsells = getUpsellPaths(productId);

    // Bundles
    const applicableBundles = findApplicableBundles(productId, qty);

    const quote = {
      items: [
        {
          product_id: productId,
          product_name: product.name,
          category_name: product.category_name,
          unit: product.unit,
          standard_size: product.standard_size || '',
          gauge: product.gauge || null,
          quantity: qty,
          unit_price_kes: unitPrice,
          color: color || null,
          color_surcharge_kes: colorSurcharge || 0,
          effective_unit_price_kes: effectiveUnitPrice,
          line_total_kes: subtotal,
        },
      ],
      subtotal_kes: subtotal,
      volume_discount: discount,
      after_discount_kes: afterDiscount,
      delivery: {
        location: location || 'Not specified',
        zone: deliveryZone.zone,
        fee_kes: deliveryFee,
        note: deliveryZone.note || '',
      },
      total_kes: grandTotal,
      upsells: upsells,
      bundles: applicableBundles,
      payment_methods: catalog.catalog?.payment || { primary: 'M-Pesa' },
    };

    return {
      success: true,
      quote,
      formatted: formatQuoteText(quote, options),
    };
  }

  // ── Multi-item quote ────────────────────────────────────────────────────
  if (items && items.length > 0) {
    return generateMultiItemQuote(items, location);
  }

  return {
    success: false,
    error: 'No product selected. Please specify a productId or items array.',
    quote: null,
  };
}

// ─── Multi-item Quote Generator ──────────────────────────────────────────────
function generateMultiItemQuote(items, location) {
  const lineItems = [];
  let subtotal = 0;
  let totalSavings = 0;
  const allUpsells = [];

  for (const item of items) {
    const product = productsMap[item.product_id];
    if (!product) {
      return {
        success: false,
        error: `Product "${item.product_id}" not found.`,
        quote: null,
      };
    }

    const qty = Math.max(1, Math.round(item.quantity || 1));
    const unitPrice = product.base_price_kes || 0;
    const colorSurcharge = (item.color && product.color_options?.includes(item.color))
      ? (product.color_surcharge_kes || 0)
      : 0;
    const effectiveUnitPrice = unitPrice + colorSurcharge;
    const lineTotal = effectiveUnitPrice * qty;
    const discount = getVolumeDiscount(qty, effectiveUnitPrice);

    subtotal += lineTotal;
    totalSavings += discount.savings_kes;

    lineItems.push({
      product_id: item.product_id,
      product_name: product.name,
      category_name: product.category_name,
      unit: product.unit,
      quantity: qty,
      unit_price_kes: unitPrice,
      color: item.color || null,
      color_surcharge_kes: colorSurcharge || 0,
      effective_unit_price_kes: effectiveUnitPrice,
      line_total_kes: lineTotal,
      volume_discount: discount,
    });

    // Collect upsells
    const upsells = getUpsellPaths(item.product_id);
    allUpsells.push(...upsells);
  }

  const afterDiscount = subtotal - totalSavings;
  const deliveryZone = findDeliveryZone(location);
  const deliveryFee = deliveryZone.fee_kes;
  const grandTotal = afterDiscount + deliveryFee;

  const quote = {
    items: lineItems,
    subtotal_kes: subtotal,
    total_volume_discount_kes: totalSavings,
    after_discount_kes: afterDiscount,
    delivery: {
      location: location || 'Not specified',
      zone: deliveryZone.zone,
      fee_kes: deliveryFee,
      note: deliveryZone.note || '',
    },
    total_kes: grandTotal,
    upsells: allUpsells,
    bundles: catalog.bundles || [],
    payment_methods: catalog.catalog?.payment || { primary: 'M-Pesa' },
  };

  return {
    success: true,
    quote,
    formatted: formatMultiItemQuoteText(quote),
  };
}

// ─── Format Quote for WhatsApp / SMS Display ────────────────────────────────
function formatQuoteText(quote, options) {
  const item = quote.items[0];
  const lines = [
    '━━━━━━━━━━━━━━━━━━',
    '📋 *BOMA MABATI — PRICE QUOTE*',
    '━━━━━━━━━━━━━━━━━━',
    '',
    `🏷️  ${item.product_name}`,
    `📏  Size: ${item.standard_size}${item.gauge ? ` | ${item.gauge}g` : ''}`,
    `📦  Qty: ${item.quantity} ${item.unit}(s)`,
    `💰  Unit Price: KES ${item.effective_unit_price_kes.toLocaleString()}`,
    item.color ? `🎨  Color: ${item.color}` : '',
    '',
    '─── *PRICE BREAKDOWN* ───',
    `Subtotal:      KES ${quote.subtotal_kes.toLocaleString()}`,
  ];

  if (quote.volume_discount.savings_kes > 0) {
    lines.push(
      `Discount (${quote.volume_discount.discount_percent}%): -KES ${quote.volume_discount.savings_kes.toLocaleString()}`,
    );
  }
  lines.push(
    `Delivery:      KES ${quote.delivery.fee_kes.toLocaleString()} (${quote.delivery.zone})`,
    '',
    `━━━━━━━━━━━━━━━━━━`,
    `💵 *TOTAL: KES ${quote.total_kes.toLocaleString()}*`,
    `━━━━━━━━━━━━━━━━━━`,
    '',
    `💳  Pay with M-Pesa`,
    catalog.catalog?.contact?.whatsapp
      ? `📲  Order via: ${catalog.catalog.contact.whatsapp}`
      : '',
    '',
    catalog.ai_agent_context?.social_proof || '',
  );

  // Upsell suggestion
  if (quote.upsells && quote.upsells.length > 0) {
    lines.push('', '─── *💡 RECOMMENDED UPGRADE* ───');
    for (const u of quote.upsells.slice(0, 2)) {
      lines.push(`👉 ${u.message}`);
    }
  }

  // Bundle suggestion
  if (quote.bundles && quote.bundles.length > 0) {
    lines.push('', '─── *📦 BUNDLE DEAL* ───');
    for (const b of quote.bundles.slice(0, 1)) {
      lines.push(`🎯 ${b.message}`);
    }
  }

  lines.push(
    '',
    'Reply with "ORDER" to confirm, or "CHANGE" to modify your quote.',
  );

  return {
    text: lines.filter(l => l !== '' || l === '').join('\n'),
    html: lines
      .filter(l => l !== '' || l === '')
      .map(l => {
        if (l.startsWith('━━')) return '<hr>';
        if (l.startsWith('📋') || l.startsWith('💵')) return `<strong>${l}</strong>`;
        return l.replace(/\*(.*?)\*/g, '<strong>$1</strong>');
      })
      .join('<br>'),
  };
}

function formatMultiItemQuoteText(quote) {
  const lines = [
    '━━━━━━━━━━━━━━━━━━',
    '📋 *BOMA MABATI — FULL QUOTE*',
    '━━━━━━━━━━━━━━━━━━',
    '',
    '─── *ITEMS* ───',
  ];

  for (const item of quote.items) {
    lines.push(
      `• ${item.product_name} × ${item.quantity}`,
      `  KES ${item.line_total_kes.toLocaleString()}`,
      '',
    );
  }

  lines.push('─── *PAYMENT SUMMARY* ───');
  lines.push(`Subtotal:      KES ${quote.subtotal_kes.toLocaleString()}`);

  if (quote.total_volume_discount_kes > 0) {
    lines.push(`Discount:      -KES ${quote.total_volume_discount_kes.toLocaleString()}`);
  }

  lines.push(
    `Delivery:      KES ${quote.delivery.fee_kes.toLocaleString()} (${quote.delivery.zone})`,
    '',
    `━━━━━━━━━━━━━━━━━━`,
    `💵 *TOTAL: KES ${quote.total_kes.toLocaleString()}*`,
    `━━━━━━━━━━━━━━━━━━`,
    '',
    `💳  Pay with M-Pesa`,
    catalog.catalog?.contact?.whatsapp
      ? `📲  Order via: ${catalog.catalog.contact.whatsapp}`
      : '',
    '',
    catalog.ai_agent_context?.social_proof || '',
    '',
    'Reply with "ORDER" to confirm, or "CHANGE" to modify your quote.',
  );

  return {
    text: lines.join('\n'),
    html: lines
      .map(l => {
        if (l.startsWith('━━')) return '<hr>';
        if (l.startsWith('📋') || l.startsWith('💵')) return `<strong>${l}</strong>`;
        return l.replace(/\*(.*?)\*/g, '<strong>$1</strong>');
      })
      .join('<br>'),
  };
}

// ─── Helper: Get product info ───────────────────────────────────────────────
function getProductInfo(productId) {
  return productsMap[productId] || null;
}

// ─── Helper: List all available products (for agent context) ────────────────
function listProducts(categoryId) {
  if (categoryId) {
    const cat = categoryMap[categoryId];
    return cat ? cat.products : [];
  }

  const all = [];
  for (const cat of catalog.categories) {
    all.push(...cat.products.map(p => ({ ...p, category_name: cat.name })));
  }
  return all;
}

// ─── Helper: Estimate sheets needed for a roof area ─────────────────────────
function estimateRoofSheets(roofLengthMeters, roofWidthMeters, sheetWidthMeters = 0.85) {
  const effectiveSheetWidth = sheetWidthMeters - 0.05; // overlap allowance
  const sheetsPerRow = Math.ceil(roofWidthMeters / effectiveSheetWidth);
  const sheetsPerColumn = Math.ceil(roofLengthMeters / 2.5); // standard sheet length
  const total = sheetsPerRow * sheetsPerColumn;
  return {
    roof_area_sqm: (roofLengthMeters * roofWidthMeters).toFixed(1),
    sheets_needed: total,
    sheets_per_row: sheetsPerRow,
    rows_needed: sheetsPerColumn,
    note: 'Add 10% for wastage & overlaps.',
    with_wastage: Math.ceil(total * 1.1),
  };
}

// ─── Export ─────────────────────────────────────────────────────────────────
module.exports = {
  generateQuote,
  getProductInfo,
  listProducts,
  estimateRoofSheets,
  productsMap,
  catalog,
  VERSION: '1.0.0',
};