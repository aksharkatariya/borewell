import 'dotenv/config';
import express from 'express';
import cors    from 'cors';
import crypto  from 'crypto';
import { insertItem, getItems, updateItem } from './db.js';
import { enrichContent } from './enricher.js';

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// CORS
// Tells the browser it's okay for your Netlify site to call this server.
// Without this, every fetch() from the frontend gets blocked.
// In production, replace * with your actual Netlify URL.
// ---------------------------------------------------------------------------
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
}));

// ---------------------------------------------------------------------------
// POST /webhook
// Telegram calls this every time you send a message to your bot.
// The first thing we do is respond 200 — Telegram will retry if we don't
// reply within a few seconds, so we acknowledge immediately and do the
// slow work (Gemini call, DB write) in the background.
// ---------------------------------------------------------------------------
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Acknowledge Telegram immediately

  const message = req.body?.message;
  if (!message?.text) return; // Ignore non-text messages (stickers, etc.)

  const text   = message.text.trim();
  const chatId = message.chat.id;

  // Pull out a URL if there is one, treat the rest as a note
  const urlMatch = text.match(/https?:\/\/[^\s]+/);
  const url      = urlMatch?.[0] ?? null;
  const notes    = url ? text.replace(url, '').trim() || null : null;

  // Decide the source based on what we received
  const source = url ? 'telegram_link' : 'idea';

  try {
    const enriched = await enrichContent(url, text);

    insertItem({
      id:         crypto.randomUUID(),
      url,
      source,
      raw_input:  text,
      notes,
      ...enriched,  // title, summary, content_type, topics, author, read_time_minutes, urgency
    });

    console.log(`Saved: "${enriched.title}"`);

    // Optional: send a confirmation back to your Telegram chat.
    // Uncomment this block once you've added TELEGRAM_BOT_TOKEN to your env.
    //
    // await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({
    //     chat_id: chatId,
    //     text: `✓ Saved: "${enriched.title}"\n${enriched.summary}`,
    //   }),
    // });

  } catch (err) {
    console.error('Failed to process message:', err.message);
  }
});

// ---------------------------------------------------------------------------
// GET /items
// The frontend calls this to fetch your saved items.
// Supports optional query params: ?status=unread&urgency=urgent&topic=design
// ---------------------------------------------------------------------------
app.get('/items', (req, res) => {
  const { status, urgency, content_type, topic } = req.query;
  const items = getItems({ status, urgency, content_type, topic });
  res.json(items);
});

// ---------------------------------------------------------------------------
// PATCH /items/:id
// Update a specific item — e.g. mark as read, change urgency, add tags.
// The frontend sends only the fields it wants to change.
// Example body: { "status": "read", "rating": 4 }
// ---------------------------------------------------------------------------
app.patch('/items/:id', (req, res) => {
  try {
    updateItem(req.params.id, req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Health check — useful for Railway to confirm the server is running
// ---------------------------------------------------------------------------
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// ---------------------------------------------------------------------------
// Start
// Railway injects PORT automatically. Locally it defaults to 3000.
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Lakehouse server running on port ${PORT}`);
  console.log(`DB path: ${process.env.DB_PATH || './lakehouse.db'}`);
});