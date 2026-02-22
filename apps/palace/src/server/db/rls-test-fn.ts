import { createServerFn } from "@tanstack/react-start";
import { createSupabaseAdmin } from "../supabase/admin";
import { getSupabaseServerClient } from "../supabase/server";

/**
 * Demonstrates RLS policy behavior:
 * - Admin client (service role) bypasses RLS and can insert/read any row
 * - User-context client (anon key, no auth) is subject to RLS and gets 0 rows
 *   because our policies only allow the "authenticated" role
 */
export const runRlsPolicyTest = createServerFn({ method: "GET" }).handler(
  async () => {
    const testOwnerId = "00000000-0000-0000-0000-000000000001";
    const placeholderEmbedding = Array(1536).fill(0);

    const admin = createSupabaseAdmin();

    // Insert via admin (bypasses RLS)
    const { data: insertData, error: insertError } = await admin
      .from("embeddings")
      .insert({
        owner_id: testOwnerId,
        content: "RLS test embedding",
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
        userContextRowCount: 0,
      };
    }

    // Read via admin - should see the row
    const { data: adminData } = await admin.from("embeddings").select("id");
    const adminRowCount = adminData?.length ?? 0;

    // Read via user-context client (anon, not logged in) - RLS blocks access
    const userClient = getSupabaseServerClient();
    const { data: userData } = await userClient.from("embeddings").select("id");
    const userContextRowCount = userData?.length ?? 0;

    // Cleanup: delete the test row via admin
    if (insertData?.id) {
      await admin.from("embeddings").delete().eq("id", insertData.id);
    }

    return {
      success: true,
      message:
        userContextRowCount === 0
          ? "RLS policies work: admin sees data, unauthenticated user sees 0 rows"
          : "Unexpected: unauthenticated user saw rows (check RLS policies)",
      adminInserted: true,
      adminRowCount,
      userContextRowCount,
      policyValid: userContextRowCount === 0 && adminRowCount >= 1,
    };
  }
);
