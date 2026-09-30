'use strict';
// Layer 1: cheap, deterministic parsing. Prefilter decides whether an e-mail is
// worth any further work; platform detection fills the obvious field; known PDF
// formats (RB Leipzig invoice, ported from the desktop app) produce a full
// result without an LLM call. Anything not fully parsed here goes to llm.js.

const PLATFORM_PATTERNS = [
  [/stubhub/i, 'Stubhub'],
  [/ticketmaster/i, 'Ticketmaster'],
  [/viagogo/i, 'Viagogo'],
  [/eventim/i, 'Eventim'],
  [/livenation|live\s*nation/i, 'Live Nation'],
  [/\baxs\b/i, 'AXS'],
  [/seetickets|see\s*tickets/i, 'See Tickets'],
  [/syncseats/i, 'SyncSeats'],
  [/tickets\.rs/i, 'Tickets.rs'],
  [/ticketportal/i, 'Ticketportal'],
  [/goout/i, 'GoOut'],
  [/rbleipzig|rb\s*leipzig|redbulls\.com/i, 'RB Leipzig'],
  [/chelseafc|chelsea\s*fc/i, 'Chelsea FC'],
  [/arsenal\.com|arsenal\s*fc/i, 'Arsenal FC'],
  [/tottenhamhotspur|spurs/i, 'Tottenham Hotspur'],
  [/mancity|manchester\s*city/i, 'Manchester City'],
  [/manutd|manchester\s*united/i, 'Manchester United'],
  [/liverpoolfc|liverpool\s*fc/i, 'Liverpool FC'],
  [/fcbayern|bayern/i, 'FC Bayern'],
  [/bvb|borussia\s*dortmund/i, 'Borussia Dortmund'],
  [/realmadrid/i, 'Real Madrid'],
  [/fcbarcelona/i, 'FC Barcelona']
];

// Marketplaces where the reseller SELLS. Every transactional mail from them is a sale
// (sold / delivered to buyer / payout), never a purchase. Names match the app.
const SALE_PLATFORMS = new Set(['Stubhub', 'Viagogo', 'SyncSeats']);
function isSalePlatform(name) {
  return SALE_PLATFORMS.has(canonicalPlatform(name));
}
// Normalize LLM spellings ("StubHub", "stubhub.com", "viagogo AG") to the app's names.
function canonicalPlatform(name) {
  if (!name) return name;
  for (const [re, canon] of PLATFORM_PATTERNS) if (re.test(name)) return canon;
  return name;
}
// Stage of a marketplace sale, from the subject line.
function saleStage(subject) {
  const s = subject || '';
  if (/cancel|zrušen|storniert|annul/i.test(s)) return 'cancelled';
  if (/payment processed|payout|paid|výplat|zahlung/i.test(s)) return 'paid';
  if (/delivered|doručen|zugestellt|confirmed (?:the )?transfer|transfer (?:was |has been )?(?:confirmed|completed)|successfully transferred/i.test(s)) return 'delivered';
  return 'sold';
}

function detectPlatform(from, subject) {
  const hay = `${from || ''} ${subject || ''}`;
  for (const [re, name] of PLATFORM_PATTERNS) if (re.test(hay)) return name;
  return null;
}

// Subject/sender keywords in the languages the reseller deals with. A mail must
// hit one of these (or come from a known platform) to be processed at all.
const KEYWORDS = /order|ticket|booking|confirm|receipt|invoice|purchase|payment|sold|sale|payout|listing|transfer|deliver|cancel|refund|vstupenk|objedn|potvrz|faktur|prodej|nákup|platb|zaplacen|bestell|rechnung|karten|entrada|pedido|compra|biglietti|ordine|billet|commande|reserv|thank you for your|danke für|gracias por/i;
// Obvious junk even if a keyword appears.
// Account creation / security mails (all languages the account generators hit),
// marketing and our own digests. These never contain an order.
const JUNK = new RegExp([
  'unsubscribe from', 'newsletter', 'password reset', 'reset your password', 'verify your', 'verification code',
  'authenti(?:c|f)', 'c[oó]digo de', 'ověřovací', 'overovac', 'bestätig(?:e|ung) (?:deine|ihre) e-?mail', 'code de v[ée]rification',
  '\\b2fa\\b', 'two-factor', 'one-time', '\\botp\\b', 'sign-?in (?:code|attempt)', 'new (?:device|login)',
  'welcome to', 'willkommen', 'bienvenid', 'bienvenue', 'benvenut', 'vítejte', 'vitajte', 'witamy',
  'price alert', 'price drop', 'recommended for you', "don'?t miss", "don’t miss", 'last chance', 'last remaining',
  'presales?\\b', 'pre-?sale', 'prevente', 'now on sale', 'on sale now', 'tickets on sale', 'we miss you',
  'survey', 'feedback', 'rate your', '% off', '\\bsale\\s*[|:]', 'sleva', 'slevou', 'rabatt', 'descuento', 'jusqu', 'exclusive \\|',
  'a la venta', 'en venta', 'get tickets', 'ticket bulletin', 'nuevas entradas', 'new dates', 'jetzt tickets',
  'your new listing', 'listing (?:is )?(?:live|created|updated|expired|expiring)', 'price your tickets',
  'položek k vyřešení', 'k dořešení'
].join('|'), 'i');

