"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = {
  href: string;
  label: string;
  /** Extra path prefixes that should also mark this item as the current page. */
  also?: readonly string[];
};

function isCurrent(pathname: string, item: NavItem): boolean {
  return [item.href, ...(item.also ?? [])].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Account navigation with a visible and announced current-page state. */
export function AppNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname() ?? "";
  return (
    <nav aria-label="Account navigation" className="app-nav">
      <ul>
        {items.map((item) => {
          const current = isCurrent(pathname, item);
          return (
            <li key={item.href}>
              <Link className="app-nav-link" href={item.href} aria-current={current ? "page" : undefined}>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
