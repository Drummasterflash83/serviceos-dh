-- Additional dependencies for the review RPC, in the disposable fixture only.
create table profiles(id uuid primary key);
insert into profiles values('00000000-0000-4000-8000-000000000030');
create table view_as_context(actor_user_id uuid,ended_at timestamptz,expires_at timestamptz);
