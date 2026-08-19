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
    label: "Update inventory quantities",
    help: "Receive, use, move, or count stock with a complete audit trail.",
  },
  {
    key: "moveItems",
    label: "Relocate items on the map",
    help: "Move a pin or named storage location and keep the previous location in history.",
  },
  {
    key: "usePos",
    label: "Use checkout / POS",
    help: "Create multi-item sales, identify the customer or job, and reduce stock.",
  },
  {
    key: "viewSales",
    label: "View sales and billing history",
    help: "See organization-wide completed checkouts, totals, customers, and references.",
  },
];

export const employeeDefaults: MemberPermissions = {
  viewPrivate: true,
  viewInventory: true,
  addItems: true,
  updateItems: true,
  adjustInventory: true,
  moveItems: false,
  usePos: false,
  viewSales: false,
};

export const viewerDefaults: MemberPermissions = {
  viewPrivate: false,
  viewInventory: false,
  addItems: false,
  updateItems: false,
  adjustInventory: false,
  moveItems: false,
  usePos: false,
  viewSales: false,
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
      moveItems: true,
      usePos: true,
      viewSales: true,
    };
  const defaults = role === "employee" ? employeeDefaults : viewerDefaults;
  const configured = { ...defaults, ...(membership.permissions || {}) };
  return role === "viewer"
    ? {
        ...configured,
        addItems: false,
        updateItems: false,
        adjustInventory: false,
        moveItems: false,
        usePos: false,
        viewSales: false,
      }
    : configured;
}

export function roleLabel(role?: MemberRole | null) {
  const value = normalizedRole(role);
  if (value === "admin") return "Site administrator";
  if (value === "employee") return "Employee";
  return "Viewer";
}
