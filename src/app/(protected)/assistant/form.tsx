"use client";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { FormResult } from "@/components/form-controls";
import type { Resource } from "@/domains/platform/types";
import type { LearningRelationship, StudyPlanListItem } from "@/domains/learning/types";
import { askAssistantAction, reportAssistantResponseAction, type AssistantState } from "./actions";
import { WorkflowForm } from "@/components/workspace/workflow-form";
const initial: AssistantState = { message: "" };
type AssistantFormProps = {
  configured: boolean;
  promptLimit: number;
  resources: Resource[];
  relationships: LearningRelationship[];
  plans: StudyPlanListItem[];
};
export function AssistantForm(props: AssistantFormProps) {
  const [version, setVersion] = useState(0);
  return (
    <>
      {version > 0 && (
        <p role="status" className="notice success">
          The question, selected context and generated output were cleared from this page.
        </p>
      )}
      <AssistantFormContent key={version} {...props} onClear={() => setVersion((value) => value + 1)} />
    </>
  );
}
function AssistantFormContent({
  configured,
  promptLimit,
  resources,
  relationships,
  plans,
  onClear,
}: AssistantFormProps & { onClear: () => void }) {
  const [state, action, pending] = useActionState(askAssistantAction, initial);
  const [submitted, setSubmitted] = useState<FormData | null>(null);
  const failed = !!state.message && !state.success;
  const contextErrors = ["context", "resourceIds", "bookingId", "planId"]
    .map((field) => state.fields?.[field])
    .filter(Boolean);
  const retained = (key: string) => (failed ? String(submitted?.get(key) ?? "") : "");
  const response = useRef<HTMLElement>(null);
  useEffect(() => {
    if (state.answer) response.current?.focus();
  }, [state]);
  return (
    <div className="workspace-stack">
      <form
        action={action}
        className="form"
        aria-label="Ask the learning assistant"
        onSubmit={(event) => setSubmitted(new FormData(event.currentTarget))}
      >
        <fieldset disabled={!configured || pending} className="form-fields">
          <div className="field">
            <label htmlFor="assistant-question">What would you like help understanding?</label>
            <textarea
              id="assistant-question"
              name="question"
              required
              rows={6}
              maxLength={promptLimit}
              defaultValue={state.values?.question ?? ""}
              aria-describedby="assistant-question-help"
              aria-invalid={!!state.fields?.question}
            />
            <span id="assistant-question-help" className={state.fields?.question ? "field-error" : "hint"}>
              {state.fields?.question ??
                `Ask for an explanation, a practice approach or help understanding selected material. Up to ${promptLimit} characters with the current configuration.`}
            </span>
          </div>
          <p id="assistant-context-help" className="hint">
            Select at least one session, study plan or resource below to ground your question in your learning.
          </p>
          <details className="workspace-details" open={contextErrors.length > 0}>
            <summary>Choose learning context (at least one required)</summary>
            {contextErrors.length > 0 && (
              <div id="assistant-context-error" className="field-error" role="alert">
                {contextErrors.map((message, index) => (
                  <p key={index}>{message}</p>
                ))}
              </div>
            )}
            <div className="workflow-fields">
              <div className="field">
                <label htmlFor="assistant-booking">Session (optional)</label>
                <select
                  id="assistant-booking"
                  name="bookingId"
                  key={`booking:${retained("bookingId")}`}
                  defaultValue={retained("bookingId")}
                  aria-invalid={!!state.fields?.bookingId}
                  aria-describedby={state.fields?.bookingId ? "assistant-context-error" : "assistant-context-help"}
                >
                  <option value="">No session context</option>
                  {relationships.map((row) => (
                    <option key={row.bookingId} value={row.bookingId}>
                      {row.subjectName} · {row.studentName} ·{" "}
                      {new Date(row.endsAt).toLocaleDateString("en-US", { timeZone: "UTC" })}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="assistant-plan">Study plan (optional)</label>
                <select
                  id="assistant-plan"
                  name="planId"
                  key={`plan:${retained("planId")}`}
                  defaultValue={retained("planId")}
                  aria-invalid={!!state.fields?.planId}
                  aria-describedby={state.fields?.planId ? "assistant-context-error" : "assistant-context-help"}
                >
                  <option value="">No study plan context</option>
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <fieldset
              className="workflow-choices"
              aria-invalid={!!state.fields?.resourceIds}
              aria-describedby={state.fields?.resourceIds ? "assistant-context-error" : "assistant-context-help"}
            >
              <legend>Resources to discuss (optional)</legend>
              {resources.slice(0, 20).map((resource) => (
                <label key={resource.id} className="checkbox">
                  <input
                    type="checkbox"
                    name="resourceIds"
                    value={resource.id}
                    defaultChecked={failed && submitted?.getAll("resourceIds").includes(resource.id)}
                  />
                  <span>{resource.title}</span>
                </label>
              ))}
            </fieldset>
            <p className="hint">Only authorized shared context is used. Your private reflections are not included.</p>
          </details>
          <button className="button primary" type="submit">
            {pending ? "Thinking…" : "Ask a learning question"}
            <span aria-hidden="true">→</span>
          </button>
        </fieldset>
        <FormResult state={state} />
      </form>
      <div>
        <button className="button secondary" type="button" onClick={onClear} disabled={pending}>
          Clear question & output
        </button>
        <p className="hint">
          This clears the local draft and generated output. Required usage and security records are retained.
        </p>
      </div>
      {state.answer && (
        <section ref={response} tabIndex={-1} className="workspace-record" aria-label="Assistant response">
          <span className="eyebrow">Learning assistant</span>
          <h3>Draft guidance</h3>
          {state.caveat && <p className="notice warning">{state.caveat}</p>}
          <p className="workspace-prose">{state.answer}</p>
          {!!state.resources?.length && (
            <>
              <h3>Selected source resources</h3>
              <ul>
                {state.resources.map((resource) => (
                  <li key={resource.id}>
                    <a href={resource.url} target="_blank" rel="noreferrer">
                      {resource.title} ↗
                    </a>
                    <p className="hint">{resource.attribution}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
          {state.values?.planId && (
            <p>
              <Link className="button secondary" href={`/study-plans/${state.values.planId}`}>
                Review your plan & proposal decisions →
              </Link>
            </p>
          )}
          <p className="hint">
            Check suggestions with your learning materials or tutor. This response does not change your study plan,
            assessment results or progress.
          </p>
          {state.requestId && (
            <details className="workspace-details">
              <summary>Report this assistant response</summary>
              <p>Describe the concern. The report references this response through an account-scoped request handle.</p>
              <WorkflowForm
                title="Report assistant response"
                action={reportAssistantResponseAction}
                hidden={{ requestId: state.requestId }}
                submit="Send response concern"
                fields={[
                  {
                    name: "reason",
                    label: "What should be reviewed about this response?",
                    type: "textarea",
                    required: true,
                    wide: true,
                    maxLength: 1000,
                  },
                ]}
              />
            </details>
          )}
        </section>
      )}
    </div>
  );
}
