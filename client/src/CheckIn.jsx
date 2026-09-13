import { useState, useEffect, useCallback, useRef } from "react";
import { C } from "./App";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const RESPONSIVE_STYLE = `
  .checkin-radio-row { display: flex; gap: 12px; justify-content: space-between; }
  @media (max-width: 480px) {
    .checkin-radio-row { flex-direction: column; align-items: stretch; gap: 0; }
    .checkin-radio-option { flex-direction: row !important; justify-content: flex-start !important; gap: 12px !important; padding: 8px 0; }
  }
`;

function LoadingScreen() {
  return (
    <div style={{ padding: 40, textAlign: "center", color: C.midGray }}>
      Loading...
    </div>
  );
}

function ErrorScreen({ message }) {
  return (
    <div style={{ padding: 40, maxWidth: 600, margin: "0 auto" }}>
      <div style={{ background: C.dangerBg, color: C.danger, padding: 20, borderRadius: 8 }}>
        {message}
      </div>
    </div>
  );
}

function IntroScreen({ instrument, moduleNum, phase, email, setEmail, onStart }) {
  const [touched, setTouched] = useState(false);
  const emailValid = EMAIL_RE.test(email.trim());

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "32px 20px" }}>
      <h1 style={{ fontSize: 24, color: C.navy, marginBottom: 4 }}>
        Module {moduleNum}: {instrument.topic}
      </h1>
      <p style={{ color: C.midGray, marginBottom: 20, textTransform: "capitalize" }}>
        {phase} Check-In
      </p>
      <p style={{ lineHeight: 1.6, marginBottom: 20 }}>{instrument.intro}</p>

      <div style={{ background: C.lightGray, borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <strong style={{ display: "block", marginBottom: 8 }}>Response scale</strong>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 13, color: C.textSec }}>
          {instrument.scale.labels.map((label) => (
            <span key={label} style={{ background: C.white, padding: "4px 8px", borderRadius: 4 }}>
              {label}
            </span>
          ))}
        </div>
      </div>

      <label htmlFor="checkin-email" style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
        Your ERAU email
      </label>
      <input
        id="checkin-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onBlur={() => setTouched(true)}
        style={{
          width: "100%", padding: 12, fontSize: 16, borderRadius: 6,
          border: `1px solid ${touched && !emailValid ? C.danger : C.lightGray}`,
          marginBottom: 6,
        }}
        aria-describedby={touched && !emailValid ? "email-error" : undefined}
      />
      {touched && !emailValid && (
        <p id="email-error" style={{ color: C.danger, fontSize: 13, marginBottom: 12 }}>
          Enter a valid email address.
        </p>
      )}

      <p style={{ fontSize: 13, color: C.midGray, margin: "16px 0" }}>
        Your responses are stored by LDRC for course measurement and are not
        part of your grade. See the{" "}
        <a href="/privacy" target="_blank" rel="noreferrer">privacy statement</a>.
      </p>
      <p style={{ fontSize: 13, color: C.midGray, marginBottom: 20 }}>
        Please complete this in one sitting, about eight minutes. A page
        refresh will lose your answers.
      </p>

      <button
        onClick={onStart}
        disabled={!emailValid}
        style={{
          padding: "12px 28px", fontSize: 16, borderRadius: 6, border: "none",
          background: emailValid ? C.navy : C.lightGray,
          color: emailValid ? C.white : C.midGray,
          cursor: emailValid ? "pointer" : "not-allowed",
          minHeight: 44,
        }}
      >
        Start
      </button>
    </div>
  );
}

