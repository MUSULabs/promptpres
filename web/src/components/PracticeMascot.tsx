import defaultPose from "../../design/mascot/ppre-default.svg?no-inline";
import guidingPose from "../../design/mascot/ppre-guiding.svg?no-inline";

export function PracticeMascot({ pose, className }: { pose: "default" | "guiding"; className?: string }) {
  return <img className={className} src={pose === "default" ? defaultPose : guidingPose} alt=""
    width="408" height="400" decoding="async" />;
}
