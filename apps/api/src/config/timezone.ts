/**
 * Run the whole API on India time.
 *
 * Day boundaries are plain Date arithmetic — startOfDay(), endOfDay() and
 * addDays() in @azf/shared call setHours()/setDate() — and those use the
 * PROCESS timezone. A machine in India gives IST; Vercel gives UTC. Same
 * code, different answers: in production "today" ran from 05:30 to 05:29
 * IST, a payment taken at 1 AM was counted on the previous day, and a
 * 30-day plan starting 22/10 was stored as expiring at 05:29 on 21/11 — so
 * the profile and receipt said 21/11 while the registration form said 20/11.
 *
 * Node applies a change to process.env.TZ immediately, so setting it here —
 * app.ts imports this first, ahead of every module that touches a Date —
 * makes the deployed API compute exactly what local development does,
 * whatever the host is configured with.
 *
 * Deliberately imports nothing: a dependency evaluated before this line
 * would compute any module-level dates in the wrong zone.
 */
process.env.TZ = 'Asia/Kolkata';

export {};
