/**
 * Boma Mabati Factory Ltd — Message Handler
 * ============================================
 * Core conversation engine: receives user messages, detects intent,
 * manages state machine transitions, calls pricing engine, and
 * generates agent responses aligned with the WhatsApp Conversation Flow.
 */

const path = require('path');
const { CONVERSATION_STATES, setState, addHistory, updateData } = require('./conversation-store');
const payment = require('./payment');

// ─── Load Pricing Engine & Catalog ─────────────────────────────────────────
let pricingEngine;
let catalog;
try {
  pricingEngine = require(path.join(__dirname, '..', 'pricing-engine'));
  catalog = pricingEngine.catalog;
} catch (err) {
  console.error('Failed to load pricing engine:', err.message);
  pricingEngine = null;
  catalog = { ai_agent_context: {} };
}

const SOCIAL_PROOF = catalog.ai_agent_context?.social_proof || '⭐ Rated 4.3 by 95 buyers near you';

// ─── Intent Detection ───────────────────────────────────────────────────────
const INTENT_PATTERNS = {
  greeting: /\b(hello|hi|hey|mambo|habari|hi there|good morning|good afternoon|good evening|niaje|sasa|jambo)\b/i,
  products: /\b(product|catalog|what (you|do you) have|options|types|kinds|selection|mabati|sheets|roofing)\b/i,
  corrugated: /\b(corrugated|mabati|standard|normal|plain|30g|28g|26g)\b/i,
  ibr: /\b(ibr|box.?profile|profile|premium|modern|trapezoidal)\b/i,
  steel: /\b(steel|purlin|truss|structure|frame|c.?channel|c.?purlin|msumeno)\b/i,
  quote: /\b(quote|quotation|price|how much|cost|estimate|bei gani|pesa ngapi|total)\b/i,
  order: /\b(order|buy|confirm|proceed|nataka|nita|yes|ndio|sawa|poa|confirm order)\b/i,
  change: /\b(change|modify|adjust|different|instead|badili|revise|update)\b/i,
  cancel: /\b(cancel|stop|forget|disregard|cancel order)\b/i,
  delivery: /\b(delivery|deliver|when|shipping|transport|usafirishaji|dispatch|arrive)\b/i,
  payment: /\b(pay|mpesa|m.?pesa|payment|lipa|send|transaction|code|confirmation|stk)\b/i,
  objection_price: /\b(expensive|ghali|too much|costly|pricey|reduce|discount|cheaper|rahisi|afford)\b/i,
  objection_quality: /\b(quality|durable|strong|rust|kutu|last|long.?life|genuine|fake|original|guarantee|warranty)\b/i,
  question: /\b(question|how|what|when|where|why|which|siam|doubt|sure|really|tell me|explain)\b/i,
  color: /\b(color|colour|red|green|blue|brown|grey|gray|black|rangi)\b/i,
  help: /\b(help|support|assist|what can you|menu|options)\b/i,
  human: /\b(human|agent|person|manager|speak to|talk to|call|representative)\b/i,
  stop: /\b(stop|unsubscribe|leave|don.?t message|stop messaging|dnd)\b/i,
  size: /\b(dimension|measure|length|width|size|roof size|square|sqm|how many sheets)\b/i,
  budget: /\b(budget|spend|afford|maximum|max|limit|spending)\b/i,
  goodbye: /\b(bye|goodbye|kwaheri|thanks|asante|thank you|later|sawa|see you)\b/i,
  quantity: /\b(\d+)\b/, // catches numbers — used contextually
};

function detectIntent(text) {
  const t = text.toLowerCase().trim();
  if (INTENT_PATTERNS.stop.test(t)) return 'stop';
  if (INTENT_PATTERNS.human.test(t)) return 'human';
  if (INTENT_PATTERNS.cancel.test(t)) return 'cancel';
  if (INTENT_PATTERNS.order.test(t)) return 'order';
  if (INTENT_PATTERNS.payment.test(t)) return 'payment';
  if (INTENT_PATTERNS.delivery.test(t)) return 'delivery';
  if (INTENT_PATTERNS.change.test(t)) return 'change';
  if (INTENT_PATTERNS.size.test(t)) return 'size';
  if (INTENT_PATTERNS.ibr.test(t)) return 'ibr';
  if (INTENT_PATTERNS.corrugated.test(t)) return 'corrugated';
  if (INTENT_PATTERNS.steel.test(t)) return 'steel';
  if (INTENT_PATTERNS.products.test(t) || INTENT_PATTERNS.help.test(t)) return 'products';
  if (INTENT_PATTERNS.quote.test(t)) return 'quote';
  if (INTENT_PATTERNS.objection_price.test(t)) return 'objection_price';
  if (INTENT_PATTERNS.objection_quality.test(t)) return 'objection_quality';
  if (INTENT_PATTERNS.color.test(t)) return 'color';
  if (INTENT_PATTERNS.budget.test(t)) return 'budget';
  if (INTENT_PATTERNS.greeting.test(t)) return 'greeting';
  if (INTENT_PATTERNS.goodbye.test(t)) return 'goodbye';
  if (INTENT_PATTERNS.question.test(t)) return 'question';
  return 'unknown';
}

