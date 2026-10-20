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
  200,
  null,
  '2026-11-14 20:00:00+08',  -- "before 8:00 PM Philippine Standard Time on Saturday, 14 November 2026"
  true)
on conflict (slug) do update set
  name = excluded.name,
  subtitle = excluded.subtitle,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  venue = excluded.venue,
  venue_address = excluded.venue_address,
  map_url = excluded.map_url;

-- First admin: invite the user in Authentication → Users first, then:
--   select public.add_staff('you@example.org', 'admin');
