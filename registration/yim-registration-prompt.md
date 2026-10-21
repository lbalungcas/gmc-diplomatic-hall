---
title: YIM Registration & QR Check-in System — Claude Code Build Prompt
project: Youth Innovations Marketplace
event_date: 2026-11-17
tags: [claude-code, prompt, registration, supabase, qr-checkin]
---

# Build: Event Registration, Approval & QR Check-in System

You are building a Luma-style registration system for a real event that happens on **17 November 2026**. Work in phases, confirm the plan with me before writing code, and ask me any blocking questions up front (see "Questions to ask me first" at the bottom).

## 1. Context

**Event:** Youth Innovations Marketplace — *Scalable Solutions to End Violence Against Children*
- Satellite event of the 2nd Global Ministerial Conference on Ending Violence Against Children (EVAC)
- **Date/time:** 17 Nov 2026, 9:00 AM – 5:00 PM (Asia/Manila, UTC+8). Registration desk opens 9:00 AM.
- **Venue:** Diplomatic Hall, Marriott Hotel Manila, Newport World Resorts, Pasay City
- **Capacity:** ~200 attendees
- **Co-conveners:** Violence Ends With Us (VEWU), Terre des Hommes Netherlands, Kindernothilfe
- **Existing site:** https://youthinnovationsmarketplace.org/ (React + Vite build, Netlify). It currently links to a Google Form for "Pre-Registration to the General Public" — this system replaces that link.
- **Audience:** ministers and senior government officials, donors/development partners, CSOs, youth innovators (some aged 13–17), media, general public.

**Safeguarding matters here.** Some registrants are minors and this is a child-protection event. Treat personal data accordingly (see §7).

## 2. What I want (the user flows)

