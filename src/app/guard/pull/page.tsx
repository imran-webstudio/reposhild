import { PullRepair } from "@/components/pull-repair";
import { parsePullTarget } from "@/lib/guard/repair";

export default async function PullRepairPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const target = parsePullTarget(await searchParams);
  return <PullRepair target={target} />;
}
