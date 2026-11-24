-- The post-event thank-you email (send-thank-you function).
-- Re-runnable: the checks are dropped and recreated with the extra value.

alter table public.email_log drop constraint if exists email_log_type_check;
alter table public.email_log add constraint email_log_type_check
  check (type in ('pending', 'approved', 'declined', 'waitlisted', 'resend', 'safeguarding',
                  'ballot', 'ballot_reminder', 'ballot_checkout', 'thank_you'));

alter table public.email_log drop constraint if exists email_log_template_check;
alter table public.email_log add constraint email_log_template_check
  check (template in ('pending', 'approved', 'declined', 'waitlisted', 'safeguarding',
                      'ballot_mpyi', 'ballot_peoples_choice', 'thank_you'));

-- Sending skips anyone whose address already got the thank-you, so look-ups by address are common.
create index if not exists email_log_thank_you_idx
  on public.email_log (lower(to_email)) where template = 'thank_you' and status = 'sent';
