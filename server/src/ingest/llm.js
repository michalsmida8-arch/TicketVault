'use strict';
// Claude extraction: turns an e-mail (+ PDF attachments) into the fixed schema the
// app's inbox understands. Uses structured outputs, so the response is always a
// valid object or null. Few-shot corrections in data/examples.json are prepended
// so the model learns from what the user fixed in the review queue.
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { z } = require('zod');
const { zodOutputFormat } = require('@anthropic-ai/sdk/helpers/zod');
const cfg = require('../config');

const ExtractionSchema = z.object({
  relevant: z.boolean().describe('true only if this e-mail is about a ticket purchase, ticket sale, ticket delivery, cancellation or refund'),
  kind: z.enum(['purchase', 'sale', 'delivery', 'cancellation', 'refund', 'transfer', 'other'])
    .describe('purchase = we bought tickets; sale = we sold tickets on a marketplace (buyer paid us); delivery = tickets/e-tickets for an existing order arrived; transfer = ticket transfer request/confirmation'),
  platform: z.string().describe('Seller/marketplace/club name, e.g. Ticketmaster, Stubhub, Viagogo, Eventim, Chelsea FC, RB Leipzig'),
  event: z.string().describe('Event name as written, e.g. "Arsenal v Chelsea" or "Coldplay"'),
  eventDate: z.string().describe('YYYY-MM-DD'),
  eventTime: z.string().describe('HH:MM 24h'),
  venue: z.string(),
  section: z.string().describe('Block/sector/stand'),
  row: z.string(),
  seat: z.string().describe('Seat numbers; multiple joined by ", "'),
  quantity: z.number().int().nullable(),
  pricePerTicket: z.number().nullable(),
  totalAmount: z.number().nullable().describe('What we paid (purchase) or what we receive net of fees (sale)'),
  grossSubtotal: z.number().nullable().describe('For sales: what the buyer paid before marketplace fees'),
  currency: z.string().describe('ISO 4217, e.g. EUR, GBP, CZK'),
  orderId: z.string().describe('Order / booking / reference number'),
  listingId: z.string().describe('Marketplace listing ID if stated (Stubhub/Viagogo "listing", "Inserat"), else ""'),
  purchaseDate: z.string().describe('YYYY-MM-DD of the order, if stated'),
  buyerName: z.string().describe('For sales: buyer name if stated'),
  buyerEmail: z.string(),
  accountEmail: z.string().describe('The mailbox address the e-mail was addressed to'),
  confidence: z.number().min(0).max(1).describe('How sure you are that the key fields (event, date, quantity, price) are right'),
  notes: z.string().describe('Anything the reviewer should know: ambiguities, missing fields, multiple orders in one mail')
});

const SYSTEM = `You extract structured data from e-mails received by a ticket reseller who buys football and concert tickets (Premier League clubs, Bundesliga clubs, Ticketmaster, Eventim, Live Nation, AXS, See Tickets...) and resells them on marketplaces (Stubhub, Viagogo, SyncSeats, Tickets.rs...).

Rules:
- Set relevant=false for newsletters, marketing, password resets, account notices, listing views, price alerts, and anything that is not a concrete order, sale, delivery, cancellation or refund.
- "purchase": the reseller bought tickets (order confirmation / receipt / invoice from a club or primary seller).
- "sale": a marketplace tells the reseller their listing sold and a buyer paid. totalAmount is the reseller's payout (net), grossSubtotal what the buyer paid, if both appear.
- Marketplaces (Stubhub, Viagogo, SyncSeats, Tickets.rs, Ticombo...) are where the reseller SELLS. Seller-side notices from them ("your tickets sold", "your tickets were delivered for order #", "payment/payout sent", "confirm your sale") are kind "sale", with totalAmount = the reseller's payout. Only use "purchase" for a marketplace when the reseller clearly bought as a buyer.
- "delivery": e-tickets/PDFs/mobile tickets/transfer links for tickets the reseller BOUGHT earlier (from a club or primary seller). Still fill orderId and event so it can be matched.
- Dates: convert to YYYY-MM-DD. If only day and month are given, infer the year from the e-mail date (events are in the future relative to the order).
- Prices: numbers only, no currency symbols; currency as ISO code (£ -> GBP, € -> EUR, Kč -> CZK, $ -> USD, zł -> PLN).
- quantity is the number of tickets in this order. If seats are listed individually, count them.
- Never invent values. When a text field is not present use an empty string ""; when a number is not present use null. Put doubts into notes and lower confidence.
- If one e-mail contains several orders, extract the first and say so in notes.`;

let client = null;
function getClient() {
  // Explicit base URL: never inherit ANTHROPIC_BASE_URL from whatever shell launched us
  // (e.g. a developer tool's proxy). Override only via TV_ANTHROPIC_BASE_URL in .env.
  if (!client) client = new Anthropic({ baseURL: process.env.TV_ANTHROPIC_BASE_URL || 'https://api.anthropic.com' });
  return client;
}

function loadExamples() {
  try {
    const p = path.join(cfg.DATA_DIR, 'examples.json');
    if (!fs.existsSync(p)) return [];
    const list = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(list) ? list.slice(-12) : [];
  } catch { return []; }
}

function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '\n[...truncated...]' : s; }

// mail: { from, to, subject, date, text, html, attachments:[{filename, contentType, content(Buffer)}] }
async function extractFromMail(mail) {
  const content = [];
  const pdfs = (mail.attachments || []).filter(a => /pdf/i.test(a.contentType || '') || /\.pdf$/i.test(a.filename || ''))
    .filter(a => a.content && a.content.length < 8 * 1024 * 1024).slice(0, 3);
  for (const a of pdfs) {
    content.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: a.content.toString('base64') },
      title: a.filename || 'attachment.pdf'
    });
  }
  const body = mail.text && mail.text.trim().length > 40 ? mail.text : htmlToText(mail.html || '') || mail.text || '';
  content.push({
    type: 'text',
    text: `E-mail received ${mail.date ? new Date(mail.date).toISOString() : 'unknown date'}
From: ${mail.from || ''}
To: ${mail.to || ''}
Subject: ${mail.subject || ''}

${truncate(body, 60000)}`
  });

  const examples = loadExamples();
  const messages = [];
  for (const ex of examples) {
    messages.push({ role: 'user', content: `Subject: ${ex.subject}\n\n${truncate(ex.body, 4000)}` });
    messages.push({ role: 'assistant', content: JSON.stringify(ex.output) });
  }
  messages.push({ role: 'user', content });

  const response = await getClient().messages.parse({
    model: cfg.CLAUDE_MODEL,
    max_tokens: 4000,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: { format: zodOutputFormat(ExtractionSchema), effort: 'low' },
    messages
  });
  if (response.stop_reason === 'refusal') throw new Error('Model refused: ' + (response.stop_details?.explanation || ''));
  if (!response.parsed_output) throw new Error('Model returned no structured output (stop_reason=' + response.stop_reason + ')');
  return { data: response.parsed_output, usage: response.usage, model: response.model };
}

// Good enough HTML -> text for order mails (tables, links). Not a full renderer.
function htmlToText(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d|table)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&pound;/g, '£').replace(/&euro;/g, '€')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

module.exports = { extractFromMail, htmlToText, ExtractionSchema };