function LikertItem({ item, value, onChange, scaleLabels, firstInputRef }) {
  return (
    <fieldset style={{ border: "none", borderBottom: `1px solid ${C.lightGray}`, padding: "16px 0", margin: 0 }}>
      <legend style={{ fontSize: 16, marginBottom: 12, padding: 0 }}>{item.text}</legend>
      <div className="checkin-radio-row" role="radiogroup" aria-label={item.text}>
        {scaleLabels.map((label, i) => {
          const optionValue = i + 1;
          const inputId = `${item.id}-${optionValue}`;
          return (
            <label
              key={optionValue}
              htmlFor={inputId}
              className="checkin-radio-option"
              style={{
                display: "flex", flexDirection: "column", alignItems: "center",
                gap: 4, fontSize: 12, color: C.textSec, textAlign: "center",
                cursor: "pointer", minHeight: 44, justifyContent: "center",
              }}
            >
              <input
                id={inputId}
                ref={i === 0 ? firstInputRef : undefined}
                type="radio"
                name={item.id}
                value={optionValue}
                checked={value === optionValue}
                onChange={() => onChange(item.id, optionValue)}
                style={{ width: 20, height: 20 }}
              />
              {label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function SubscaleScreen({ subscale, scaleLabels, answers, onAnswer, onNext, onBack, progressText }) {
  const allAnswered = subscale.items.every((item) => answers[item.id] != null);
  const [triedNext, setTriedNext] = useState(false);
  const firstUnansweredRef = useRef(null);
  const firstUnansweredItem = subscale.items.find((item) => answers[item.id] == null);
  const firstUnansweredId = firstUnansweredItem ? firstUnansweredItem.id : null;

  useEffect(() => {
    if (triedNext && firstUnansweredId && firstUnansweredRef.current) {
      firstUnansweredRef.current.focus();
    }
  }, [triedNext, firstUnansweredId]);

  const handleNext = () => {
    if (!allAnswered) {
      setTriedNext(true);
      return;
    }
    onNext();
  };

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "32px 20px" }}>
      <p aria-live="polite" style={{ fontSize: 13, color: C.midGray, marginBottom: 8 }}>
        {progressText}
      </p>
      <h2 style={{ fontSize: 20, color: C.navy, marginBottom: 4 }}>{subscale.name}</h2>
      <p style={{ color: C.textSec, marginBottom: 16 }}>{subscale.help}</p>

      {subscale.items.map((item) => (
        <LikertItem
          key={item.id}
          item={item}
          value={answers[item.id]}
          onChange={onAnswer}
          scaleLabels={scaleLabels}
          firstInputRef={item.id === firstUnansweredId ? firstUnansweredRef : undefined}
        />
      ))}

      {triedNext && !allAnswered && (
        <p role="alert" style={{ color: C.danger, fontSize: 13, margin: "12px 0" }}>
          Please answer every item before continuing.
        </p>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20 }}>
        <button onClick={onBack} style={{ padding: "10px 20px", borderRadius: 6, border: `1px solid ${C.lightGray}`, background: C.white, minHeight: 44 }}>
          Back
        </button>
        <button
          onClick={handleNext}
          style={{
            padding: "10px 24px", borderRadius: 6, border: "none", minHeight: 44,
            background: C.navy, color: C.white, cursor: "pointer",
          }}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function PostExperienceScreen({ items, scaleLabels, answers, onAnswer, onNext, onBack }) {
  const allAnswered = items.every((item) => answers[item.id] != null);
  const [triedNext, setTriedNext] = useState(false);
  const firstUnansweredRef = useRef(null);
  const firstUnansweredItem = items.find((item) => answers[item.id] == null);
  const firstUnansweredId = firstUnansweredItem ? firstUnansweredItem.id : null;

  useEffect(() => {
    if (triedNext && firstUnansweredId && firstUnansweredRef.current) {
      firstUnansweredRef.current.focus();
    }
  }, [triedNext, firstUnansweredId]);

  const handleNext = () => {
    if (!allAnswered) {
      setTriedNext(true);
      return;
    }
    onNext();
  };

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "32px 20px" }}>
      <p aria-live="polite" style={{ fontSize: 13, color: C.midGray, marginBottom: 8 }}>
        Reflecting on the module
      </p>
      <h2 style={{ fontSize: 20, color: C.navy, marginBottom: 16 }}>Post-Experience Reflection</h2>

      {items.map((item) => (
        <LikertItem
          key={item.id}
          item={item}
          value={answers[item.id]}
          onChange={onAnswer}
          scaleLabels={scaleLabels}
          firstInputRef={item.id === firstUnansweredId ? firstUnansweredRef : undefined}
        />
      ))}

      {triedNext && !allAnswered && (
        <p role="alert" style={{ color: C.danger, fontSize: 13, margin: "12px 0" }}>
          Please answer every item before continuing.
        </p>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20 }}>
        <button onClick={onBack} style={{ padding: "10px 20px", borderRadius: 6, border: `1px solid ${C.lightGray}`, background: C.white, minHeight: 44 }}>
          Back
        </button>
        <button
          onClick={handleNext}
          style={{ padding: "10px 24px", borderRadius: 6, border: "none", minHeight: 44, background: C.navy, color: C.white, cursor: "pointer" }}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function OpenEndedScreen({ prompts, answers, onAnswer, onNext, onBack }) {
  const MIN_LENGTH = 40;
  const allValid = prompts.every((p) => (answers[p.id] || "").trim().length >= MIN_LENGTH);
  const [triedNext, setTriedNext] = useState(false);

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "32px 20px" }}>
      <h2 style={{ fontSize: 20, color: C.navy, marginBottom: 16 }}>A Few Reflection Questions</h2>

      {prompts.map((p) => {
        const text = answers[p.id] || "";
        const tooShort = text.trim().length < MIN_LENGTH;
        return (
          <div key={p.id} style={{ marginBottom: 24 }}>
            <label htmlFor={p.id} style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
              {p.prompt}
            </label>
            <textarea
              id={p.id}
              value={text}
              onChange={(e) => onAnswer(p.id, e.target.value)}
              rows={4}
              style={{
                width: "100%", padding: 10, fontSize: 15, borderRadius: 6,
                border: `1px solid ${triedNext && tooShort ? C.danger : C.lightGray}`,
                fontFamily: "inherit",
              }}
              aria-describedby={`${p.id}-count`}
            />
            <p id={`${p.id}-count`} style={{ fontSize: 12, color: tooShort ? C.danger : C.midGray, marginTop: 4 }}>
              {text.trim().length} / {MIN_LENGTH} characters minimum
            </p>
          </div>
        );
      })}

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
        <button onClick={onBack} style={{ padding: "10px 20px", borderRadius: 6, border: `1px solid ${C.lightGray}`, background: C.white, minHeight: 44 }}>
          Back
        </button>
        <button
          onClick={() => (allValid ? onNext() : setTriedNext(true))}
          style={{ padding: "10px 24px", borderRadius: 6, border: "none", minHeight: 44, background: C.navy, color: C.white, cursor: "pointer" }}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function ReviewScreen({ instrument, phase, answeredCounts, onSubmit, onBack, submitting, submitError }) {
  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "32px 20px" }}>
      <h2 style={{ fontSize: 20, color: C.navy, marginBottom: 16 }}>Review</h2>

      <ul style={{ listStyle: "none", padding: 0, marginBottom: 20 }}>
        {answeredCounts.map((section) => (
          <li
            key={section.label}
            style={{
              display: "flex", justifyContent: "space-between", padding: "10px 0",
              borderBottom: `1px solid ${C.lightGray}`,
            }}
          >
            <span>{section.label}</span>
            <span style={{ color: section.answered === section.total ? C.success : C.danger }}>
              answered {section.answered} of {section.total}
            </span>
          </li>
        ))}
      </ul>

      {submitError && (
        <p role="alert" style={{ color: C.danger, marginBottom: 12 }}>{submitError}</p>
      )}

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <button onClick={onBack} disabled={submitting} style={{ padding: "10px 20px", borderRadius: 6, border: `1px solid ${C.lightGray}`, background: C.white, minHeight: 44 }}>
          Back
        </button>
        <button
          onClick={onSubmit}
          disabled={submitting}
          style={{
            padding: "10px 24px", borderRadius: 6, border: "none", minHeight: 44,
            background: submitting ? C.lightGray : C.navy, color: submitting ? C.midGray : C.white,
            cursor: submitting ? "default" : "pointer",
          }}
        >
          {submitting ? "Submitting..." : "Submit"}
        </button>
      </div>
    </div>
  );
}

function ConfirmationScreen({ completionText, moduleNum, completionCode }) {
  const [copied, setCopied] = useState(false);
  const text = completionText.replace("{module}", moduleNum);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(completionCode);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "32px 20px", textAlign: "center" }}>
      <h2 style={{ fontSize: 20, color: C.navy, marginBottom: 16 }}>Complete</h2>
      <p style={{ marginBottom: 24, lineHeight: 1.6 }}>{text}</p>

      <div style={{
        fontFamily: "monospace", fontSize: 24, letterSpacing: 2, background: C.lightGray,
        borderRadius: 8, padding: "16px 20px", marginBottom: 12, wordBreak: "break-all",
      }}>
        {completionCode}
      </div>

      <button
        onClick={handleCopy}
        style={{
          padding: "10px 24px", borderRadius: 6, border: "none", minHeight: 44,
          background: C.navy, color: C.white, cursor: "pointer",
        }}
      >
        {copied ? "Copied!" : "Copy code"}
      </button>
    </div>
  );
}

