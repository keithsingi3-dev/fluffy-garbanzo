/**
 * Boma Mabati Factory Ltd — Conversation Store
 * ================================================
 * In-memory store for AI agent conversations.
 * Tracks state, collected data, history, and timestamps.
 * Upgrade path: replace Map with SQLite/Postgres when needed.
 */

const { v4: uuidv4 } = require('uuid');

// ─── State Enum ─────────────────────────────────────────────────────────────
const CONVERSATION_STATES = {
  GREETING: 'greeting',
  QUALIFYING: 'qualifying',
  RECOMMENDING: 'recommending',
  QUOTING: 'quoting',
  UPSELL: 'upsell',
  HANDLING_OBJECTION: 'handling_objection',
  PAYMENT: 'payment',
  PAYMENT_CONFIRMING: 'payment_confirming',
  DELIVERY: 'delivery',
  CONFIRMATION: 'confirmation',
  COMPLETED: 'completed',
  ABANDONED: 'abandoned',
};

// ─── Store ──────────────────────────────────────────────────────────────────
const conversations = new Map();

// ─── Create New Conversation ────────────────────────────────────────────────
function createConversation(sessionId, channel = 'web-chat') {
  const id = sessionId || uuidv4();
  const conversation = {
    id,
    channel,          // 'web-chat', 'whatsapp', 'sms'
    state: CONVERSATION_STATES.GREETING,
    data: {
      projectType: null,      // 'home', 'commercial', 'shed', 'temporary'
      roofingType: null,      // 'corrugated', 'ibr', 'structural-steel'
      productId: null,        // specific product selected
      quantity: null,
      deliveryLocation: null,
      deliveryZone: null,
      budget: null,
      timeline: null,
      color: null,
      contactPhone: null,
      customerName: null,
      currentQuote: null,     // Last generated quote object
      currentQuoteText: null, // Formatted quote text
      orderRef: null,         // Order reference number
      mpesaCode: null,        // M-Pesa confirmation code
      deliveryDate: null,
      deliveryTimeSlot: null, // 'morning', 'afternoon'
    },
    history: [],
    context: {
      objectionCount: 0,
      unrecognizedCount: 0,
      upsellOffered: false,
      bundleOffered: false,
      followupSent: false,
      dnd: false,             // Do Not Disturb flag
    },
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    quoteExpiresAt: null,
  };
  conversations.set(id, conversation);
  return conversation;
}

// ─── Get or Create ──────────────────────────────────────────────────────────
function getOrCreateConversation(sessionId, channel) {
  if (!sessionId) return createConversation(null, channel);
  let conv = conversations.get(sessionId);
  if (!conv) {
    conv = createConversation(sessionId, channel);
  }
  return conv;
}

// ─── Get Conversation ───────────────────────────────────────────────────────
function getConversation(id) {
  return conversations.get(id) || null;
}

// ─── Update State ───────────────────────────────────────────────────────────
function setState(conv, newState) {
  conv.state = newState;
  conv.lastActivityAt = Date.now();
}

// ─── Add History Entry ──────────────────────────────────────────────────────
function addHistory(conv, role, message) {
  conv.history.push({
    role,        // 'user' | 'agent'
    message,
    timestamp: Date.now(),
  });
  conv.lastActivityAt = Date.now();
}

// ─── Update Conversation Data ───────────────────────────────────────────────
function updateData(conv, updates) {
  Object.assign(conv.data, updates);
  conv.lastActivityAt = Date.now();
}

// ─── Get Conversations Awaiting Follow-up ───────────────────────────────────
function getAbandonedConversations(hoursThreshold = 48) {
  const cutoff = Date.now() - (hoursThreshold * 60 * 60 * 1000);
  const results = [];
  for (const conv of conversations.values()) {
    if (
      conv.state !== CONVERSATION_STATES.COMPLETED &&
      conv.state !== CONVERSATION_STATES.ABANDONED &&
      conv.context.dnd === false &&
      conv.lastActivityAt < cutoff &&
      conv.lastActivityAt > 0
    ) {
      // Ensure at least one quote was generated
      if (conv.data.currentQuote) {
        results.push(conv);
      }
    }
  }
  return results;
}

// ─── Mark Conversation as Abandoned ─────────────────────────────────────────
function markAbandoned(conv) {
  setState(conv, CONVERSATION_STATES.ABANDONED);
}

// ─── Reset Conversation ─────────────────────────────────────────────────────
function resetConversation(id) {
  conversations.delete(id);
}

// ─── Cleanup Old Conversations (memory management) ──────────────────────────
function cleanupOldConversations(maxAgeHours = 168) {
  // 7 days default
  const cutoff = Date.now() - (maxAgeHours * 60 * 60 * 1000);
  for (const [id, conv] of conversations.entries()) {
    if (conv.lastActivityAt < cutoff) {
      conversations.delete(id);
    }
  }
}

// ─── Export ─────────────────────────────────────────────────────────────────
module.exports = {
  CONVERSATION_STATES,
  createConversation,
  getOrCreateConversation,
  getConversation,
  setState,
  addHistory,
  updateData,
  getAbandonedConversations,
  markAbandoned,
  resetConversation,
  cleanupOldConversations,
  conversations,
};