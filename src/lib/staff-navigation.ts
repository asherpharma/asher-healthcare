export const STAFF_ROLES = ["admin", "doctor", "reception"] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];
export type StaffToolGroup = "daily" | "patient" | "operations" | "management";

export type StaffToolIconKey =
  | "dashboard"
  | "reception"
  | "appointments"
  | "consultations"
  | "patients"
  | "tasks"
  | "communications"
  | "billing"
  | "lab"
  | "staff"
  | "family"
  | "mobile"
  | "settings";

export type StaffTool = Readonly<{
  id: string;
  href: `/admin${string}`;
  label: string;
  shortLabel: string;
  detail: string;
  group: StaffToolGroup;
  roles: readonly StaffRole[];
  keywords: readonly string[];
  icon: StaffToolIconKey;
}>;

export const STAFF_TOOL_GROUPS: readonly StaffToolGroup[] = [
  "daily",
  "patient",
  "operations",
  "management",
];

const ALL_ROLES = STAFF_ROLES;
const ADMIN_AND_RECEPTION: readonly StaffRole[] = ["admin", "reception"];
const ADMIN_AND_DOCTOR: readonly StaffRole[] = ["admin", "doctor"];
const ADMIN_ONLY: readonly StaffRole[] = ["admin"];

/**
 * Canonical, role-aware directory for the staff workspace. It deliberately
 * contains route-level metadata only and must never be extended with patient,
 * appointment, or other clinical record data.
 */
export const STAFF_TOOL_REGISTRY: readonly StaffTool[] = [
  {
    id: "dashboard",
    href: "/admin",
    label: "Dashboard",
    shortLabel: "Home",
    detail: "Clinic overview, activity, and performance",
    group: "daily",
    roles: ADMIN_ONLY,
    keywords: ["home", "overview", "summary", "analytics", "performance"],
    icon: "dashboard",
  },
  {
    id: "reception",
    href: "/admin/reception",
    label: "Express reception",
    shortLabel: "Register",
    detail: "Register a patient and start the front-desk visit",
    group: "daily",
    roles: ADMIN_AND_RECEPTION,
    keywords: ["new patient", "register patient", "registration", "check in", "front desk", "reception"],
    icon: "reception",
  },
  {
    id: "appointments",
    href: "/admin/appointments",
    label: "Appointments",
    shortLabel: "Bookings",
    detail: "Book, review, and manage the clinic schedule",
    group: "daily",
    roles: ALL_ROLES,
    keywords: ["book appointment", "new appointment", "booking", "calendar", "schedule", "slot"],
    icon: "appointments",
  },
  {
    id: "consultations",
    href: "/admin/consultations",
    label: "Consultations",
    shortLabel: "Consult",
    detail: "Open the doctor workspace and record clinical visits",
    group: "daily",
    roles: ADMIN_AND_DOCTOR,
    keywords: ["consult patient", "doctor", "clinical", "prescription", "visit", "encounter"],
    icon: "consultations",
  },
  {
    id: "patients",
    href: "/admin/patients",
    label: "Patients",
    shortLabel: "Patients",
    detail: "Find patient profiles and visit history",
    group: "patient",
    roles: ALL_ROLES,
    keywords: ["open patient", "find patient", "search patient", "records", "profile", "history"],
    icon: "patients",
  },
  {
    id: "tasks",
    href: "/admin/tasks",
    label: "Tasks & follow-ups",
    shortLabel: "Tasks",
    detail: "Track clinic work, follow-ups, and due items",
    group: "patient",
    roles: ALL_ROLES,
    keywords: ["follow up", "to do", "worklist", "due", "reminder", "callback"],
    icon: "tasks",
  },
  {
    id: "communications",
    href: "/admin/communications",
    label: "Reminders & recalls",
    shortLabel: "Reminders",
    detail: "Coordinate appointment reminders and patient recalls",
    group: "patient",
    roles: ADMIN_AND_RECEPTION,
    keywords: ["message", "communication", "recall", "reminder", "follow up", "notify"],
    icon: "communications",
  },
  {
    id: "billing",
    href: "/admin/billing",
    label: "Billing",
    shortLabel: "Billing",
    detail: "Create invoices, record payments, and issue receipts",
    group: "operations",
    roles: ADMIN_AND_RECEPTION,
    keywords: ["bill patient", "invoice", "payment", "receipt", "fees", "collection", "cash"],
    icon: "billing",
  },
  {
    id: "lab",
    href: "/admin/lab",
    label: "Lab desk",
    shortLabel: "Lab",
    detail: "Manage laboratory orders and available reports",
    group: "operations",
    roles: ALL_ROLES,
    keywords: ["lab patient", "laboratory", "test", "report", "results", "diagnostic"],
    icon: "lab",
  },
  {
    id: "staff",
    href: "/admin/staff",
    label: "Staff access",
    shortLabel: "Staff",
    detail: "Manage staff accounts, roles, and clinic access",
    group: "management",
    roles: ADMIN_ONLY,
    keywords: ["invite staff", "new staff", "team", "role", "access", "permissions", "login"],
    icon: "staff",
  },
  {
    id: "patient-access",
    href: "/admin/patient-access",
    label: "Family portal access",
    shortLabel: "Portal",
    detail: "Manage patient and family portal access",
    group: "patient",
    roles: ADMIN_ONLY,
    keywords: ["family portal", "patient portal", "activate account", "portal access", "family access"],
    icon: "family",
  },
  {
    id: "app",
    href: "/admin/app",
    label: "Mobile app",
    shortLabel: "App",
    detail: "Install and use the mobile staff workspace",
    group: "operations",
    roles: ALL_ROLES,
    keywords: ["install app", "phone", "mobile", "pwa", "download", "ios", "android"],
    icon: "mobile",
  },
  {
    id: "settings",
    href: "/admin/settings",
    label: "Settings",
    shortLabel: "Settings",
    detail: "Configure clinic schedules and workspace preferences",
    group: "management",
    roles: ADMIN_ONLY,
    keywords: ["clinic settings", "availability", "timings", "slots", "configuration", "preferences"],
    icon: "settings",
  },
] as const;

