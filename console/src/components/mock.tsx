import { FlaskConical } from "lucide-react";
import { Badge } from "./ui";

export function MockBadge() {
  return (
    <Badge tone="warn">
      <FlaskConical size={11} /> 示例数据 · 内容域接口建设中
    </Badge>
  );
}
