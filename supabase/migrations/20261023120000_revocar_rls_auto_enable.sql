-- Endurecimiento: public.rls_auto_enable() es una función de Supabase que usa un event trigger
-- (ensure_rls) para activar RLS en cada tabla nueva del esquema public. Es SECURITY DEFINER y, por
-- estar en un esquema expuesto, la API REST la mostraba como llamable por anon y authenticated.
-- Nadie tiene por qué invocarla: el event trigger la ejecuta por su cuenta, sin depender de EXECUTE.
-- Supabase no la crea en todos los proyectos (la base de producción nueva no la tiene): solo se revoca si existe.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;
