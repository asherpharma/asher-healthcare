"use client";

import { useStaff, type StaffRole } from "@/components/admin/StaffGuard";
import {
  stageAdminNavigationHandoff,
  type AdminNavigationHandoff,
} from "@/lib/admin-navigation-handoff";
import {
  CalendarPlus,
  FlaskConical,
  IndianRupee,
  MessageCircle,
  Phone,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";

type PatientQuickActionsProps = {
  patient: {
    id: string;
    phone: string;
  };
};

type RouteAction = {
  label: string;
  handoff: AdminNavigationHandoff;
  icon: LucideIcon;
  tone: string;
  roles: StaffRole[];
};

function normalisePhone(phone: string) {
  const compact = phone.trim().replace(/[^+\d]/g, "");
  return compact || phone;
}

function normaliseIndianWhatsAppNumber(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits;
}

export default function PatientQuickActions({ patient }: PatientQuickActionsProps) {
  const router = useRouter();
  const { profile } = useStaff();
  const allRouteActions: RouteAction[] = [
    {
      label: "Consult",
      handoff: {
        destination: "/admin/consultations",
        intent: "open-patient-consultation",
        patientId: patient.id,
      },
      icon: Stethoscope,
      tone: "bg-blue-50 text-blue-700",
      roles: ["admin", "doctor"],
    },
    {
      label: "Book",
      handoff: {
        destination: "/admin/appointments",
        intent: "create-appointment",
        patientId: patient.id,
      },
      icon: CalendarPlus,
      tone: "bg-violet-50 text-violet-700",
      roles: ["admin", "doctor", "reception"],
    },
    {
      label: "Bill",
      handoff: {
        destination: "/admin/billing",
        intent: "create-invoice",
        patientId: patient.id,
      },
      icon: IndianRupee,
      tone: "bg-emerald-50 text-emerald-700",
      roles: ["admin", "reception"],
    },
    {
      label: "Lab",
      handoff: {
        destination: "/admin/lab",
        intent: "create-lab-order",
        patientId: patient.id,
      },
      icon: FlaskConical,
      tone: "bg-amber-50 text-amber-700",
      roles: ["admin", "doctor", "reception"],
    },
  ];
  const routeActions = allRouteActions.filter((action) => action.roles.includes(profile.role));
  const phoneNumber = normalisePhone(patient.phone);
  const whatsappNumber = normaliseIndianWhatsAppNumber(patient.phone);

  return (
    <section aria-label="Patient quick actions" className="border-b border-slate-200 bg-slate-50/80 p-3 sm:p-4">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {routeActions.map(({ label, handoff, icon: Icon, tone }) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              stageAdminNavigationHandoff(handoff);
              router.push(handoff.destination);
            }}
            className="group flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-2xl bg-white px-2 py-2.5 text-center text-xs font-bold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:ring-[#A8864A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#233A59]"
          >
            <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${tone}`}>
              <Icon aria-hidden="true" size={17} />
            </span>
            {label}
          </button>
        ))}

        <a
          href={`tel:${phoneNumber}`}
          className="group flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-2xl bg-white px-2 py-2.5 text-center text-xs font-bold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:ring-[#A8864A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#233A59]"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-50 text-sky-700">
            <Phone aria-hidden="true" size={17} />
          </span>
          Call
        </a>

        <a
          href={`https://wa.me/${whatsappNumber}`}
          target="_blank"
          rel="noreferrer"
          className="group flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-2xl bg-white px-2 py-2.5 text-center text-xs font-bold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:ring-[#A8864A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#233A59]"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-green-50 text-green-700">
            <MessageCircle aria-hidden="true" size={17} />
          </span>
          WhatsApp
        </a>
      </div>
    </section>
  );
}
