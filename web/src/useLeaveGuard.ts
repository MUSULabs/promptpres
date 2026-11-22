import { useEffect, useRef } from "react";
import { useBlocker } from "react-router-dom";

/**
 * While `active`, ask before the page is left: links and back/forward inside the app are held by the
 * router (`blocker.state === "blocked"` until `proceed()` or `reset()`), and closing or reloading the
 * tab gets the browser's own leave-page prompt. `release()` turns the guard off for a navigation the
 * page starts itself (e.g. to the result page after a successful upload).
 */
export function useLeaveGuard(active: boolean) {
  const guard = useRef(active);
  guard.current = active;
  const released = useRef(false);
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    guard.current && !released.current && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => {
    if (!active) return;
    const stay = (event: BeforeUnloadEvent) => {
      if (released.current) return;
      event.preventDefault();
      event.returnValue = "";        // older browsers need a value to show the prompt
    };
    window.addEventListener("beforeunload", stay);
    return () => window.removeEventListener("beforeunload", stay);
  }, [active]);

  return { blocker, release: () => { released.current = true; } };
}
