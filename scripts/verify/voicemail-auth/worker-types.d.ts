declare const Deno: {env:{get(name:string):string|undefined};serve(handler:(req:Request)=>Promise<Response>):unknown};
declare module 'https://esm.sh/@supabase/supabase-js@2.45.4' {export {createClient} from '@supabase/supabase-js'; export type {SupabaseClient} from '@supabase/supabase-js';}
