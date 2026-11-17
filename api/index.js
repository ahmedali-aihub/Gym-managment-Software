/**
 * The whole Express API, as one Vercel serverless function.
 *
 * Vercel routes every /api/* request here (see vercel.json), so the app and
 * the API deploy together from one push to one host. That was the goal:
 * one deployment, no second service, no monthly fee.
 *
 * THIS FILE IS PLAIN JAVASCRIPT, AND THAT IS THE WHOLE POINT.
 *
 * Given a .ts entry, Vercel compiles it with esbuild and inlines every
 * dependency into a single ESM file. Express, compression and jsonwebtoken
 * are CommonJS and call require() internally; in an ESM bundle require does
 * not exist, so the function throws at import — before Express can answer
 * anything — with:
 *
 *     Dynamic require of "buffer" is not supported
 *
 * Vercel surfaces that only as FUNCTION_INVOCATION_FAILED, because the throw
 * happens at module load rather than inside a request. safe-buffer is what
 * actually trips it, pulled in by all three packages, but it is not one bad
 * dependency: any CommonJS package does this.
 *
 * A .js entry is copied as-is instead, so Node resolves those packages from
 * node_modules at runtime exactly as it does locally. That is why this
 * imports the COMPILED app from dist/ rather than the TypeScript source —
 * vercel.json builds apps/api before the web app so dist/ exists.
 *
 * Changing this file back to TypeScript, or pointing it at src/, brings the
 * 500s back.
 *
 * WHY THERE IS A SERVER AT ALL, rather than the browser talking to Supabase
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
 * createApp() is deliberately separate from server.ts: the server adds a
 * listener and the background timers, neither of which a serverless function
 * can have. Those move to Vercel Cron — see vercel.json.
 */
import { createApp } from '@azf/api/dist/app.js';

export default createApp();
