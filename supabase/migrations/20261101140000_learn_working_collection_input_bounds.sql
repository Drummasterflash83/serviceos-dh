-- Refuse oversized retained inputs explicitly before an item/context write.
-- A failed batch rolls back atomically and keeps the original recovery request.
do $patch$ declare d text;anchor text:=$a$   item_result:=learn_working_time_calculate($a$;begin
 select pg_get_functiondef('public.learn_work_collection_step(uuid,uuid,integer)'::regprocedure) into d;
 if array_length(string_to_array(d,anchor),1) is distinct from 2 then raise exception 'Unexpected working-time step contract';end if;
 execute replace(d,anchor,$a$   if octet_length(frozen_history::text)>2097152 or octet_length(frozen_delays::text)>2097152 then
    raise exception 'Individual working-time history exceeds retained evidence limit' using errcode='54000';
   end if;
$a$||anchor);
end $patch$;
