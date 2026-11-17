import { useEffect, useState } from "react";

/** A blob: URL for `blob`, made once per blob and revoked when the blob changes or the component
 *  unmounts (URL.createObjectURL inside render made a new URL every render, reloaded the player and
 *  kept every recorded clip in memory). */
export function useObjectUrl(blob: Blob | null | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) { setUrl(undefined); return; }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}
