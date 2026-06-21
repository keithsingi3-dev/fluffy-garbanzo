/**
 * Boma Mabati Factory Ltd — M-Pesa Payment Integration
 * ======================================================
 * Generates M-Pesa payment instructions and processes confirmations.
 * Currently returns payment instructions (Paybill + Account ref).
 * 
 * Production upgrade: Integrate with Safaricom M-Pesa API (Daraja).
 */

const { v4: uuidv4 } = require('uuid');

// M-Pesa Configuration (placeholder — replace with real credentials)
const MPESA_CONFIG = {
  paybill: '247247',        // Example Paybill number
  businessName: 'BOMA MABATI FACTORY LTD',
  env: 'sandbox',           // 'sandbox' | 'production'
};

// Generate a unique order reference
function generateOrderRef() {
  const prefix = 'BM';
  const date = new Date();
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const seq = String(Math.floor(Math.random() * 9999)).padStart(4, '0');
  return `${prefix}${day}${month}${seq}`;
}

// Generate M-Pesa payment instructions
function generatePaymentInstructions(amount, orderRef) {
  const ref = orderRef || generateOrderRef();
  return {
    method: 'M-Pesa',
    paybill: MPESA_CONFIG.paybill,
    account: ref,
    amount_kes: amount,
    instructions: `Send KES ${amount.toLocaleString()} to M-Pesa Paybill ${MPESA_CONFIG.paybill}. Use account number: ${ref}. Then reply with your M-Pesa confirmation code.`,
    order_ref: ref,
    timestamp: Date.now(),
  };
}

// Validate M-Pesa confirmation code format
function isValidMpesaCode(code) {
  if (!code || typeof code !== 'string') return false;
  // M-Pesa codes typically look like: PBT12A3B4C or similar
  // Allow formats: "PBT..." or any alphanumeric 8+ chars starting with letter
  return /^[A-Za-z0-9]{8,}$/.test(code.trim()) || /^[A-Za-z]{3}[A-Za-z0-9]+$/.test(code.trim());
}

// Process payment confirmation (stub — in production, verify with Daraja API)
function processPaymentConfirmation(code, amount) {
  if (!isValidMpesaCode(code)) {
    return {
      success: false,
      error: 'Invalid M-Pesa confirmation code format.',
    };
  }
  // In production: call Safaricom API to verify
  return {
    success: true,
    message: `Payment of KES ${amount.toLocaleString()} confirmed. Code: ${code.toUpperCase()}`,
    confirmed: true,
    timestamp: Date.now(),
  };
}

module.exports = {
  generatePaymentInstructions,
  processPaymentConfirmation,
  isValidMpesaCode,
  generateOrderRef,
  MPESA_CONFIG,
};