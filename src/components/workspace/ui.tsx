import Link from "next/link";
import type { ReactNode } from "react";
import { safeMessage } from "@/domains/shared/errors";

export function WorkspaceHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <section className="page-heading workspace-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children && <div className="workspace-heading-actions">{children}</div>}
    </section>
  );
}

export function WorkspaceError({ title, error }: { title: string; error: unknown }) {
  return (
    <section className="panel">
      <h1>{title}</h1>
      <div role="alert" className="notice warning">
        {safeMessage(error)}
      </div>
      <p>Refresh this page to try again. Saved records can be read again when the service is available.</p>
    </section>
  );
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="workspace-empty">
      <span className="workspace-empty-mark" aria-hidden="true">
        +
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

export function Section({ title, eyebrow, children }: { title: string; eyebrow?: string; children: ReactNode }) {
  return (
    <section className="panel workspace-section">
      {eyebrow && <span className="eyebrow">{eyebrow}</span>}
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function Status({ children }: { children: ReactNode }) {
  const label =
    typeof children === "string"
      ? children.replaceAll("_", " ").replace(/^\w/, (first) => first.toUpperCase())
      : children;
  return <span className="tag workspace-status">{label}</span>;
}

export function WorkspaceTabs({
  items,
  current,
}: {
  items: readonly { href: string; label: string }[];
  current: string;
}) {
  return (
    <nav className="workspace-tabs" aria-label="Workspace sections">
      {items.map((item) => (
        <Link key={item.href} href={item.href} aria-current={current === item.href ? "page" : undefined}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export const learningTabs = [
  { href: "/learning", label: "Learning overview" },
  { href: "/assessments", label: "Assessments" },
  { href: "/assignments", label: "Practice & assignments" },
  { href: "/study-plans", label: "Study plans" },
  { href: "/progress", label: "Progress & topic evidence" },
];

export function formatDate(value: string | null | undefined): string {
  if (!value) return "No date set";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
        date,
      );
}

export function formatInstant(value: string | null | undefined): string {
  if (!value) return "No time recorded";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : `${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date)} UTC`;
}

export function initials(value: string): string {
  return (
    value
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "T"
  );
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
