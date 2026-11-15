-- The 17 November 2026 event. Safe to re-run: updates the row in place.
insert into public.events (
  slug, name, subtitle, starts_at, ends_at, timezone, venue, venue_address, map_url,
  contact_email, arrival_note, capacity, registration_opens_at, registration_closes_at, auto_waitlist)
values (
  'yim-2026',
  'Youth Innovations Marketplace',
  'Scalable Solutions to End Violence Against Children',
  '2026-11-17 09:00:00+08',
  '2026-11-17 17:00:00+08',
  'Asia/Manila',
  'Diplomatic Hall, Marriott Hotel Manila',
  'Newport World Resorts, Pasay City, Metro Manila, Philippines',
  'https://maps.google.com/?q=Marriott+Hotel+Manila+Newport+World+Resorts+Pasay',
  'violenceendswithus@gmail.com',
  'The registration desk opens at 9:00 AM. Please bring a valid photo ID and have your QR code ready on your phone or printed.',
  null,                      -- no capacity limit
  null,
  '2026-11-17 17:00:00+08',  -- open through the event day for on-site registration
  false)
on conflict (slug) do update set
  name = excluded.name,
  subtitle = excluded.subtitle,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  venue = excluded.venue,
  venue_address = excluded.venue_address,
  map_url = excluded.map_url;

-- The two awards (also created by the awards migration for events that already existed).
insert into public.awards (event_id, kind, title)
select e.id, k.kind, k.title
  from public.events e
 cross join (values ('mpyi'::public.award_kind, 'Most Promising Young Innovator'),
                    ('peoples_choice'::public.award_kind, 'People''s Choice of Innovation')) as k (kind, title)
 where e.slug = 'yim-2026'
on conflict (event_id, kind) do nothing;

-- Peoples Choice candidates: the booths (src/data/booths.json). Re-running only adds missing booths,
-- so renames and hides made on the Awards dashboard are kept.
insert into public.award_candidates (award_id, booth_no, label, track, sort)
select a.id, b.booth_no, b.label, nullif(b.track, ''), b.booth_no
  from public.awards a
  join public.events e on e.id = a.event_id and e.slug = 'yim-2026'
 cross join (values
  (1, 'D-KAWACH', 'OCSEA'),
  (2, 'Voice 4 Change', 'Child Marriage'),
  (3, 'STEPS and RESPOND', 'Climate & Environment'),
  (4, 'ScreenSafe Stories', 'OCSEA'),
  (5, 'Her Life, Her Choice', 'Child Marriage'),
  (6, 'Eco-Scouts', 'Climate & Child Rights'),
  (7, 'Secure Shield', 'OCSEA'),
  (8, 'Mica to Microphones / Child-led Advocacy: From Voices to Action', 'Sexual Exploitation of Children, Child Marriage, Child Trafficking'),
  (9, 'Gain Line', 'Child Labour'),
  (10, 'Project SAFE', 'OCSEA'),
  (11, 'Strengthening Local Accountability through Youth Engagement', 'Child Marriage, Gender-Based Violence, SRHR'),
  (12, 'SAFE Steps', 'Child Labour'),
  (13, 'Zero Harm Tracker (CONEC Youth Advisory Group)', 'OCSEA'),
  (14, 'PAUSE', 'Corporal Punishment'),
  (15, 'Balmanch / Children-led District Network', 'Child Labour'),
  (16, 'SAFE Together', 'OCSEA'),
  (17, 'Hearts On, Hands Off', 'Corporal Punishment'),
  (18, 'Red Ant Youth Movement', 'Child Exploitation, Adolescent Sexual and Reproductive Health and Rights'),
  (19, 'YOUNG Hands', 'Child Labour'),
  (20, 'Positive Discipline Champions', 'Corporal Punishment'),
  (21, 'Tiger - Empower Chatbot', 'Child Exploitation, Adolescent Sexual and Reproductive Health and Rights'),
  (22, 'Simba - Our Voices Matter', 'Child Exploitation, Adolescent Sexual and Reproductive Health and Rights'),
  (23, 'C4C', 'Climate Change & Child Rights'),
  (24, 'Restless Development', 'OCSEA')
 ) as b (booth_no, label, track)
 where a.kind = 'peoples_choice'
on conflict (award_id, booth_no) do nothing;

-- First admin: invite the user in Authentication → Users first, then:
--   select public.add_staff('you@example.org', 'admin');
