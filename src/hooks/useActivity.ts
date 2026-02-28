import { useCallback } from "react";
import { apiFetch } from "../lib/api";

export type ActivityAction =
  | "SIGN_IN"
  | "SIGN_OUT"
  | "PAGE_VIEW"
  | "METRIC_SAVED"
  | "ROLLUP_RUN"
  | "SNAPSHOT_SAVED"
  | "LACDROP_SYNCED"
  | "WEEK_DELETED"
  | "WEEK_BACKDATED";

export function useActivity() {
  const log = useCallback(async (action: ActivityAction, detail?: string) => {
    try {
      await apiFetch("/api/activity", {
        method: "POST",
        body: JSON.stringify({ action, detail }),
      });
    } catch {
      // Activity logging should never break the UI — fail silently
    }
  }, []);

  return { log };
}