### A. Participant
1. Opens the registration page (public, mobile-first, matches the main site's branding).
2. Fills in the form → submits.
3. Immediately receives a **"Registration pending"** email (see §5). It contains **no QR code**, only confirmation that the request was received and is under review.
4. Status starts as **Pending**. When an admin approves, they receive the **"You're confirmed"** email with their **personal QR code**, ticket page link and .ics file. If declined, they receive a decline email.
5. The ticket page (`/t/:token`) shows their name, event details and current status (Pending / Confirmed / Declined / Checked in). The QR code and "Add to calendar" button appear **only once approved**; while pending, the page shows "Your registration is under review."

### B. Admin (dashboard)
1. Logs in (no public sign-up; admins are allow-listed).
2. Sees live stats: total registered, pending, approved, declined, waitlisted, checked in, remaining capacity — with a breakdown by participant category.
3. Table of registrants with search (name/email/org), filters (status, category, country, checked-in), sort, and pagination.
4. Approve / Decline each registrant (optional decline reason), plus **bulk approve/decline** for selected rows.
5. Registrant detail drawer: all fields, status history, email delivery log, "Resend email" button.
6. Manual check-in (search by name for people without their phone) and **undo check-in**.
7. Export CSV (all fields + check-in time). Import CSV (to bring in existing Google Form pre-registrations).
8. Event settings: capacity, registration open/close, auto-waitlist when full. Capacity counts **approved** registrants only.

### C. Door staff (scanner)
1. Logs in with a **Scanner** role (can check people in, cannot approve/decline or export).
2. Opens `/admin/scan` on a phone → camera opens and scans continuously.
3. Each scan shows a full-screen result for ~2 seconds, then resumes:
   - 🟢 **Checked in** — name, organization, category (Approved, first scan)
   - 🟡 **Already checked in** — name + time of first check-in
   - 🔴 **Not approved** — Pending or Declined (show which), do not check in
   - 🔴 **Invalid / unknown code**
4. Sound + vibration feedback per result. Manual code entry fallback if the camera fails.
5. A running counter at the top: "142 / 200 checked in".

## 3. Recommended stack (adjust only with a reason)

- **Frontend:** React + TypeScript + Vite + Tailwind CSS (same as the main site), React Router.
- **Backend/DB/Auth:** Supabase (Postgres, Auth with email magic link for admins, Row Level Security, Edge Functions).
- **Email:** Resend (send from a verified domain on youthinnovationsmarketplace.org with SPF/DKIM set up). Wrap it in a small email service module so the provider can be swapped.
- **QR generation:** `qrcode` (server-side PNG in the Edge Function).
- **QR scanning:** `@yudiel/react-qr-scanner` or `html5-qrcode` (pick one, justify briefly).
- **Bot protection:** Cloudflare Turnstile on the public form.
- **Hosting:** Netlify. Deploy at a subdomain like `register.youthinnovationsmarketplace.org` (or a `/register` path — ask me).

## 4. Data model (starting point — refine it)

- `events` — id, slug, name, starts_at, ends_at, timezone, venue, capacity, registration_opens_at, registration_closes_at, auto_waitlist (bool). Design for multiple events, but the MVP only needs the 17 Nov event.
- `registrations` — id, event_id, ticket_token (unique, random, unguessable — ≥128 bits, **not** the row id), status (`pending` | `approved` | `declined` | `waitlisted` | `cancelled`), full_name, email (unique per event, case-insensitive), phone (optional), organization, role_title, category, country, age_group (`13–17` | `18–24` | `25+`), guardian_name + guardian_email + guardian_consent (required if 13–17), dietary_needs, accessibility_needs, photo_consent (bool), privacy_consent (bool, required), decline_reason, created_at, decided_at, decided_by, checked_in_at, checked_in_by.
- `admin_users` — user_id, email, role (`admin` | `scanner`), active.
- `email_log` — registration_id, type (`pending` | `approved` | `declined` | `waitlisted` | `resend`), provider_message_id, status, error, sent_at.
- `audit_log` — actor, action, registration_id, before/after, at. Log every approve, decline, check-in, undo, export.

**Participant categories:** Government / Ministry, Development Partner / Donor, Civil Society / NGO, Youth Innovator (booth team), Youth Delegate, Academe, Private Sector, Media, General Public.

## 5. Emails

All emails: plain, branded HTML that renders in Gmail, Outlook and mobile; include a plain-text version; event name, date, time, venue + map link; contact for questions.

This is an **approval-first** flow (like Luma events that require approval): the QR code is only ever sent after an admin approves.

1. **Registration pending** (sent immediately on submit) — subject like "Your registration is pending — Youth Innovations Marketplace". Says the request was received, is being reviewed by the organizers, and that they'll get another email with their QR ticket once approved. Summarize what they submitted (name, organization, category) and include the ticket page link so they can check status. **No QR code.**
2. **Approved** — "You're confirmed" + QR code + ticket link + .ics attachment + what to bring / arrival time. This is the only email that carries the QR.
3. **Declined** — polite message, optional reason, contact info.
4. **Waitlisted** — if capacity is full. If later approved, they receive the normal Approved email with the QR.

"Resend email" in the admin resends whichever email matches the current status (pending → pending email, approved → QR ticket).

**QR in email:** attach as an inline PNG (CID), not a `data:` URI — Gmail strips those. Always include the ticket page link as a fallback.

## 6. QR & check-in logic

- The QR encodes a URL: `https://<domain>/t/<ticket_token>`. If a participant scans their own code with their phone camera, it opens their ticket page. No personal data in the QR itself.
- The admin scanner extracts the token and calls a single **atomic** check-in function (Postgres RPC or Edge Function) that:
  - verifies the caller has `admin` or `scanner` role,
  - looks up the token,
  - checks in only if status is `approved` and `checked_in_at` is null (use a conditional `UPDATE … WHERE checked_in_at IS NULL RETURNING …` so two phones scanning the same code can't double check-in),
  - returns a typed result: `checked_in` | `already_checked_in` | `not_approved` | `invalid`, plus minimal display info.
- The scanner must work on Android Chrome and iOS Safari over HTTPS. Venue Wi-Fi may be weak — keep the scan payload tiny and test on mobile data.
- Stretch (only if time allows): offline queue that stores scans locally and syncs when back online.

## 7. Security, privacy & safeguarding (non-negotiable)

- **RLS on every table.** The public cannot read any registration data. Public writes go only through an Edge Function that validates input, verifies Turnstile, rate-limits per IP/email, and rejects duplicates gracefully ("You're already registered — we've resent your ticket").
- Ticket page by token shows only that person's own data (name, status, QR). No listing, no enumeration.
- Admin routes protected client-side **and** server-side; scanner role cannot see emails/phones or export.
- Consent: required checkbox for data privacy (Philippines Data Privacy Act, RA 10173) with a short privacy notice explaining what's collected, why, who sees it, and retention. Separate optional photo/filming consent (the event follows ethical consent protocols for photography). For 13–17, require guardian name, email and consent.
- Show photo-consent status in the scanner result and admin table so media/badging teams can respect it.
- Never put personal data in URLs or query strings except the opaque token.
- Secrets (Supabase service key, Resend key, Turnstile secret) only in Edge Function env vars, never in the frontend bundle. Provide a `.env.example`.
- Add a data-retention note in the README (e.g. delete or anonymize registrations X days after the event — ask me for X).

## 8. Design

- Match the main site: pull colors, fonts and logo from https://youthinnovationsmarketplace.org/ (inspect its CSS/assets) or ask me for brand tokens. Keep the co-convener logos in the footer.
- Mobile-first. The registration form must be fast and accessible (labels, focus states, keyboard nav, good contrast, clear errors). Group the form into short sections.
- Scanner UI: huge, high-contrast result screens readable at arm's length in a dim foyer.
- Admin: clean table-first layout; works on a laptop and a tablet at the registration desk.

## 9. Build phases & acceptance criteria

**Phase 0 — Plan.** Propose the folder structure, schema, RLS policies, and Edge Function list. Wait for my OK.

**Phase 1 — Database & auth.** Migrations, RLS, roles, seed one event + one admin. ✅ Anonymous user cannot select from `registrations`; scanner cannot approve.

**Phase 2 — Public registration + pending email.** Form, Edge Function, Turnstile, "Registration pending" email, ticket page (pending state). ✅ Submitting the form delivers the pending email within a minute with no QR; duplicate email is handled.

**Phase 3 — Admin dashboard + approval emails.** Stats, table, filters, approve/decline (single + bulk), confirmed email with QR, decline email, resend, CSV export/import, audit log. ✅ Approving sends the confirmed email with a working QR and the ticket page now shows the QR; every action appears in the audit log.

**Phase 4 — Scanner.** Camera scan, atomic check-in, four result states, manual entry, counter. ✅ Same QR scanned on two phones at once checks in exactly once; pending/declined codes are rejected.

**Phase 5 — Hardening & launch.** Load test ~300 registrations, test emails in Gmail/Outlook/iOS Mail, test scanning on iPhone + Android, deploy, swap the main site's registration button to the new URL. Write a one-page **door-staff guide** (how to log in, scan, handle failures, manual check-in).

**Target:** feature-complete and tested by **3 Nov 2026**, leaving two weeks for real registrations and a dry run before 17 Nov.

## 10. Deliverables

- Working app deployed on Netlify + Supabase project with migrations in the repo
- `README.md`: setup, env vars, deploy steps, how to add admins/scanners, data retention
- `DOOR-STAFF-GUIDE.md`
- Seed script with ~20 fake registrants for testing

## 11. Questions to ask me first

1. Subdomain (`register.…`) or path (`/register`) on the existing site?
2. Should some categories be auto-approved (e.g. Youth Innovator booth teams, invited ministers)?
3. Do I already have a Supabase project and a Resend account / domain access for DNS records?
4. Which fields are required vs optional, and do we need extra ones (e.g. session interest, Deal Corner track)?
5. Data retention period after the event?
6. Do we need the 14 Nov Youth Prep Workshop as a second event in this system?