const STAFF_TOOL_BY_ID = new Map(STAFF_TOOL_REGISTRY.map((tool) => [tool.id, tool]));

const PRIMARY_TOOL_IDS: Readonly<Record<StaffRole, readonly string[]>> = {
  admin: ["dashboard", "appointments", "patients"],
  doctor: ["consultations", "appointments", "patients"],
  reception: ["reception", "appointments", "patients"],
};

const QUICK_TOOL_IDS: Readonly<Record<StaffRole, readonly string[]>> = {
  admin: ["reception", "appointments", "patients", "billing"],
  doctor: ["consultations", "appointments", "patients", "lab"],
  reception: ["reception", "appointments", "billing", "lab"],
};

function isStaffRole(role: string): role is StaffRole {
  return STAFF_ROLES.includes(role as StaffRole);
}

function roleCanUseTool(role: StaffRole, tool: StaffTool) {
  return tool.roles.includes(role);
}

function toolsForIds(role: StaffRole, ids: readonly string[]) {
  return ids.flatMap((id) => {
    const tool = STAFF_TOOL_BY_ID.get(id);
    return tool && roleCanUseTool(role, tool) ? [tool] : [];
  });
}

export function staffToolsForRole(role: StaffRole): StaffTool[] {
  if (!isStaffRole(role)) return [];
  return STAFF_TOOL_REGISTRY.filter((tool) => roleCanUseTool(role, tool));
}

export function primaryStaffToolsForRole(role: StaffRole): StaffTool[] {
  if (!isStaffRole(role)) return [];
  return toolsForIds(role, PRIMARY_TOOL_IDS[role]);
}

export type QuickStaffTool = StaffTool & Readonly<{ href: `/admin${string}` }>;

export function quickStaffToolsForRole(role: StaffRole): QuickStaffTool[] {
  if (!isStaffRole(role)) return [];

  return toolsForIds(role, QUICK_TOOL_IDS[role]).map((tool) => {
    if (role !== "reception" || tool.id !== "appointments") return tool;
    return { ...tool, href: "/admin/appointments?new=1" };
  });
}

