import defaultPose from "../../design/mascot/ppre-default.svg?no-inline";
import guidingPose from "../../design/mascot/ppre-guiding.svg?no-inline";
import thinkingPose from "../../design/mascot/ppre-thinking.svg?no-inline";

const poses = { default: defaultPose, guiding: guidingPose, thinking: thinkingPose };

export function PracticeMascot({ pose, className }: { pose: keyof typeof poses; className?: string }) {
  return <img className={className} src={poses[pose]} alt=""
    width="408" height="400" decoding="async" />;
}
