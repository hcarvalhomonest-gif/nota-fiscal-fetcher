
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM authenticated;

REVOKE ALL ON FUNCTION public.tg_set_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tg_set_updated_at() FROM anon;
REVOKE ALL ON FUNCTION public.tg_set_updated_at() FROM authenticated;
