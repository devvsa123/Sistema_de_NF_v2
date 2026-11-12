-- Divide o perfil de administrador em dois:
--   admin                       → acesso total (configurações, caminho, modelo do laudo, importação, ajustes)
--   gerencia_usuarios (marcação) → "Administrador de usuários": só cadastra e edita usuários e empresas,
--                                  além do trabalho normal nas etapas em que atua.
alter table usuarios add column gerencia_usuarios boolean not null default false;

-- O administrador geral passa a ser somente o CT (IM) Vitor Abreu (login 11009268).
-- Os demais administradores viram administradores de usuários, mantendo as etapas e permissões que já tinham.
-- Se o login 11009268 não existir, nada é alterado (para nunca ficar sem administrador).
do $$
begin
  if exists (select 1 from usuarios where login = '11009268') then
    update usuarios set papel = 'admin', ativo = true where login = '11009268';
    update usuarios set papel = 'interno', gerencia_usuarios = true where papel = 'admin' and login <> '11009268';
  end if;
end $$;
