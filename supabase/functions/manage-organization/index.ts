import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type MemberRole = "admin" | "employee" | "viewer";
type MemberPermissions = {
  viewPrivate: boolean;
  viewInventory: boolean;
  addItems: boolean;
  updateItems: boolean;
  adjustInventory: boolean;
};

const employeeDefaults: MemberPermissions = {
  viewPrivate: true,
  viewInventory: true,
  addItems: true,
  updateItems: true,
  adjustInventory: true,
};
const viewerDefaults: MemberPermissions = {
  viewPrivate: false,
  viewInventory: false,
  addItems: false,
  updateItems: false,
  adjustInventory: false,
};

function memberAccess(roleValue: unknown, permissionValue: unknown) {
  const normalized = roleValue === "staff" ? "employee" : roleValue;
  const role: MemberRole =
    normalized === "admin" ||
    normalized === "employee" ||
    normalized === "viewer"
      ? normalized
      : "viewer";
  const supplied =
    permissionValue && typeof permissionValue === "object"
      ? (permissionValue as Record<string, unknown>)
      : {};
  const defaults = role === "employee" ? employeeDefaults : viewerDefaults;
  const permissions = Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => [
      key,
      typeof supplied[key] === "boolean" ? supplied[key] : fallback,
    ]),
  ) as unknown as MemberPermissions;
  return {
    role,
    permissions:
      role === "admin"
        ? employeeDefaults
        : role === "viewer"
          ? {
              ...permissions,
              addItems: false,
              updateItems: false,
              adjustInventory: false,
            }
          : permissions,
  };
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function messageFrom(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    return [value.message, value.details, value.hint, value.code]
      .filter(Boolean)
      .map(String)
      .join(" · ");
  }
  return String(error || "Unknown error");
}

function findModernSecret(value: unknown): string | null {
  if (typeof value === "string" && value.startsWith("sb_secret_")) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findModernSecret(item);
      if (match) return match;
    }
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      const match = findModernSecret(item);
      if (match) return match;
    }
  }
  return null;
}

function supabaseServerKey() {
  const modernSecrets = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modernSecrets) {
    try {
      const key = findModernSecret(JSON.parse(modernSecrets));
      if (key) return key;
    } catch {
      // Fall through to the legacy service-role key.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
}

async function findUserByEmail(
  admin: ReturnType<typeof createClient>,
  email: string,
) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw error;
    const match = data.users.find(
      (user) => user.email?.toLowerCase() === email.toLowerCase(),
    );
    if (match) return match;
    if (data.users.length < 1000) return null;
  }
  throw new Error("The user directory is too large to search safely.");
}