// ─── Extract Entities from Text ─────────────────────────────────────────────
function extractQuantity(text) {
  const match = text.match(/(\d+)\s*(sheets?|pieces?|pcs?|units?)/i);
  if (match) return parseInt(match[1], 10);
  return null;
}

function extractLocation(text) {
  const knownLocations = [
    'nairobi', 'cbd', 'westlands', 'kilimani', 'karen', 'langata', 'kasarani',
    'ruiru', 'juja', 'kikuyu', 'ngong', 'kitengela', 'athiriver', 'athi river',
    'embakasi', 'buruburu', 'donholm', 'south b', 'south c', 'madaraka',
    'kawangware', 'dagoretti', 'komarock', 'pipeline', 'roysambu', 'githurai',
    'zimmerman', 'kayole', 'thika road', 'limuru road', 'naivasha road',
    'kiambu', 'molongo', 'mlolongo', 'syokimau', 'mavoko', 'ongata rongai',
  ];
  const t = text.toLowerCase();
  for (const loc of knownLocations) {
    if (t.includes(loc)) return loc.charAt(0).toUpperCase() + loc.slice(1);
  }
  return null;
}

function extractColor(text) {
  const colors = ['red', 'green', 'blue', 'brown', 'grey', 'gray', 'black'];
  const t = text.toLowerCase();
  for (const c of colors) {
    if (t.includes(c)) return c.charAt(0).toUpperCase() + c.slice(1);
  }
  return null;
}

