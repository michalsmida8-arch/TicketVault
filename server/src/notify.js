'use strict';
// Outbound notifications: Discord webhook, Pushover, SMTP e-mail.
// Each returns { sent: boolean, error?: string } and never throws.
const cfg = require('./config');

async function discord(webhook, text) {
  if (!webhook) return { sent: false, error: 'no webhook' };
  try {
    const res = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: text.slice(0, 1900) }) });
    if (!res.ok) return { sent: false, error: `HTTP ${res.status}` };
    return { sent: true };
  } catch (e) { return { sent: false, error: e.message }; }
}

async function pushover(userKey, token, title, message) {
  if (!userKey || !token) return { sent: false, error: 'missing keys' };
  try {
    const body = new URLSearchParams({ token, user: userKey, title: title.slice(0, 250), message: message.slice(0, 1000) });
    const res = await fetch('https://api.pushover.net/1/messages.json', { method: 'POST', body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.status !== 1) return { sent: false, error: (data.errors || []).join(', ') || `HTTP ${res.status}` };
    return { sent: true };
  } catch (e) { return { sent: false, error: e.message }; }
}

let transporter = null;
async function email(to, subject, text) {
  if (!cfg.SMTP) return { sent: false, error: 'SMTP not configured' };
  if (!to) return { sent: false, error: 'no recipient' };
  try {
    if (!transporter) {
      const nodemailer = require('nodemailer');
      transporter = nodemailer.createTransport({ host: cfg.SMTP.host, port: cfg.SMTP.port, secure: cfg.SMTP.secure, auth: { user: cfg.SMTP.user, pass: cfg.SMTP.pass } });
    }
    const info = await transporter.sendMail({ from: cfg.SMTP.from, to, subject, text });
    return { sent: true, messageId: info.messageId };
  } catch (e) { return { sent: false, error: e.message }; }
}

// Instant push to whatever channels the user enabled (used for new inbox items).
async function pushToUser(user, title, message) {
  const jobs = [];
  if (user.discordEnabled && user.discordWebhook) jobs.push(discord(user.discordWebhook, `**${title}**\n${message}`));
  if (user.pushoverEnabled && user.pushoverUser && user.pushoverToken) jobs.push(pushover(user.pushoverUser, user.pushoverToken, title, message));
  const results = await Promise.all(jobs);
  return results;
}

module.exports = { discord, pushover, email, pushToUser };
