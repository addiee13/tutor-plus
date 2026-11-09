"use client";
import Image from "next/image";
import { useState } from "react";
/** Public portrait is decorative beside the tutor's name; failed images fall back to readable initials. */
export function TutorAvatar({ name, url }: { name: string; url: string | null }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "T";
  return (
    <span className="tutor-avatar" aria-hidden="true">
      {url && failedUrl !== url ? (
        <Image
          src={url}
          alt=""
          width={64}
          height={64}
          unoptimized
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(url)}
          style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }}
        />
      ) : (
        initials
      )}
    </span>
  );
}
