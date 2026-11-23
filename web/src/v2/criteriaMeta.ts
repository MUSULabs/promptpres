/* Level thresholds from config (GET /api/criteria), loaded once per page load and shared. The web code never
   holds a threshold of its own (repo rule 2): when this cannot load, a band is simply not drawn. */
import { useEffect, useState } from "react";
import { api } from "@/api";
import type { CriteriaMeta } from "@/contract";

let request: Promise<CriteriaMeta> | null = null;

export function useCriteriaMeta(): CriteriaMeta | null {
  const [meta, setMeta] = useState<CriteriaMeta | null>(null);
  useEffect(() => {
    let live = true;
    request ??= api.criteria().catch((e: unknown) => { request = null; throw e; }); // a failure is tried again next time
    request.then((m) => { if (live) setMeta(m); }).catch(() => { /* no band without the real numbers */ });
    return () => { live = false; };
  }, []);
  return meta;
}

/** T1 bands in % of the target (|speech span - target| / target) for level 4 and level 3, or null if unknown. */
export function t1Bands(meta: CriteriaMeta | null | undefined): { l4: number; l3: number } | null {
  const levels = meta?.T1?.levels;
  const l4 = levels?.["4"]?.deviation_pct, l3 = levels?.["3"]?.deviation_pct;
  return typeof l4 === "number" && typeof l3 === "number" ? { l4, l3 } : null;
}
