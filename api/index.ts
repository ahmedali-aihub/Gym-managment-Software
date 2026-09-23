/**
 * The whole Express API, as one Vercel serverless function.
 *
 * Vercel routes every /api/* request here (see vercel.json), so the app and
 * the API deploy together from one push to one host. That was the goal:
 * one deployment, no second service, no monthly fee.
 *
 * WHY THIS STILL EXISTS AT ALL, rather than the browser talking to Supabase
 * directly. Three things cannot move into a browser:
 *
 *   • Secrets. SMTP_PASSWORD and WHATSAPP_ACCESS_TOKEN would ship to every
 *     visitor in the JavaScript bundle. Anyone could then send email as the
 *     gym, and Google would suspend the account.
 *
 *   • Gap-free receipt numbers. The sequence is allocated under a database
 *     row lock; two receptionists taking payment in the same second get
 *     0007 and 0008. Read-then-write from two browsers gives both 0007.
 *
 *   • The audit trail. An entry the client could choose not to write is not
 *     an audit trail.
 *
 * `createApp()` is deliberately separate from `server.ts`: the server adds
 * a listener and the background timers, neither of which a serverless
 * function can have. Those move to Vercel Cron — see vercel.json.
 */
import { createApp } from '../apps/api/src/app.js';

export default createApp();