// ─── Response Generation ────────────────────────────────────────────────────
function generateResponse(userText, conv) {
  const intent = detectIntent(userText);
  const state = conv.state;
  const data = conv.data;
  const ctx = conv.context;

  // ── Handle special intents regardless of state ──────────────────────────
  if (intent === 'stop') {
    ctx.dnd = true;
    setState(conv, CONVERSATION_STATES.ABANDONED);
    return "Sorry for bothering you! I've noted your request — you won't receive further messages. Have a great day! 😊";
  }

  if (intent === 'human') {
    setState(conv, CONVERSATION_STATES.COMPLETED);
    return `I understand! Let me connect you with our sales team.\n\n📞 Call us: +254 724 171 111\n📍 Visit: Mombasa Road, Nairobi\n\nOr stay on WhatsApp — our team will pick up your conversation shortly. 😊`;
  }

  if (intent === 'goodbye') {
    return `You're welcome! If you need anything else, just reach out. We're here to help! 😊\n\n${SOCIAL_PROOF}`;
  }

  if (intent === 'cancel') {
    if (state === CONVERSATION_STATES.PAYMENT || state === CONVERSATION_STATES.DELIVERY || state === CONVERSATION_STATES.CONFIRMATION) {
      setState(conv, CONVERSATION_STATES.COMPLETED);
      return `I understand you'd like to cancel. Let me check on the status of your order.\n\n• If not yet dispatched: We can cancel.\n• If already dispatched: You can refuse delivery.\n\nWould you like us to proceed with cancellation? Or if you'd like to start fresh, just tell me what you need!`;
    }
    return "No problem! Your current quote is still valid. If you'd like to start over, just let me know what roofing materials you're looking for. 😊";
  }

  // ─── STATE: GREETING ──────────────────────────────────────────────────
  if (state === CONVERSATION_STATES.GREETING) {
    // Check if returning customer with existing data
    if (data.productId || data.deliveryLocation) {
      setState(conv, CONVERSATION_STATES.QUALIFYING);
      return `Welcome back! 👋 Still working on your roofing project?\n\nI have your details from before. Would you like to:\n1️⃣ Get a new quote\n2️⃣ Continue with your previous quote\n3️⃣ Ask a question`;
    }

    setState(conv, CONVERSATION_STATES.QUALIFYING);
    return `${catalog.ai_agent_context?.greeting_message || 
      "Hello! Welcome to Boma Mabati Factory Ltd 👋\n\nI'm your sales assistant. I can help you with:\n• Instant price quotes on roofing materials\n• Product recommendations for your project\n• Order placement with M-Pesa payment\n• Delivery booking (Nairobi area)"}`;
  }

  // ─── STATE: QUALIFYING ────────────────────────────────────────────────
  if (state === CONVERSATION_STATES.QUALIFYING) {
    // Extract info from message
    const qty = extractQuantity(userText);
    const location = extractLocation(userText);
    const color = extractColor(userText);

    if (qty) updateData(conv, { quantity: qty });
    if (location) updateData(conv, { deliveryLocation: location });
    if (color) updateData(conv, { color });

    // Detect if they mentioned a product type
    if (intent === 'corrugated') {
      updateData(conv, { roofingType: 'corrugated' });
      return getProductSelectionResponse(conv, 'corrugated');
    }
    if (intent === 'ibr') {
      updateData(conv, { roofingType: 'ibr' });
      return getProductSelectionResponse(conv, 'ibr');
    }
    if (intent === 'steel') {
      updateData(conv, { roofingType: 'structural-steel' });
      return `Great! We have structural steel for roof framing:\n\n🔩 **C-Purlins:**\n• C100 — KES 850 (light-duty, small spans)\n• C125 — KES 1,100 (standard residential)\n• C150 — KES 1,450 (heavy-duty, commercial)\n\n🏗️ **Roof Trusses:**\n• Light-duty — KES 2,500\n• Standard — KES 4,500\n\nWhich one are you interested in, and how many do you need?`;
    }
    if (intent === 'products') {
      return getProductOverview();
    }
    if (intent === 'size') {
      return getProductOverview();
    }
    if (intent === 'quote' && data.roofingType) {
      // They want a quote but we need quantity
      if (!data.quantity) {
        return "I'd be happy to give you a quote! Just let me know how many sheets you need. Or if you're not sure, tell me your roof dimensions (length × width) and I'll calculate it for you.";
      }
      if (!data.deliveryLocation) {
        return "Almost there! Just one more thing — where should we deliver this? (E.g. Westlands, Ruiru, CBD, Karen, etc.)";
      }
      setState(conv, CONVERSATION_STATES.QUOTING);
      return generateQuoteAndRespond(conv);
    }

    // If we got location but no product yet
    if (location && !data.roofingType) {
      updateData(conv, { deliveryLocation: location });
      return getProductOverview();
    }

    // If we got quantity but no product
    if (qty && !data.roofingType) {
      return getProductOverview();
    }

    // Default: try to understand what they need
    return `Thanks! To help you better, could you tell me:\n\n1️⃣ What type of roofing material? (Corrugated sheets, IBR/profile, or structural steel?)\n2️⃣ How many sheets/items do you need?\n3️⃣ Where in Nairobi should we deliver?`;
  }

  // ─── STATE: RECOMMENDING ──────────────────────────────────────────────
  if (state === CONVERSATION_STATES.RECOMMENDING) {
    const qty = extractQuantity(userText);
    const location = extractLocation(userText);
    if (qty) updateData(conv, { quantity: qty });
    if (location) updateData(conv, { deliveryLocation: location });

    if (data.roofingType === 'corrugated') {
      return getCorrugatedVariants(conv);
    }
    if (data.roofingType === 'ibr') {
      return getIBRVariants(conv);
    }
    if (data.roofingType === 'structural-steel') {
      return "Which structural steel item do you need? We have:\n• C-Purlin 100mm — KES 850\n• C-Purlin 125mm — KES 1,100\n• C-Purlin 150mm — KES 1,450\n• Light Roof Truss — KES 2,500\n• Standard Roof Truss — KES 4,500\n\nJust type the name or quantity!";
    }

    // General product selection
    if (intent === 'corrugated' || intent === 'ibr' || intent === 'steel') {
      return getProductSelectionResponse(conv, intent);
    }
    return getProductOverview();
  }

  // ─── STATE: QUOTING ───────────────────────────────────────────────────
  if (state === CONVERSATION_STATES.QUOTING) {
    const qty = extractQuantity(userText);
    const location = extractLocation(userText);
    const color = extractColor(userText);

    if (qty) updateData(conv, { quantity: qty });
    if (location) updateData(conv, { deliveryLocation: location });
    if (color) updateData(conv, { color });

    if (intent === 'change' || intent === 'size') {
      return "What would you like to change?\n• The product type?\n• The quantity?\n• The delivery location?\n• Or add a colour?";
    }

    if (intent === 'quote') {
      if (!data.productId) {
        return getProductOverview();
      }
      if (!data.quantity) {
        return "How many sheets do you need?";
      }
      if (!data.deliveryLocation) {
        return "Where in Nairobi should we deliver this?";
      }
      return generateQuoteAndRespond(conv);
    }

    // Check if user provided a product variant selection
    const productMatch = matchProductFromText(userText);
    if (productMatch) {
      updateData(conv, { productId: productMatch.id, roofingType: productMatch.category });
      if (!data.quantity) {
        return `Great choice! How many ${productMatch.name}s do you need?`;
      }
      if (!data.deliveryLocation) {
        return "And where should we deliver?";
      }
      return generateQuoteAndRespond(conv);
    }

    return "Would you like me to generate a quote with what we have so far? Just say ORDER or tell me what you'd like to change.";
  }

  // ─── STATE: UPSELL ────────────────────────────────────────────────────
  if (state === CONVERSATION_STATES.UPSELL) {
    if (intent === 'order' || userText.toLowerCase().includes('yes') || userText.toLowerCase().includes('ndio')) {
      setState(conv, CONVERSATION_STATES.PAYMENT);
      return generatePaymentResponse(conv);
    }
    if (intent === 'change' || userText.toLowerCase().includes('no') || userText.toLowerCase().includes('hakuna') || userText.toLowerCase().includes('skip')) {
      setState(conv, CONVERSATION_STATES.PAYMENT);
      return generatePaymentResponse(conv, true);
    }
    return "Would you like to add the upgrade to your order? Reply YES or NO. Or just ORDER to proceed with your current quote.";
  }

  // ─── STATE: PAYMENT ───────────────────────────────────────────────────
  if (state === CONVERSATION_STATES.PAYMENT) {
    if (intent === 'payment' || intent === 'order') {
      // They want to pay — instructions already sent, so resend
      return generatePaymentResponse(conv);
    }

    // Check if they provided an M-Pesa code
    const code = userText.trim();
    if (payment.isValidMpesaCode(code)) {
      updateData(conv, { mpesaCode: code });
      const result = payment.processPaymentConfirmation(code, conv.data.currentQuote?.total_kes || 0);
      if (result.success) {
        setState(conv, CONVERSATION_STATES.DELIVERY);
        return `✅ Payment received! Thank you! 🙏\n\nTransaction confirmed.\n\nNow, let's arrange your delivery. What day works best for you?\nWe deliver Monday–Saturday. Available slots:\n• Morning (8am–12pm)\n• Afternoon (12pm–5pm)\n\nPlease let me know your preferred date and time. 🚚`;
      } else {
        return `It looks like the payment didn't go through. The amount should be exactly KES ${conv.data.currentQuote?.total_kes?.toLocaleString() || ''}.\nPaybill: ${payment.MPESA_CONFIG.paybill}\nAccount: ${conv.data.orderRef || ''}\n\nTry again and let me know if you run into any issues!`;
      }
    }

    return generatePaymentResponse(conv);
  }

  // ─── STATE: DELIVERY ──────────────────────────────────────────────────
  if (state === CONVERSATION_STATES.DELIVERY) {
    // Try to extract date and time
    const hasTime = /\b(morning|afternoon|8am|9am|10am|11am|12pm|1pm|2pm|3pm|4pm|5pm)\b/i.test(userText);
    const hasDay = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow)\b/i.test(userText) || 
                   /\b(\d+)(st|nd|rd|th)?\s+(june|july|august|january|february|march|april|may|september|october|november|december)/i.test(userText);

    let timeSlot = null;
    if (/\b(morning|8am|9am|10am|11am)\b/i.test(userText)) timeSlot = 'Morning (8am–12pm)';
    else if (/\b(afternoon|12pm|1pm|2pm|3pm|4pm|5pm)\b/i.test(userText)) timeSlot = 'Afternoon (12pm–5pm)';

    if (timeSlot) updateData(conv, { deliveryTimeSlot: timeSlot });
    
    if (hasDay || hasTime) {
      setState(conv, CONVERSATION_STATES.CONFIRMATION);
      const dateStr = hasDay ? userText.match(/[\w\s,]+/g)?.[0]?.trim() || 'your chosen day' : 'your chosen day';
      updateData(conv, { deliveryDate: dateStr });
      return generateDeliveryConfirmation(conv, dateStr, timeSlot);
    }

    return "What day works best for you? We deliver Monday–Saturday.\n\nAvailable slots:\n🌅 Morning (8am–12pm)\n🌤️ Afternoon (12pm–5pm)\n\nJust tell me the day and preferred time!";
  }

  // ─── STATE: CONFIRMATION ──────────────────────────────────────────────
  if (state === CONVERSATION_STATES.CONFIRMATION) {
    if (intent === 'change' || userText.toLowerCase().includes('change') || userText.toLowerCase().includes('different')) {
      setState(conv, CONVERSATION_STATES.DELIVERY);
      return "Of course! What date or time would work better for you? We deliver Monday–Saturday.";
    }
    setState(conv, CONVERSATION_STATES.COMPLETED);
    return generateFinalConfirmation(conv);
  }

  // ─── STATE: HANDLING_OBJECTION ────────────────────────────────────────
  if (state === CONVERSATION_STATES.HANDLING_OBJECTION) {
    if (intent === 'order' || userText.toLowerCase().includes('yes') || userText.toLowerCase().includes('ndio') || userText.toLowerCase().includes('proceed')) {
      // They want to proceed after objection handling
      setState(conv, CONVERSATION_STATES.QUOTING);
      return generateQuoteAndRespond(conv);
    }
    if (intent === 'corrugated' || intent === 'ibr' || intent === 'steel') {
      setState(conv, CONVERSATION_STATES.RECOMMENDING);
      return getProductSelectionResponse(conv, intent);
    }
    if (intent === 'change' || userText.toLowerCase().includes('different')) {
      setState(conv, CONVERSATION_STATES.QUALIFYING);
      return "Sure! Let's start over. What type of roofing material are you looking for?\n\n1. Corrugated sheets (standard)\n2. IBR / Box profile (premium)\n3. Structural steel";
    }
    return "Is there anything else I can help clarify? Or would you like to proceed with the quote?";
  }

  // ─── STATE: ABANDONED — user responds to follow-up ────────────────────
  if (state === CONVERSATION_STATES.ABANDONED) {
    if (intent === 'order' || userText.toLowerCase().includes('yes') || userText.toLowerCase().includes('proceed')) {
      setState(conv, CONVERSATION_STATES.PAYMENT);
      return generatePaymentResponse(conv);
    }
    if (intent === 'change') {
      setState(conv, CONVERSATION_STATES.QUALIFYING);
      return "No problem! What would you like to change about your previous quote?\n\n• Different product?\n• Different quantity?\n• Different delivery location?";
    }
    setState(conv, CONVERSATION_STATES.QUALIFYING);
    return getProductOverview();
  }

  // ─── FALLBACK for any unhandled state ─────────────────────────────────
  return `I'm not sure I understood that. Here's what I can help with:\n\n1️⃣ Get a price quote for roofing materials\n2️⃣ Learn about our products\n3️⃣ Place an order\n\nWhat would you like to do? 😊`;
}

