import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/supabase.types'

export function createAdminClient() {
  return createClient<Database>(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}
