"use client";

import { useAuth } from "@/lib/auth";
import { AdminDashboard } from "@/components/dashboard/admin-dashboard";
import { EmployeeDashboard } from "@/components/dashboard/employee-dashboard";

export default function DashboardPage() {
  const { user } = useAuth();
  if (!user) return null;
  return user.role === "EMPLOYEE" ? <EmployeeDashboard /> : <AdminDashboard />;
}
