"use client";

import * as React from "react";
import { Bug, Package, Rocket, Wrench } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DeployPatchesDialog } from "@/components/patches/deploy-dialog";
import { PatchSummary } from "@/components/patches/patch-summary";
import { PatchesTable } from "@/components/patches/patches-table";
import { VulnerabilitiesTable } from "@/components/patches/vulnerabilities-table";
import { useAuth } from "@/lib/auth";

export default function PatchesPage() {
  const { can } = useAuth();
  const canDeploy = can("patches:deploy");
  const [deployOpen, setDeployOpen] = React.useState(false);
  const [deployPatchIds, setDeployPatchIds] = React.useState<string[]>([]);

  const openDeploy = React.useCallback((patchIds: string[]) => {
    setDeployPatchIds(patchIds);
    setDeployOpen(true);
  }, []);

  return (
    <div className="grid min-w-0 gap-5">
      <PageHeader
        className="mb-0"
        title="Patch management"
        icon={Wrench}
        description="Missing operating system and application updates across the fleet, and the vulnerabilities they fix."
        actions={
          canDeploy ? (
            <Button size="sm" onClick={() => openDeploy([])}>
              <Rocket /> Deploy patches
            </Button>
          ) : undefined
        }
      />

      <PatchSummary />

      <Tabs defaultValue="patches" className="min-w-0">
        <TabsList>
          <TabsTrigger value="patches">
            <Package /> Patches
          </TabsTrigger>
          <TabsTrigger value="vulnerabilities">
            <Bug /> Vulnerabilities
          </TabsTrigger>
        </TabsList>
        <TabsContent value="patches" className="min-w-0">
          <PatchesTable canDeploy={canDeploy} onDeploy={openDeploy} />
        </TabsContent>
        <TabsContent value="vulnerabilities" className="min-w-0">
          <VulnerabilitiesTable />
        </TabsContent>
      </Tabs>

      {canDeploy && <DeployPatchesDialog open={deployOpen} onOpenChange={setDeployOpen} initialPatchIds={deployPatchIds} />}
    </div>
  );
}
