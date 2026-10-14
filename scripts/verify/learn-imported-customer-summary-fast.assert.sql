select fixture_assert(not exists(
 select 1 from public.learn_business_input_versions v
 where public.learn_business_customer_summary(v.payload)
  is distinct from public.learn_imported_customer_summary(v.payload)
),'inlined customer summary retains exact fixture output');
select fixture_assert(
 public.learn_business_customer_summary('{"companyName":"  Acme ","contact":{"firstName":"  Ann  ","lastName":"  Lee ","email":"","telephone":null,"mobile":"01234"},"addressLine1":" Road ","town":"Town","customerType":5}'::jsonb)
 is not distinct from
 public.learn_imported_customer_summary('{"companyName":"  Acme ","contact":{"firstName":"  Ann  ","lastName":"  Lee ","email":"","telephone":null,"mobile":"01234"},"addressLine1":" Road ","town":"Town","customerType":5}'::jsonb),
 'inlined customer summary retains whitespace, missing and numeric semantics');
select fixture_assert(not has_function_privilege('authenticated','public.learn_imported_customer_summary(jsonb)','execute')
 and not has_function_privilege('authenticated','public.learn_imported_customer_text(jsonb,text[])','execute'),
 'inlined projection helpers remain private');