export default function CheckIn({ moduleNum, phase }) {
  const course = "OBLD500";
  const [status, setStatus] = useState("loading"); // loading | error | intro | subscale
  const [errorMessage, setErrorMessage] = useState("");
  const [instrument, setInstrument] = useState(null);
  const [email, setEmail] = useState("");
  const [answers, setAnswers] = useState({});
  const [subscaleIndex, setSubscaleIndex] = useState(0);
  const [pxAnswers, setPxAnswers] = useState({});
  const [openAnswers, setOpenAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [straightlineConfirmed, setStraightlineConfirmed] = useState(false);
  const [result, setResult] = useState(null);
  const [startedAt, setStartedAt] = useState(null);

  const loadInstrument = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch(`/api/instrument/${course}/${moduleNum}/${phase}`);
      if (!res.ok) {
        throw new Error(res.status === 404 ? "No check-in found for this module." : `Error ${res.status}`);
      }
      const data = await res.json();
      setInstrument(data);
      setStatus("intro");
    } catch (err) {
      setErrorMessage(err.message);
      setStatus("error");
    }
  }, [course, moduleNum, phase]);

  useEffect(() => { loadInstrument(); }, [loadInstrument]);

  const handleAnswer = (itemId, value) => {
    setAnswers((prev) => ({ ...prev, [itemId]: value }));
  };

  const isStraightlineLocal = () => {
    const allItems = instrument.subscales.flatMap((s) => s.items);
    const values = allItems.map((item) => answers[item.id]);
    return values.every((v) => v === values[0]);
  };

  const doSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body = {
        course,
        module: moduleNum,
        phase,
        identity: { email: email.trim() },
        started_at: startedAt,
        answers,
        ...(phase === "debrief" ? { extras: { post_experience: pxAnswers, open_ended: openAnswers } } : {}),
      };
      const res = await fetch("/api/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      setResult(data);
      setStatus("confirmation");
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitClick = () => {
    if (!straightlineConfirmed && isStraightlineLocal()) {
      const proceed = window.confirm("You answered every item the same way. Submit anyway?");
      if (!proceed) return;
      setStraightlineConfirmed(true);
    }
    doSubmit();
  };

  if (status === "loading") return <LoadingScreen />;
  if (status === "error") return <ErrorScreen message={errorMessage} />;

  return (
    <>
      <style>{RESPONSIVE_STYLE}</style>
      {status === "intro" && (
        <IntroScreen
          instrument={instrument}
          moduleNum={moduleNum}
          phase={phase}
          email={email}
          setEmail={setEmail}
          onStart={() => { setStartedAt(new Date().toISOString()); setStatus("subscale"); }}
        />
      )}
      {status === "subscale" && (
        <SubscaleScreen
          key={instrument.subscales[subscaleIndex].id}
          subscale={instrument.subscales[subscaleIndex]}
          scaleLabels={instrument.scale.labels}
          answers={answers}
          onAnswer={handleAnswer}
          progressText={`Section ${subscaleIndex + 1} of ${instrument.subscales.length}`}
          onBack={() => {
            if (subscaleIndex === 0) setStatus("intro");
            else setSubscaleIndex((i) => i - 1);
          }}
          onNext={() => {
            if (subscaleIndex < instrument.subscales.length - 1) {
              setSubscaleIndex((i) => i + 1);
            } else {
              setStatus(phase === "debrief" ? "post-experience" : "review");
            }
          }}
        />
      )}
      {status === "post-experience" && (
        <PostExperienceScreen
          items={instrument.debrief_extras.post_experience.items}
          scaleLabels={instrument.scale.labels}
          answers={pxAnswers}
          onAnswer={(id, v) => setPxAnswers((prev) => ({ ...prev, [id]: v }))}
          onBack={() => setStatus("subscale")}
          onNext={() => setStatus("open-ended")}
        />
      )}
      {status === "open-ended" && (
        <OpenEndedScreen
          prompts={instrument.debrief_extras.open_ended}
          answers={openAnswers}
          onAnswer={(id, v) => setOpenAnswers((prev) => ({ ...prev, [id]: v }))}
          onBack={() => setStatus("post-experience")}
          onNext={() => setStatus("review")}
        />
      )}
      {status === "review" && (
        <ReviewScreen
          instrument={instrument}
          phase={phase}
          answeredCounts={[
            ...instrument.subscales.map((s) => ({
              label: s.name,
              answered: s.items.filter((item) => answers[item.id] != null).length,
              total: s.items.length,
            })),
            ...(phase === "debrief" ? [
              {
                label: "Post-Experience Reflection",
                answered: instrument.debrief_extras.post_experience.items.filter((item) => pxAnswers[item.id] != null).length,
                total: instrument.debrief_extras.post_experience.items.length,
              },
              {
                label: "Reflection Questions",
                answered: instrument.debrief_extras.open_ended.filter((p) => (openAnswers[p.id] || "").trim().length >= 40).length,
                total: instrument.debrief_extras.open_ended.length,
              },
            ] : []),
          ]}
          onSubmit={handleSubmitClick}
          onBack={() => setStatus(phase === "debrief" ? "open-ended" : "subscale")}
          submitting={submitting}
          submitError={submitError}
        />
      )}
      {status === "confirmation" && result && (
        <ConfirmationScreen
          completionText={instrument.completion}
          moduleNum={moduleNum}
          completionCode={result.completion_code}
        />
      )}
    </>
  );
}