// ─── Helper: Product Overview ───────────────────────────────────────────────
function getProductOverview() {
  return `Here are our main roofing products:\n\n📋 **Corrugated Sheets** (from KES 650/sheet)\n• Standard roofing — affordable & durable\n• Gauges: 30g (basic), 28g (popular), 26g (heavy-duty)\n\n🏗️ **IBR / Box Profile** (from KES 1,050/sheet)\n• Premium modern roofing — stronger & better looking\n• Colors: Red, Green, Blue, Brown, Grey, Black\n\n🔩 **Structural Steel**\n• C-Purlins (100/125/150mm) — KES 850–1,450\n• Roof Trusses — KES 2,500–4,500\n\nWhich one are you interested in? 😊`;
}

// ─── Helper: Product Selection Response ──────────────────────────────────────
function getProductSelectionResponse(conv, type) {
  updateData(conv, { roofingType: type });
  if (type === 'corrugated') {
    setState(conv, CONVERSATION_STATES.RECOMMENDING);
    return getCorrugatedVariants(conv);
  }
  if (type === 'ibr') {
    setState(conv, CONVERSATION_STATES.RECOMMENDING);
    return getIBRVariants(conv);
  }
  // steel handled in main flow
  return getProductOverview();
}

function getCorrugatedVariants(conv) {
  return `Great choice! We have three gauges of corrugated sheets:\n\n1️⃣ **30-Gauge** — KES 650/sheet\n   Budget-friendly, good for sheds & temporary structures\n\n2️⃣ **28-Gauge** — KES 750/sheet ✅ *Most Popular*\n   Standard for Kenyan homes — best balance of price & durability\n\n3️⃣ **26-Gauge** — KES 950/sheet\n   Heavy-duty, maximum durability for permanent structures\n\nWhich gauge would you like? Also, how many sheets do you need?`;
}