function prefilter(mail) {
  const subject = mail.subject || '';
  const from = mail.from || '';
  const platform = detectPlatform(from, subject);
  if (JUNK.test(subject)) return { pass: false, reason: 'junk-subject', platform };
  // A known platform alone is not enough (they send lots of marketing); the
  // subject must also look transactional.
  if (KEYWORDS.test(subject)) return { pass: true, reason: platform ? 'platform+keyword' : 'keyword', platform };
  const hasPdf = (mail.attachments || []).some(a => /pdf/i.test(a.contentType || '') || /\.pdf$/i.test(a.filename || ''));
  if (hasPdf && KEYWORDS.test(`${(mail.text || '').slice(0, 2000)}`)) return { pass: true, reason: 'pdf+keyword', platform };
  return { pass: false, reason: 'no-keyword', platform };
}

// ---- RB Leipzig invoice PDF (ported 1:1 from main.js) ----------------------------
function pdfToISO(dmy) { const m = dmy.match(/(\d{2})\.(\d{2})\.(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; }
function pdfSplitQtyUnit(blob, total) {
  const dot = String(blob).replace(',', '.');
  const intPart = dot.split('.')[0];
  const decPart = dot.includes('.') ? dot.slice(intPart.length) : '';
  for (let k = 1; k < intPart.length; k++) {
    const qty = parseInt(intPart.slice(0, k), 10);
    const unit = parseFloat(intPart.slice(k) + decPart);
    if (qty > 0 && total != null && Math.abs(qty * unit - total) < 0.02) return { qty, unit };
  }
  return { qty: null, unit: parseFloat(dot) };
}
function parseLeipzigInvoice(rawText) {
  const text = String(rawText).replace(/-\n/g, '-');
  let m = text.match(/RB Leipzig\s*-\s*([^\/\n]+?)\s*\/\s*(\d{2}\.\d{2}\.\d{4})\s*\/\s*(\d{1,2}:\d{2})/i);
  if (!m) return null;
  const away = m[1].trim();
  const out = {
    platform: 'RB Leipzig', event: `RB Leipzig v ${away}`, venue: 'Red Bull Arena',
    eventDate: pdfToISO(m[2]), eventTime: m[3], currency: 'EUR',
    section: null, row: null, seat: null, quantity: null, pricePerTicket: null, totalAmount: null, orderId: null
  };
  m = text.match(/Order number\s*:?\s*(\d+)/i); if (m) out.orderId = m[1];
  m = text.match(/Total\s*:\s*([\d.,]+)\s*EUR/i); if (m) out.totalAmount = parseFloat(m[1].replace(',', '.'));
  m = text.match(/(\d+\s+[A-Za-zäöüÄÖÜß][A-Za-zäöüÄÖÜß\-\. ]*?(?:Fanbereich|bereich|Tribüne|Block|Stand|Kurve))/);
  if (m) out.section = m[1].replace(/\s+/g, ' ').trim();
  let lineTotal = null;
  m = text.match(/(\d+)\s*[–-]\s*(\d+)\s*([A-Za-zäöüÄÖÜß]+)\s*(\d[\d.,]*)\s*EUR\s*([\d.,]+)\s*EUR/);
  if (m) {
    const rowSeatStart = m[1];
    const seatEnd = parseInt(m[2], 10);
    lineTotal = parseFloat(m[5].replace(',', '.'));
    const qu = pdfSplitQtyUnit(m[4], lineTotal);
    out.quantity = qu.qty; out.pricePerTicket = qu.unit;
    if (out.quantity) {
      const seatStart = seatEnd - out.quantity + 1;
      out.seat = `${seatStart}-${seatEnd}`;
      const ss = String(seatStart);
      out.row = rowSeatStart.endsWith(ss) ? rowSeatStart.slice(0, -ss.length) : rowSeatStart;
    } else { out.seat = String(seatEnd); out.row = rowSeatStart; }
  }
  if (!out.totalAmount) out.totalAmount = lineTotal;
  return out;
}

// Try every deterministic parser on the mail text and on PDF attachment text.
// Returns { kind, ...fields, confidence, parser } or null.
async function runDeterministicParsers(mail) {
  const texts = [];
  for (const a of mail.attachments || []) {
    if (!(/pdf/i.test(a.contentType || '') || /\.pdf$/i.test(a.filename || ''))) continue;
    try {
      const pdfParse = require('pdf-parse/lib/pdf-parse.js');
      const data = await pdfParse(a.content);
      if (data.text) texts.push(data.text);
    } catch (e) { console.warn('[parsers] pdf-parse failed:', e.message); }
  }
  for (const t of texts) {
    const r = parseLeipzigInvoice(t);
    if (r && r.event && r.eventDate && r.quantity && r.totalAmount) {
      return { kind: 'purchase', relevant: true, confidence: 0.95, parser: 'rb-leipzig-pdf', ...r };
    }
  }
  return null;
}

module.exports = { detectPlatform, prefilter, runDeterministicParsers, parseLeipzigInvoice, isSalePlatform, canonicalPlatform, saleStage };
