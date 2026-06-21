# Boma Mabati Factory Ltd — AI-Powered Roofing Sales Platform

Factory-direct roofing materials from Mombasa Road, Nairobi. Instant quotes, M-Pesa payments, and delivery booking — all in one conversation.

## Tech Stack

| Component | Technology | File(s) |
|-----------|-----------|---------|
| **Website** | Pure HTML/CSS/JS | `index.html` |
| **Chat Widget** | Self-contained embeddable HTML/JS | `chat-widget.html` |
| **Pricing Engine** | Node.js module | `pricing-engine.js`, `product-catalog.json` |
| **AI Agent Backend** | Express.js | `ai-agent-backend/` |
| **WhatsApp Flow** | Behavioral blueprint | `whatsapp-conversation-flow.md` |

## Features

- **Dark industrial website** — mobile-responsive single-page site with product showcase, trust signals, and WhatsApp CTAs
- **Embedded chat widget** — floating bubble with simulated AI sales agent; configurable API endpoint for real backend
- **Instant quoting** — volume discounts (0–10%), 4 delivery zones (KES 1,500–4,500), upsell suggestions, bundle deals
- **WhatsApp integration** — pre-filled product inquiry links, wa.me/254724171111
- **M-Pesa payment** — integrated payment flow instructions
- **AI sales agent** — state-machine-driven conversation handler with intent detection, objection handling, and 48h abandoned cart recovery

## Setup

### Website
```bash
# Serve locally
python3 -m http.server 3000 --bind 0.0.0.0
```

### AI Agent Backend
```bash
cd ai-agent-backend
npm install
node index.js
```

### Chat Widget
The widget runs standalone in any page. Set `CONFIG.API_ENDPOINT` in the widget JS to connect to the backend:
```js
const CONFIG = {
  API_ENDPOINT: 'http://localhost:3000/api/chat',  // Point to live backend
  USE_DEMO: false                                    // Disable demo mode
};
```

## Contact

- **Location:** Mombasa Road, Nairobi, Kenya
- **Phone:** +254 724 171 111
- **WhatsApp:** [wa.me/254724171111](https://wa.me/254724171111)