import { createServerFn } from "@tanstack/react-start";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Tests the dedicated anon client: it always runs as the anon role,
 * so RLS policies for "authenticated" block access. Compares against
 * admin (bypasses RLS) to confirm behavior.
 */
export const runAnonClientTest = createServerFn({ method: "GET" }).handler(
  async () => {
    const testOwnerId = "00000000-0000-0000-0000-000000000002";
    const placeholderEmbedding = Array(1536).fill(0);

    const admin = createAdminClient();
    const anon = createClient();

    // Insert via admin (bypasses RLS)
    const { data: insertData, error: insertError } = await admin
      .from("embeddings")
      .insert({
        owner_id: testOwnerId,
        content: "Anon client test embedding",
        embedding: `[${placeholderEmbedding.join(",")}]`,
        metadata: {},
      })
      .select("id")
      .single();

    if (insertError) {
      return {
        success: false,
        message: `Admin insert failed: ${insertError.message}`,
        adminInserted: false,
        adminRowCount: 0,
        anonRowCount: 0,
      };
    }

    // Admin sees the row
    const { data: adminData } = await admin.from("embeddings").select("id");
    const adminRowCount = adminData?.length ?? 0;

    // Dedicated anon client never has a user JWT - RLS blocks access
    const { data: anonData } = await anon.from("embeddings").select("id");
    const anonRowCount = anonData?.length ?? 0;

    // Cleanup
    if (insertData?.id) {
      await admin.from("embeddings").delete().eq("id", insertData.id);
    }

    return {
      success: true,
      message:
        anonRowCount === 0
          ? "Anon client works: it runs as anon role and gets 0 rows (RLS blocks)"
          : "Unexpected: anon client saw rows (check RLS policies)",
      adminInserted: true,
      adminRowCount,
      anonRowCount,
      policyValid: anonRowCount === 0 && adminRowCount >= 1,
    };
  }
);