function getIBRVariants(conv) {
  return `Excellent choice! IBR is our premium option — stronger and more modern looking.\n\n1️⃣ **IBR 28-Gauge** — KES 1,050/sheet\n   Premium finish, great for modern homes\n\n2️⃣ **IBR 26-Gauge** — KES 1,350/sheet\n   Maximum strength for high-end projects\n\nBoth available in colors: Red, Green, Blue, Brown, Grey, Black (+KES 150/sheet for color)\n\nWhich gauge would you like? How many sheets?`;
}

// ─── Helper: Match product from text ────────────────────────────────────────
function matchProductFromText(text) {
  const t = text.toLowerCase();
  if (!pricingEngine) return null;
  const products = pricingEngine.productsMap || {};
  for (const [id, product] of Object.entries(products)) {
    const name = product.name.toLowerCase();
    const idMatch = id.toLowerCase();
    if (t.includes(idMatch) || t.includes(name) || 
        (product.gauge && t.includes(`${product.gauge}g`)) ||
        (t.includes('30') && id.includes('30g')) ||
        (t.includes('28') && id.includes('28g')) ||
        (t.includes('26') && id.includes('26g'))) {
      return { id, name: product.name, category: product.category_id };
    }
  }
  // Check for gauge-only matches
  if (/\b30\b/.test(t)) return { id: 'corrugated-30g', name: 'Corrugated Sheet (30 Gauge)', category: 'corrugated' };
  if (/\b28\b/.test(t) && !t.includes('ibr')) return { id: 'corrugated-28g', name: 'Corrugated Sheet (28 Gauge)', category: 'corrugated' };
  if (/\b26\b/.test(t) && !t.includes('ibr')) return { id: 'corrugated-26g', name: 'Corrugated Sheet (26 Gauge)', category: 'corrugated' };
  return null;
}

