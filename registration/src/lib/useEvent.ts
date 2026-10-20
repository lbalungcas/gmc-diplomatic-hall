import { useCallback, useEffect, useState } from 'react';
import { EVENT_SLUG } from './constants';
import { supabase } from './supabase';
import type { EventRow } from './types';

export function useEvent() {
  const [event, setEvent] = useState<EventRow | null>(null);
  const reload = useCallback(async () => {
    const { data } = await supabase.from('events').select('*').eq('slug', EVENT_SLUG).maybeSingle();
    setEvent(data as EventRow | null);
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);
  return { event, reload };
}
