"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FileUp, FolderKanban, ListChecks, ListTodo, UserRound } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Forbidden } from "@/components/common/states";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MyTasksTab } from "@/components/workforce/tasks/my-tasks-tab";
import { AllTasksTab } from "@/components/workforce/tasks/all-tasks-tab";
import { ProjectsTab } from "@/components/workforce/tasks/projects-tab";
import { ImportTab } from "@/components/workforce/tasks/import-tab";
import { isEmployee, useAuth } from "@/lib/auth";

type Tab = "mine" | "all" | "projects" | "import";

export default function WorkforceTasksPage() {
  return (
    <React.Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <TasksPageInner />
    </React.Suspense>
  );
}

function TasksPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { can, user } = useAuth();

  const visible: Tab[] = [];
  if (can("workforce:self")) visible.push("mine");
  if (can(["tasks:manage", "workforce:read"])) visible.push("all");
  if (can(["workforce:self", "tasks:manage", "workforce:read"])) visible.push("projects");
  if (can("tasks:manage")) visible.push("import");

  const raw = searchParams.get("tab") as Tab | null;
  const fallback = visible[0] ?? "mine";
  const tab: Tab = raw && visible.includes(raw) ? raw : fallback;
  const setTab = (t: string) => {
    const p = new URLSearchParams(searchParams.toString());
    if (t === fallback) p.delete("tab");
    else p.set("tab", t);
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const employee = isEmployee(user);

  return (
    <div className="min-w-0">
      <PageHeader
        title={employee ? "My Tasks" : "Tasks & Projects"}
        icon={ListTodo}
        description={
          employee
            ? "Your assigned work, time tracking and estimates."
            : "Assign and track work across teams — estimates vs actual time, delays, projects and imports from external systems."
        }
      />
      {visible.length === 0 ? (
        <Forbidden />
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            {visible.includes("mine") && (
              <TabsTrigger value="mine">
                <UserRound /> My tasks
              </TabsTrigger>
            )}
            {visible.includes("all") && (
              <TabsTrigger value="all">
                <ListChecks /> All tasks
              </TabsTrigger>
            )}
            {visible.includes("projects") && (
              <TabsTrigger value="projects">
                <FolderKanban /> Projects
              </TabsTrigger>
            )}
            {visible.includes("import") && (
              <TabsTrigger value="import">
                <FileUp /> Import
              </TabsTrigger>
            )}
          </TabsList>
          {visible.includes("mine") && (
            <TabsContent value="mine">
              <MyTasksTab />
            </TabsContent>
          )}
          {visible.includes("all") && (
            <TabsContent value="all">
              <AllTasksTab />
            </TabsContent>
          )}
          {visible.includes("projects") && (
            <TabsContent value="projects">
              <ProjectsTab />
            </TabsContent>
          )}
          {visible.includes("import") && (
            <TabsContent value="import">
              <ImportTab />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}
