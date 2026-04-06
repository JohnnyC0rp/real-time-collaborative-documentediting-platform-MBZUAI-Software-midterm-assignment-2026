import type { AccessRole } from "@collab/shared";

const roleLabelMap: Record<AccessRole, string> = {
  owner: "Owner",
  editor: "Editor",
  viewer: "Viewer"
};

export function RoleBadge({ role }: { role: AccessRole }) {
  return <span className={`role-badge role-${role}`}>{roleLabelMap[role]}</span>;
}