async function removeOrganizationFiles(
  admin: ReturnType<typeof createClient>,
  bucket: string,
  organizationId: string,
) {
  while (true) {
    const { data, error } = await admin.storage
      .from(bucket)
      .list(organizationId, { limit: 1000, offset: 0 });
    if (error) throw error;
    const paths = (data || [])
      .filter((item) => item.name)
      .map((item) => `${organizationId}/${item.name}`);
    if (!paths.length) return;
    const { error: removeError } = await admin.storage
      .from(bucket)
      .remove(paths);
    if (removeError) throw removeError;
    if (paths.length < 1000) return;
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST")
    return response({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = supabaseServerKey();
  if (!supabaseUrl || !serviceKey)
    return response({ error: "Function secrets are incomplete" }, 500);

  const authorization = request.headers.get("Authorization") || "";
  const accessToken = authorization.replace(/^Bearer\s+/i, "");
  if (!accessToken) return response({ error: "Sign in is required" }, 401);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: authData, error: authError } =
      await admin.auth.getUser(accessToken);
    if (authError || !authData.user)
      return response({ error: "Your sign-in has expired" }, 401);
    const caller = authData.user;
    const payload = await request.json();
    const action = String(payload?.action || "");
    const organizationId = String(payload?.organization_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(organizationId))
      return response({ error: "Choose a valid organization" }, 400);

    const [
      { data: organization, error: orgError },
      { data: membership },
      { data: platformAdmin },
    ] = await Promise.all([
      admin
        .from("organizations")
        .select("id,name,created_by")
        .eq("id", organizationId)
        .single(),
      admin
        .from("organization_members")
        .select("role")
        .eq("organization_id", organizationId)
        .eq("user_id", caller.id)
        .maybeSingle(),
      admin
        .from("platform_admins")
        .select("user_id")
        .eq("user_id", caller.id)
        .maybeSingle(),
    ]);
    if (orgError) throw orgError;
    const isOwner = organization.created_by === caller.id;
    const canManage =
      isOwner || membership?.role === "admin" || Boolean(platformAdmin);
    if (!canManage)
      return response({ error: "Administrator access required" }, 403);

    if (action === "list_members") {
      const { data: rows, error } = await admin
        .from("organization_members")
        .select("user_id,role,permissions,created_at")
        .eq("organization_id", organizationId)
        .order("created_at");
      if (error) throw error;
      const members = await Promise.all(
        (rows || []).map(async (row) => {
          const { data } = await admin.auth.admin.getUserById(row.user_id);
          return {
            ...row,
            email: data.user?.email || "Account email unavailable",
            is_owner: row.user_id === organization.created_by,
          };
        }),
      );
      return response({ members });
    }

    if (action === "create_employee" || action === "create_member") {
      const email = String(payload?.email || "")
        .trim()
        .toLowerCase();
      const password = String(payload?.password || "");
      const { role, permissions } = memberAccess(
        payload?.role || "employee",
        payload?.permissions,
      );
      if (!/^\S+@\S+\.\S+$/.test(email))
        return response({ error: "Enter a valid email address" }, 400);
      if (role !== "employee" && role !== "viewer" && role !== "admin")
        return response(
          { error: "Choose viewer, employee, or site administrator access" },
          400,
        );

      let user = await findUserByEmail(admin, email);
      let created = false;
      if (!user) {
        if (password.length < 10)
          return response(
            {
              error:
                "A new account needs a temporary password of at least 10 characters",
            },
            400,
          );
        const createdUser = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { material_pin_account: true },
        });
        if (createdUser.error) throw createdUser.error;
        if (!createdUser.data.user)
          throw new Error("Supabase did not return the new user account.");
        user = createdUser.data.user;
        created = true;
      }
      if (!user)
        throw new Error("Employee account could not be found or created.");
      const { error: memberError } = await admin
        .from("organization_members")
        .upsert(
          {
            organization_id: organizationId,
            user_id: user.id,
            role,
            permissions,
          },
          { onConflict: "organization_id,user_id" },
        );
      if (memberError) {
        if (created) await admin.auth.admin.deleteUser(user.id);
        throw memberError;
      }
      return response({
        member: {
          user_id: user.id,
          email: user.email,
          role,
          permissions,
          is_owner: false,
        },
        created,
        message: created
          ? "Account created. Give the person their temporary password privately."
          : "Existing account assigned to this organization.",
      });
    }

    if (action === "update_member") {
      const userId = String(payload?.user_id || "");
      if (!/^[0-9a-f-]{36}$/i.test(userId))
        return response({ error: "Choose a valid person" }, 400);
      if (userId === organization.created_by)
        return response(
          { error: "The organization owner keeps administrator access" },
          400,
        );
      const { role, permissions } = memberAccess(
        payload?.role,
        payload?.permissions,
      );
      const { error } = await admin
        .from("organization_members")
        .update({ role, permissions })
        .eq("organization_id", organizationId)
        .eq("user_id", userId);
      if (error) throw error;
      return response({ message: "Access permissions saved." });
    }

    if (action === "remove_member") {
      const userId = String(payload?.user_id || "");
      if (!/^[0-9a-f-]{36}$/i.test(userId))
        return response({ error: "Choose a valid employee" }, 400);
      if (userId === caller.id)
        return response({ error: "You cannot remove your own access" }, 400);
      if (userId === organization.created_by)
        return response(
          { error: "The organization owner cannot be removed" },
          400,
        );
      const { error } = await admin
        .from("organization_members")
        .delete()
        .eq("organization_id", organizationId)
        .eq("user_id", userId);
      if (error) throw error;
      return response({
        message: "Employee access removed. The login account was not deleted.",
      });
    }

    if (action === "delete_organization") {
      if (!isOwner && !platformAdmin)
        return response(
          {
            error:
              "Only the organization owner or platform administrator can delete it",
          },
          403,
        );
      if (String(payload?.confirmation || "") !== organization.name)
        return response({ error: "The organization name did not match" }, 400);
      await removeOrganizationFiles(admin, "submission-media", organizationId);
      await removeOrganizationFiles(admin, "public-records", organizationId);
      await removeOrganizationFiles(admin, "site-maps", organizationId);
      const { error } = await admin
        .from("organizations")
        .delete()
        .eq("id", organizationId);
      if (error) throw error;
      return response({
        message: "Organization and its Material Pin data were deleted.",
      });
    }

    return response({ error: "Unsupported action" }, 400);
  } catch (error) {
    return response({ error: messageFrom(error) }, 500);
  }
});
