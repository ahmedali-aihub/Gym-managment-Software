# WhatsApp

## How it works today (free, nothing to set up)

The desk sends WhatsApp messages from **its own WhatsApp**: the app opens
the member's chat with the message already typed, and you press **Send**.

| When | Email (automatic) | WhatsApp (you press Send) |
|---|---|---|
| A member is registered | Welcome, with the receipt PDF attached | Welcome, with a link to the receipt |
| A payment is recorded | Receipt PDF | Thank-you, with a link to the receipt |
| **Send reminder** on a profile | Reminder | Renewal or dues reminder |

The profile also has **Welcome on WhatsApp**, and a **WhatsApp** link beside
every receipt, to send them again.

On a computer, choose **WhatsApp Web** or the **WhatsApp app** in the
dialog that appears; the choice is remembered. WhatsApp Web must be signed
in (scan its QR code once with the gym phone).

**Why a link and not an attached PDF:** WhatsApp does not let any website
attach a file to a message it opens. The link opens the member's own
receipt; it is signed, so it cannot be guessed or changed to open someone
else's.

**Two limits of this method:** someone has to press Send, and reminders to
many members at once cannot be sent this way (the bulk reminder sends
email only). For fully automatic messages with the PDF attached, and bulk
WhatsApp, connect WhatsApp Business as described below. Once connected, the
app sends everything itself and stops opening WhatsApp for the desk.

**Optional:** set `RECEIPT_LINK_SECRET` in Vercel to a random string of 32+
characters. Receipt links are signed with it; without it they are signed
with a key derived from `JWT_REFRESH_SECRET`, so changing that secret would
break links already sent.

---

# Connecting WhatsApp Business (optional, for automatic sending)

