export const STATUSES = ['pending', 'approved', 'declined', 'waitlisted', 'cancelled'] as const;

export const EVENT_SLUG = import.meta.env.VITE_EVENT_SLUG || 'yim-2026';
