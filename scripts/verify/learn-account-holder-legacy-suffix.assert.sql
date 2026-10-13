
set local role authenticated;
do $$declare r jsonb;begin
 r:=pg_temp.br('learn_commusoft_confirm_customer',jsonb_build_object('p_version',pg_temp.brid(101),'p_kind','person','p_target',null,'p_reason','Legacy reviewed customer'));
 assert r#>>'{result,already}'='true';
end$$;
reset role;
