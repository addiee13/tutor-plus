"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import type { LearningProgressFilters } from "@/domains/learning/types";
import { AssistantThinking } from "../assistant/thinking";
import { generateProgressSummaryAction, type ProgressSummaryState } from "./summary-actions";

type Props = { filters: LearningProgressFilters; configured: boolean };
const initial: ProgressSummaryState = {};

function SummaryText({ text }: { text: string }) {
  const blocks: Array<{ kind: "heading" | "paragraph"; text: string }> = [];
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };

  for (const line of text.split(/\r?\n/)) {
    const heading = line
      .trim()
      .match(
        /^(?:#{1,6}\s*)?(?:\*\*)?(Recorded learning|Areas to practise|Three suggested next steps|Evidence limits):?(?:\*\*)?:?$/i,
      );
    if (heading) {
      flushParagraph();
      blocks.push({ kind: "heading", text: heading[1] });
    } else if (!line.trim()) {
      flushParagraph();
    } else {
      paragraph.push(line);
    }
  }
  flushParagraph();

  return blocks.map((block, index) =>
    block.kind === "heading" ? (
      <h4 key={index}>{block.text}</h4>
    ) : (
      <p className="workspace-prose" key={index}>
        {block.text}
      </p>
    ),
  );
}

export function ProgressSummaryForm(props: Props) {
  const [version, setVersion] = useState(0);
  return (
    <ProgressSummaryContent
      key={`${JSON.stringify(props.filters)}:${version}`}
      {...props}
      onClear={() => setVersion((value) => value + 1)}
    />
  );
}

function ProgressSummaryContent({ filters, configured, onClear }: Props & { onClear: () => void }) {
  const [state, action, pending] = useActionState(generateProgressSummaryAction, initial);
  const response = useRef<HTMLElement>(null);
  useEffect(() => {
    if (state.summary && !pending) response.current?.focus();
  }, [state, pending]);

  return (
    <div className="workspace-stack">
      <p>
        Turn your recorded learning into a clear next step. AI reviews the available evidence in your selected progress
        view to summarize what you have covered, where more practice may help and what to try next.
      </p>
      <p className="hint">
        Generating a summary sends relevant learning records to our AI provider. Suggestions are a draft for your
        review; they do not update your progress or confirm mastery.
      </p>
      {!configured && (
        <p className="notice warning" role="status">
          AI summaries are unavailable until the assistant provider is connected. Your saved evidence remains available
          below.
        </p>
      )}
      <form action={action} aria-label="Generate AI learning progress summary" aria-busy={pending}>
        <input type="hidden" name="goal" value={filters.goalId ?? ""} />
        <input type="hidden" name="topic" value={filters.topic ? JSON.stringify(filters.topic) : ""} />
        <input type="hidden" name="tutor" value={filters.tutorId ?? ""} />
        <input type="hidden" name="from" value={filters.fromDate ?? ""} />
        <input type="hidden" name="to" value={filters.toDate ?? ""} />
        <div className="workspace-actions">
          <button className="button primary" type="submit" disabled={!configured || pending}>
            {pending
              ? "Reviewing your learning…"
              : state.summary
                ? "Generate a fresh summary"
                : "Generate AI progress summary"}
            <span aria-hidden="true">→</span>
          </button>
          {(state.summary || state.error) && (
            <button className="button secondary" type="button" onClick={onClear} disabled={pending}>
              Clear summary
            </button>
          )}
        </div>
      </form>
      {pending && (
        <AssistantThinking
          heading="Connecting the learning"
          description="Reviewing your recorded evidence to find useful next steps."
          reassurance="This can take about a minute. Your saved learning records are unchanged."
        />
      )}
      {!pending && state.error && (
        <div className="notice warning" role="alert">
          <p>{state.error}</p>
          {!!state.fieldErrors && (
            <ul>
              {[...new Set(Object.values(state.fieldErrors))].map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!pending && state.summary && (
        <section ref={response} tabIndex={-1} className="workspace-record" aria-label="AI learning progress summary">
          <span className="eyebrow">AI learning progress summary</span>
          <h3>Your learning, in perspective</h3>
          {state.generatedAt && (
            <p className="hint">
              Generated {new Date(state.generatedAt).toLocaleString("en-US", { timeZone: "UTC" })} UTC · Clear or
              regenerate when your records change.
            </p>
          )}
          {state.caveat && <p className="notice warning">{state.caveat}</p>}
          <SummaryText text={state.summary} />
          {!!state.sources?.length && (
            <>
              <h3>Records behind this summary</h3>
              <ul>
                {state.sources.map((source) => (
                  <li key={source.id}>
                    <Link className="small-link" href={source.path}>
                      [{source.id}] {source.label} →
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="hint">
            AI can misread evidence. Check the source records and discuss suggestions with your tutor. A single session
            or score does not establish improvement over time.
          </p>
        </section>
      )}
    </div>
  );
}
