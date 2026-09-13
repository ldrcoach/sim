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

export default function CheckIn({ moduleNum, phase }) {
  const course = "OBLD500";
  const [status, setStatus] = useState("loading"); // loading | error | intro | subscale
  const [errorMessage, setErrorMessage] = useState("");
  const [instrument, setInstrument] = useState(null);
  const [email, setEmail] = useState("");
  const [answers, setAnswers] = useState({});
  const [subscaleIndex, setSubscaleIndex] = useState(0);

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
          onStart={() => setStatus("subscale")}
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
      {status === "post-experience" && <LoadingScreen />}
      {status === "review" && <LoadingScreen />}
    </>
  );
}