The app talks to WhatsApp through Meta's official **WhatsApp Cloud API**.
There is no monthly fee from Meta, only a small charge per message (about
₹0.14 with GST for these messages); see
[Meta's pricing page](https://developers.facebook.com/docs/whatsapp/pricing).

Once connected, each new member automatically gets, straight after
registration:

- a **WhatsApp** welcome with their member ID, plan, expiry date and the
  **receipt PDF attached**, and
- the **email** welcome with the same receipt PDF (if they gave an email).

Every payment recorded later also sends the receipt PDF on WhatsApp.

---

## 1. What you need

1. A **Facebook account** for the gym owner.
2. A **phone number for WhatsApp**:
   - **Easiest:** a new SIM that has never been on WhatsApp. You only need it
     to receive one verification code (SMS or call).
   - Your current gym number cannot be used if it is on **regular**
     WhatsApp, unless you first delete that WhatsApp account (you lose its
     chats).
   - If the gym number is on the **WhatsApp Business app**, Meta's
     "coexistence" option may let you keep the app and use the API on the
     same number. Check whether Meta offers it to you during setup.
3. A **debit/credit card**, added in Meta for message charges.

## 2. Create the WhatsApp app (about 20 minutes)

1. Go to <https://developers.facebook.com> and click **My Apps → Create App**.
2. Choose the use case for **WhatsApp** / business messaging. Name it
   "A to Z Fitness", then create or select your **business portfolio**.
3. Open **WhatsApp → API Setup**. Click **Add phone number**, enter the
   business display name ("A to Z Fitness") and the number from step 1, then
   enter the verification code.
4. On the same page, copy the **Phone number ID** (a long number). You will
   need it in step 5.

## 3. Create a permanent access token

The token shown on the API Setup page expires after 24 hours. Do not use it.

1. Go to <https://business.facebook.com> → **Settings → Users → System
   users** and click **Add**. Choose the name "azf-server" and role **Admin**.
2. Click **Assign assets**. Add your **app** (full control) and your
   **WhatsApp account** (full control).
3. Click **Generate token**. Choose your app, set expiry to **Never**, and
   tick:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
4. Copy the token and keep it private, like a password.

## 4. Create the message templates

WhatsApp only allows businesses to start a conversation with a **template**
that Meta has approved. Create each one below in **WhatsApp Manager →
Message templates → Create template**:

- **Category:** Utility
- **Language:** English
- **Name:** exactly as written below
- **Text:** copy it exactly, including the `{{1}}`-style placeholders
- **Footer / buttons:** none

Templates ending in **`_pdf`** need **Header → Media → Document**. When Meta
asks for a sample file, upload any receipt PDF from the app (member profile →
Payments → Receipt).

| Template name | Header | Used when |
|---|---|---|
| `azf_welcome_pdf` | Document | A new member pays at registration (most registrations) |
| `azf_welcome` | None | A new member registers with ₹0 paid ("pay later") |
| `azf_payment_receipt_pdf` | Document | Any payment recorded on a member's profile |
| `azf_payment_receipt` | None | Only if a payment has no receipt (rare; optional) |
| `azf_expiry_reminder` | None | Expiry reminders sent from the app |
| `azf_payment_due` | None | Dues reminders sent from the app |

**Welcome** (`azf_welcome_pdf` and `azf_welcome`, same text):

```text
Welcome to {{1}}, {{2}}! Your member ID is {{3}}. Plan: {{4}}, valid until {{5}}. Amount paid: Rs. {{6}}. For any questions, call us on {{7}}. See you at the gym!
```

Sample values: `A to Z Fitness`, `Rahul`, `6374`, `Monthly`, `20/11/2026`,
`1,500`, `+91 98765 43210`

**Payment receipt** (`azf_payment_receipt_pdf` and `azf_payment_receipt`,
same text):

```text
Thank you, {{1}}! We have received Rs. {{2}} on {{3}} via {{4}}. Receipt number: {{5}}. Balance due: Rs. {{6}}. Team {{7}} wishes you a great workout!
```

Sample values: `Rahul`, `1,500`, `22/10/2026`, `UPI`, `RCPT/2026-27/0035`,
`0`, `A to Z Fitness`

**Expiry reminder** (`azf_expiry_reminder`):

```text
Hi {{1}}, your {{2}} membership ({{3}}) expires on {{4}}. Renew to keep training without a break. Call us on {{5}} to renew today.
```

Sample values: `Rahul`, `A to Z Fitness`, `6374`, `20/11/2026`,
`+91 98765 43210`

**Payment due** (`azf_payment_due`):

```text
Hi {{1}}, your account {{2}} has a pending balance of Rs. {{3}}. Please settle it on your next visit to {{4}}. Questions? Call us on {{5}} anytime.
```

Sample values: `Rahul`, `6374`, `500`, `A to Z Fitness`, `+91 98765 43210`

Approval usually takes from a few minutes to a day. Wait until each template
shows **Active – Quality pending** or **Approved**.

## 5. Turn it on in Vercel

In Vercel → your project → **Settings → Environment Variables**
(Production), set:

| Name | Value |
|---|---|
| `WHATSAPP_PROVIDER` | `meta` |
| `WHATSAPP_PHONE_NUMBER_ID` | the Phone number ID from step 2 |
| `WHATSAPP_ACCESS_TOKEN` | the token from step 3 (mark it **Sensitive**) |
| `WHATSAPP_API_VERSION` | `v25.0`. The old value, `v21.0`, stops working on 21 January 2027. |
| `WHATSAPP_LANGUAGE` | `en` (English, as chosen for the templates) |
| `WHATSAPP_ENABLED` | `true` |
| `GYM_PHONE` | the gym's real phone number. It is printed in every welcome and reminder; it is still `+91 00000 00000`. |

Then go to **Deployments**, open the latest deployment's **⋯** menu and click
**Redeploy**. Settings only take effect after a redeploy.

## 6. Check it works

1. In the app, open **Settings**. The WhatsApp card should say
   *connected as A to Z Fitness (+91 …)*.
2. Register **yourself** as a test member, with your own mobile number, an
   email address and an amount paid. Within a few seconds you should get:
   - a WhatsApp welcome with the receipt PDF attached, and
   - an email with the same receipt.
3. Delete the test member afterwards.

## If something fails

Open the **Messages** page. A failed WhatsApp message shows the reason in
plain English, and **Retry** sends it again once the cause is fixed.

| Message | What to do |
|---|---|
| Template not found or not approved yet | Check the name matches exactly and wait for approval. |
| The message does not match its approved template… | A `_pdf` template must have a **Document** header; the others must have none. |
| Access token expired or invalid | Create the permanent token again (step 3). |
| This number cannot receive WhatsApp messages | The member's number is not on WhatsApp. Correct it with **Edit details**. |
| Receipt upload failed… | Usually temporary; it retries automatically. |