// ─── Helper: Generate Quote & Respond ───────────────────────────────────────
function generateQuoteAndRespond(conv) {
  const data = conv.data;
  if (!pricingEngine) {
    return "Sorry, our pricing system is temporarily unavailable. Please try again later or call +254 724 171 111.";
  }

  let productId = data.productId;
  if (!productId) {
    // Auto-select based on roofing type
    if (data.roofingType === 'corrugated') productId = 'corrugated-28g'; // default most popular
    else if (data.roofingType === 'ibr') productId = 'ibr-28g';
    else return "Which specific product would you like a quote for?";
  }

  const qty = data.quantity || 10; // default
  const location = data.deliveryLocation || 'Nairobi';
  
  let result;
  try {
    result = pricingEngine.generateQuote({
      productId,
      quantity: qty,
      location,
      color: data.color || undefined,
    });
  } catch (err) {
    return "Sorry, I couldn't generate a quote right now. Please try again.";
  }

  if (!result.success) {
    return `Sorry, I couldn't find that product. Let me show you what we have:\n\n${getProductOverview()}`;
  }

  // Store the quote in conversation data
  updateData(conv, {
    productId,
    currentQuote: result.quote,
    currentQuoteText: result.formatted?.text,
  });

  // If order ref not set yet, generate one
  if (!data.orderRef) {
    const ref = payment.generateOrderRef();
    updateData(conv, { orderRef: ref });
  }

  // Move to upsell state if there are upsells available
  const hasUpsells = result.quote.upsells && result.quote.upsells.length > 0;
  const hasBundles = result.quote.bundles && result.quote.bundles.length > 0;

  let response = result.formatted?.text || "Here's your quote.";

  if (hasUpsells || hasBundles) {
    setState(conv, CONVERSATION_STATES.UPSELL);
  } else {
    setState(conv, CONVERSATION_STATES.PAYMENT);
  }

  return response;
}

