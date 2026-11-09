import { WorkspaceTabs } from "@/components/workspace/ui";
const items = [
  { href: "/admin/accounts", label: "Accounts & capabilities" },
  { href: "/admin/safety", label: "Safety & content" },
  { href: "/admin/templates", label: "Notification templates" },
  { href: "/admin/assessment-templates", label: "Assessment templates" },
  { href: "/admin/badges", label: "Badge policy" },
  { href: "/admin/matching", label: "Matching factors" },
  { href: "/admin/operations", label: "Operations & assistant reports" },
];
export function AdminNav({ current }: { current: string }) {
  return <WorkspaceTabs items={items} current={current} />;
}
