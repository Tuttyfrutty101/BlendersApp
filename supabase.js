import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://ytcgjydjgiovaiiudmoq.supabase.co';
const supabaseAnonKey = 'sb_publishable_JZbT9HFAMkApmw_mEyNcRg_aBWWv_Sw';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