function normalizedSearchText(value: string) {
  return value
    .toLocaleLowerCase("en-IN")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function searchScore(tool: StaffTool, query: string, terms: readonly string[]) {
  const id = normalizedSearchText(tool.id);
  const label = normalizedSearchText(tool.label);
  const shortLabel = normalizedSearchText(tool.shortLabel);
  const detail = normalizedSearchText(tool.detail);
  const keywords = tool.keywords.map(normalizedSearchText);
  const searchable = [id, label, shortLabel, detail, ...keywords];

  let score = 0;
  if (id === query || label === query || shortLabel === query) score += 120;
  if (keywords.includes(query)) score += 110;
  if (label.startsWith(query) || shortLabel.startsWith(query)) score += 70;
  if (searchable.some((value) => value.includes(query))) score += 45;

  for (const term of terms) {
    if (id === term || label === term || shortLabel === term) score += 24;
    else if (keywords.some((keyword) => keyword === term)) score += 20;
    else if (searchable.some((value) => value.startsWith(term))) score += 12;
    else if (searchable.some((value) => value.includes(term))) score += 6;
  }

  return score;
}

export function searchStaffToolsForRole(
  role: StaffRole,
  query: string,
  limit = STAFF_TOOL_REGISTRY.length,
): StaffTool[] {
  if (!isStaffRole(role) || !Number.isFinite(limit) || limit <= 0) return [];
  const normalizedQuery = normalizedSearchText(query);
  if (!normalizedQuery) return [];
  const terms = normalizedQuery.split(" ");

  return staffToolsForRole(role)
    .map((tool, index) => ({ tool, index, score: searchScore(tool, normalizedQuery, terms) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, Math.floor(limit))
    .map(({ tool }) => tool);
}

export type GroupedStaffTools = Readonly<Record<StaffToolGroup, readonly StaffTool[]>>;

export function groupedStaffToolsForRole(role: StaffRole): GroupedStaffTools {
  const grouped: Record<StaffToolGroup, StaffTool[]> = {
    daily: [],
    patient: [],
    operations: [],
    management: [],
  };

  for (const tool of staffToolsForRole(role)) grouped[tool.group].push(tool);
  return grouped;
}

function pathnameOnly(value: string) {
  const withoutFragment = value.split("#", 1)[0];
  const withoutQuery = withoutFragment.split("?", 1)[0];
  if (!withoutQuery) return "/";
  return withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/u, "") : withoutQuery;
}

export function staffToolForPath(path: string): StaffTool | null {
  const pathname = pathnameOnly(path);
  return STAFF_TOOL_REGISTRY
    .filter((tool) => pathname === tool.href || (tool.href !== "/admin" && pathname.startsWith(`${tool.href}/`)))
    .sort((left, right) => right.href.length - left.href.length)[0] ?? null;
}

const DEFAULT_RECENT_TOOL_LIMIT = 6;

export function updateRecentStaffToolIds(
  currentIds: readonly string[],
  visitedToolId: string,
  limit = DEFAULT_RECENT_TOOL_LIMIT,
): string[] {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  const validLimit = Math.floor(limit);
  if (validLimit === 0) return [];
  const orderedIds = STAFF_TOOL_BY_ID.has(visitedToolId) ? [visitedToolId] : [];

  for (const id of currentIds) {
    if (orderedIds.length >= validLimit) break;
    if (!STAFF_TOOL_BY_ID.has(id) || orderedIds.includes(id)) continue;
    orderedIds.push(id);
  }

  return orderedIds;
}

export function recentStaffToolsForRole(
  role: StaffRole,
  recentIds: readonly string[],
  limit = DEFAULT_RECENT_TOOL_LIMIT,
): StaffTool[] {
  if (!isStaffRole(role) || !Number.isFinite(limit) || limit <= 0) return [];
  const seen = new Set<string>();
  const tools: StaffTool[] = [];

  for (const id of recentIds) {
    if (tools.length >= Math.floor(limit) || seen.has(id)) continue;
    seen.add(id);
    const tool = STAFF_TOOL_BY_ID.get(id);
    if (tool && roleCanUseTool(role, tool)) tools.push(tool);
  }

  return tools;
}

export type PatientLauncherActionId = "open" | "book" | "consult" | "bill" | "lab";

export type PatientLauncherAction = Readonly<{
  id: PatientLauncherActionId;
  href: `/admin${string}`;
  label: string;
  detail: string;
  icon: StaffToolIconKey;
  roles: readonly StaffRole[];
  intent:
    | "open-patient"
    | "create-appointment"
    | "open-patient-consultation"
    | "create-invoice"
    | "create-lab-order";
}>;

const PATIENT_LAUNCHER_ACTIONS: readonly PatientLauncherAction[] = [
  {
    id: "open",
    href: "/admin/patients",
    label: "Open",
    detail: "Open patient profile",
    icon: "patients",
    roles: ALL_ROLES,
    intent: "open-patient",
  },
  {
    id: "book",
    href: "/admin/appointments",
    label: "Book",
    detail: "Book an appointment",
    icon: "appointments",
    roles: ALL_ROLES,
    intent: "create-appointment",
  },
  {
    id: "consult",
    href: "/admin/consultations",
    label: "Consult",
    detail: "Start a consultation",
    icon: "consultations",
    roles: ADMIN_AND_DOCTOR,
    intent: "open-patient-consultation",
  },
  {
    id: "bill",
    href: "/admin/billing",
    label: "Bill",
    detail: "Create a patient invoice",
    icon: "billing",
    roles: ADMIN_AND_RECEPTION,
    intent: "create-invoice",
  },
  {
    id: "lab",
    href: "/admin/lab",
    label: "Lab",
    detail: "Create a laboratory order",
    icon: "lab",
    roles: ALL_ROLES,
    intent: "create-lab-order",
  },
] as const;

export function patientLauncherActionsForRole(role: StaffRole): PatientLauncherAction[] {
  if (!isStaffRole(role)) return [];
  return PATIENT_LAUNCHER_ACTIONS.filter((action) => action.roles.includes(role));
}
