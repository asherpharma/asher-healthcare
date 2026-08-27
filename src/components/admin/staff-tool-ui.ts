import type {
  PatientLauncherActionId,
  StaffToolGroup,
  StaffToolIconKey,
} from "@/lib/staff-navigation";
import {
  BellRing,
  CalendarDays,
  ClipboardPlus,
  FlaskConical,
  HeartHandshake,
  LayoutDashboard,
  ListTodo,
  ReceiptIndianRupee,
  Settings2,
  Smartphone,
  Stethoscope,
  UserRoundCog,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

export const STAFF_TOOL_ICONS: Readonly<Record<StaffToolIconKey, LucideIcon>> = {
  dashboard: LayoutDashboard,
  reception: ClipboardPlus,
  appointments: CalendarDays,
  consultations: Stethoscope,
  patients: UsersRound,
  tasks: ListTodo,
  communications: BellRing,
  billing: ReceiptIndianRupee,
  lab: FlaskConical,
  staff: UserRoundCog,
  family: HeartHandshake,
  mobile: Smartphone,
  settings: Settings2,
};

export const STAFF_TOOL_GROUP_LABELS: Readonly<Record<StaffToolGroup, string>> = {
  daily: "Daily work",
  patient: "Patient care",
  operations: "Clinic operations",
  management: "Administration",
};

export const STAFF_TOOL_GROUP_TONES: Readonly<Record<StaffToolGroup, string>> = {
  daily: "bg-blue-50 text-blue-900",
  patient: "bg-violet-50 text-violet-900",
  operations: "bg-emerald-50 text-emerald-900",
  management: "bg-amber-50 text-amber-900",
};

export const PATIENT_ACTION_TONES: Readonly<Record<PatientLauncherActionId, string>> = {
  open: "bg-blue-50 text-blue-800",
  book: "bg-violet-50 text-violet-800",
  consult: "bg-cyan-50 text-cyan-800",
  bill: "bg-emerald-50 text-emerald-800",
  lab: "bg-amber-50 text-amber-800",
};
