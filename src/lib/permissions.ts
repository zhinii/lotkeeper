import type {
  MemberPermissions,
  MemberRole,
  OrganizationMembership,
} from "../types";

export const employeePermissionOptions: Array<{
  key: keyof MemberPermissions;
  label: string;
  help: string;
}> = [
  {
    key: "viewPrivate",
    label: "View employee-only items",
    help: "See records and fields hidden from public visitors.",
  },
  {
    key: "viewInventory",
    label: "Open the inventory tracker",
    help: "See stock levels and recent inventory activity.",
  },
  {
    key: "addItems",
    label: "Add new items",
    help: "Photograph or upload new items for administrator review.",
  },
  {
    key: "updateItems",
    label: "Suggest item updates",
    help: "Update photos, descriptions, details, and map pins for review.",
  },
  {
    key: "adjustInventory",
    label: "Change inventory quantities",
    help: "Record received, used, and counted stock with an audit trail.",
  },
];

export const employeeDefaults: MemberPermissions = {
  viewPrivate: true,
  viewInventory: true,
  addItems: true,
  updateItems: true,
  adjustInventory: true,
};

export const viewerDefaults: MemberPermissions = {
  viewPrivate: false,
  viewInventory: false,
  addItems: false,
  updateItems: false,
  adjustInventory: false,
};

export function normalizedRole(role?: MemberRole | null): MemberRole {
  return role === "staff" ? "employee" : role || "viewer";
}

export function permissionsFor(
  membership?: Pick<OrganizationMembership, "role" | "permissions"> | null,
): MemberPermissions {
  if (!membership) return viewerDefaults;
  const role = normalizedRole(membership.role);
  if (role === "admin")
    return {
      viewPrivate: true,
      viewInventory: true,
      addItems: true,
      updateItems: true,
      adjustInventory: true,
    };
  const defaults = role === "employee" ? employeeDefaults : viewerDefaults;
  const configured = { ...defaults, ...(membership.permissions || {}) };
  return role === "viewer"
    ? {
        ...configured,
        addItems: false,
        updateItems: false,
        adjustInventory: false,
      }
    : configured;
}

export function roleLabel(role?: MemberRole | null) {
  const value = normalizedRole(role);
  if (value === "admin") return "Site administrator";
  if (value === "employee") return "Employee";
  return "Viewer";
}
