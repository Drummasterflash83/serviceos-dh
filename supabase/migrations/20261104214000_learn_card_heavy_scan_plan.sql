-- Keep the card-input function's cold heavy-company scan inside PostgREST's
-- eight-second statement budget. The setting is scoped to this function call;
-- the authenticator and service roles retain their existing defaults.
alter function public.learn_card_projection_inputs(uuid,uuid)
  set enable_bitmapscan=off;
