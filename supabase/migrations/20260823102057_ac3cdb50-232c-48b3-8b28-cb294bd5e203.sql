REVOKE ALL ON FUNCTION public.trg_reschedule_webhook_dispatch() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reschedule_webhook_dispatch() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.next_webhook_dispatch_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_webhook_dispatch() TO service_role;
GRANT EXECUTE ON FUNCTION public.next_webhook_dispatch_at() TO service_role;