// ─── Helper: Generate Payment Response ──────────────────────────────────────
function generatePaymentResponse(conv, skippedUpsell = false) {
  const data = conv.data;
  const total = data.currentQuote?.total_kes || 0;
  const orderRef = data.orderRef || payment.generateOrderRef();
  if (!data.orderRef) updateData(conv, { orderRef });

  const instr = payment.generatePaymentInstructions(total, orderRef);
  setState(conv, CONVERSATION_STATES.PAYMENT);

  let summary = `Great! Let's get your order placed. ✅\n\nYour order summary:\n━━━━━━━━━━━━━━━━━━\n`;
  if (data.currentQuote?.items) {
    for (const item of data.currentQuote.items) {
      summary += `• ${item.quantity} × ${item.product_name}\n`;
    }
  }
  summary += `• Total: KES ${total.toLocaleString()}\n`;
  summary += `• Delivery: ${data.deliveryLocation || 'Nairobi'}\n━━━━━━━━━━━━━━━━━━\n\n`;

  summary += `To pay via M-Pesa:\n📱 Paybill: ${instr.paybill}\n📝 Account: ${instr.account}\n💰 Amount: KES ${total.toLocaleString()}\n\nOnce you've sent the payment, reply with the M-Pesa confirmation code (the M-Pesa message you receive) and I'll confirm your order! 😊`;

  return summary;
}

// ─── Helper: Generate Delivery Confirmation ─────────────────────────────────
function generateDeliveryConfirmation(conv, dateStr, timeSlot) {
  const data = conv.data;
  const phone = data.contactPhone || '(your WhatsApp number)';
  const time = timeSlot || 'Morning (8am–12pm)';

  return `✅ Delivery booked! 📦\n\n━━━━━━━━━━━━━━━━━━\n📍 ${data.deliveryLocation || 'Nairobi'}\n📅 ${dateStr}\n⏰ ${time}\n📞 Driver will call: ${phone}\n━━━━━━━━━━━━━━━━━━\n\nOur team will call you on the morning of delivery to confirm the exact time.\n\n${SOCIAL_PROOF}\n\nReply ORDER to confirm, or CHANGE to modify.`;
}

// ─── Helper: Generate Final Confirmation ────────────────────────────────────
function generateFinalConfirmation(conv) {
  const data = conv.data;

  return `━━━━━━━━━━━━━━━━━━\n✅ ORDER CONFIRMED ✅\n━━━━━━━━━━━━━━━━━━\n\n📋 *BOMA MABATI FACTORY LTD*\n\n🧾 Order #${data.orderRef || ''}\n\n── ITEMS ──\n${
    data.currentQuote?.items?.map(i => `• ${i.quantity} × ${i.product_name}`).join('\n') || ''
  }\n💵 *TOTAL PAID: KES ${(data.currentQuote?.total_kes || 0).toLocaleString()}*\n💳 Payment: M-Pesa ✅\n\n── DELIVERY ──\n📍 ${data.deliveryLocation || 'Nairobi'}\n📅 ${data.deliveryDate || 'Scheduled'}\n⏰ ${data.deliveryTimeSlot || 'TBC'}\n\n── CONTACT ──\n📲 wa.me/254724171111\n\nThank you for your order! 🙏\n${SOCIAL_PROOF}`;
}

// ─── Generate Follow-up Message ─────────────────────────────────────────────
function generateAbandonedCartMessage(conv) {
  const data = conv.data;
  const productName = data.currentQuote?.items?.[0]?.product_name || 'your selected products';
  const total = data.currentQuote?.total_kes || 0;

  return `Hello! 👋\n\nYou recently requested a quote from Boma Mabati Factory Ltd but didn't complete your order. Is there anything I can help with?\n\n• Questions about the products?\n• Need a revised quote?\n• Ready to place your order now?\n\nJust reply and I'll be happy to assist! 😊\n\n${SOCIAL_PROOF}`;
}

// ─── Process single message (main entry point) ──────────────────────────────
function processMessage(userText, conv) {
  addHistory(conv, 'user', userText);
  const response = generateResponse(userText, conv);
  addHistory(conv, 'agent', response);
  return response;
}

// ─── Export ─────────────────────────────────────────────────────────────────
module.exports = {
  processMessage,
  generateResponse,
  generateAbandonedCartMessage,
  detectIntent,
  extractQuantity,
  extractLocation,
  extractColor,
  INTENT_PATTERNS,
};