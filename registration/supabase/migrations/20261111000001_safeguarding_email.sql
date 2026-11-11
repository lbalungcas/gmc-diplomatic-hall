-- The Child Safeguarding and Code of Conduct form email (send-safeguarding function).
-- Re-runnable: the checks are dropped and recreated with the extra value.

alter table public.email_log drop constraint if exists email_log_type_check;
alter table public.email_log add constraint email_log_type_check
  check (type in ('pending', 'approved', 'declined', 'waitlisted', 'resend', 'safeguarding'));

alter table public.email_log drop constraint if exists email_log_template_check;
alter table public.email_log add constraint email_log_template_check
  check (template in ('pending', 'approved', 'declined', 'waitlisted', 'safeguarding'));
