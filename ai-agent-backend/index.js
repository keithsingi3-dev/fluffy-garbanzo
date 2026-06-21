/**
 * Boma Mabati Factory Ltd — AI Sales Agent Backend API
 * ======================================================
 * Express server that powers the Boma Mabati sales agent.
 * Handles web chat and WhatsApp message routing,
 * conversation state management, quoting, payment, and delivery.
 *
 * Endpoints:
 *   POST /api/message   — Main chat endpoint (web chat + WhatsApp)
 *   GET  /api/health    — Health check
 *   POST /api/reset     — Reset a conversation
 *   GET  /api/conversation/:id — Get conversation history
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const { getOrCreateConversation, getConversation, getAbandonedConversations, cleanupOldConversations } = require('./conversation-store');
const { processMessage, generateAbandonedCartMessage } = require('./message-handler');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─── POST /api/message ──────────────────────────────────────────────────────
// Web chat sends: { message, session }
// WhatsApp sends: { message, session, channel: 'whatsapp' }
app.post('/api/message', (req, res) => {
  try {
    const { message, session, channel } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({
        reply: "Please send a message. I'm here to help with roofing quotes! 😊",
        error: 'empty_message',
      });
    }

    const conv = getOrCreateConversation(session, channel || 'web-chat');
    const reply = processMessage(message.trim(), conv);

    res.json({
      reply,
      conversationId: conv.id,
      session: conv.id,
      state: conv.state,
      timestamp: Date.now(),
    });
  } catch (err) {
    console.error('Error processing message:', err);
    res.status(500).json({
      reply: "Sorry, something went wrong. Please try again or call +254 724 171 111.",
      error: 'internal_error',
    });
  }
});

// ─── GET /api/health ─────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Boma Mabati AI Sales Agent',
    version: '1.0.0',
    uptime: process.uptime(),
    conversations_active: require('./conversation-store').conversations.size,
    timestamp: Date.now(),
  });
});

// ─── GET /api/conversation/:id ───────────────────────────────────────────────
app.get('/api/conversation/:id', (req, res) => {
  const conv = getConversation(req.params.id);
  if (!conv) {
    return res.status(404).json({ error: 'Conversation not found' });
  }
  res.json({
    id: conv.id,
    state: conv.state,
    channel: conv.channel,
    data: {
      projectType: conv.data.projectType,
      roofingType: conv.data.roofingType,
      productId: conv.data.productId,
      quantity: conv.data.quantity,
      deliveryLocation: conv.data.deliveryLocation,
      color: conv.data.color,
      orderRef: conv.data.orderRef,
      total: conv.data.currentQuote?.total_kes || null,
      deliveryDate: conv.data.deliveryDate,
      deliveryTimeSlot: conv.data.deliveryTimeSlot,
    },
    history: conv.history.slice(-20), // Last 20 messages
    createdAt: conv.createdAt,
    lastActivityAt: conv.lastActivityAt,
  });
});

// ─── POST /api/reset ─────────────────────────────────────────────────────────
app.post('/api/reset', (req, res) => {
  const { session } = req.body;
  if (session) {
    require('./conversation-store').resetConversation(session);
    res.json({ message: 'Conversation reset.', session });
  } else {
    res.status(400).json({ error: 'session required' });
  }
});

// ─── POST /api/followup/trigger (Admin/Internal) ─────────────────────────────
// Returns abandoned conversations that need follow-up
app.get('/api/followup/pending', (req, res) => {
  const hours = parseInt(req.query.hours) || 48;
  const abandoned = getAbandonedConversations(hours);
  res.json({
    count: abandoned.length,
    conversations: abandoned.map(c => ({
      id: c.id,
      lastActivityAt: c.lastActivityAt,
      state: c.state,
      product: c.data.productId,
      total: c.data.currentQuote?.total_kes || 0,
      location: c.data.deliveryLocation,
    })),
  });
});

// ─── Cleanup old conversations periodically ──────────────────────────────────
setInterval(() => {
  cleanupOldConversations(168); // 7 days
}, 60 * 60 * 1000); // Every hour

// ─── Static: Serve website files (fallback after API routes) ────────────
const sharedDir = path.join(__dirname, '..');
app.use(express.static(sharedDir));

// ─── Start Server ────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  🏭 Boma Mabati — AI Sales Agent API`);
  console.log(`  ─────────────────────────────────`);
  console.log(`  🌐  http://0.0.0.0:${PORT}`);
  console.log(`  📡  POST /api/message  — Chat endpoint`);
  console.log(`  ❤️   GET  /api/health   — Health check`);
  console.log(`  📋  GET  /api/conversation/:id — History`);
  console.log(`  🔄  POST /api/reset    — Reset conversation`);
  console.log(`  📊  GET  /api/followup/pending — Abandoned carts`);
  console.log(`  ─────────────────────────────────\n`);
});

module.exports = app;