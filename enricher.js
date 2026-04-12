import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

const CONTENT_TYPES = ['article', 'video', 'podcast', 'thread', 'tool', 'idea', 'paper', 'newsletter', 'recipe', 'other'];
const URGENCY_OPTS  = ['urgent', 'few_weeks', 'someday', 'evergreen'];

// ---------------------------------------------------------------------------
// fetchPageText
// Grabs the raw HTML of a URL and strips it down to readable text.
// We only take the first 3000 characters — enough for Gemini to understand
// the content without blowing up the token count or hitting rate limits.
// ---------------------------------------------------------------------------
async function fetchPageText(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LakehouseBot/1.0)' },
      signal: AbortSignal.timeout(8000), // Give up after 8 seconds
    });
    const html = await res.text();

    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')  // remove JS
      .replace(/<style[\s\S]*?<\/style>/gi, '')     // remove CSS
      .replace(/<[^>]+>/g, ' ')                     // strip all tags
      .replace(/\s+/g, ' ')                         // collapse whitespace
      .trim()
      .slice(0, 3000);
  } catch {
    // If the fetch fails (paywalled, timeout, bot-blocked), we still continue.
    // Gemini will do its best with just the URL and the user's raw message.
    return '';
  }
}

// ---------------------------------------------------------------------------
// enrichContent
// The core function. Takes the URL (if any) and the raw Telegram message,
// fetches the page, and asks Gemini to classify and summarise everything.
// Returns a plain object ready to be inserted into SQLite.
// ---------------------------------------------------------------------------
export async function enrichContent(url, rawText) {
  const pageContent = url ? await fetchPageText(url) : '';

  const prompt = `You are a classifier for a personal content bookmarking system.

Analyse the item below and return ONLY a valid JSON object — no markdown fences, no explanation, no extra text.

URL: ${url || 'none'}
User message: ${rawText}
Page content preview: ${pageContent || 'not available'}

Return exactly this JSON shape:
{
  "title": "a concise title, max 10 words",
  "summary": "exactly one sentence — what is this and why would someone save it",
  "content_type": <one of ${JSON.stringify(CONTENT_TYPES)}>,
  "topics": ["2 to 4 broad topic strings, e.g. design, productivity, AI"],
  "author": "author or creator name, or null",
  "read_time_minutes": <estimated integer, or null if not applicable>,
  "urgency": <one of ${JSON.stringify(URGENCY_OPTS)}>
}`;

  const result = await model.generateContent(prompt);
  let text = result.response.text().trim();

  // Gemini sometimes wraps the JSON in ```json ... ``` even when told not to.
  // Strip those fences if present.
  text = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '');

  return JSON.parse(text);
}