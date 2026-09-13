import { useState, useEffect, useCallback } from "react";
import { C } from "./App";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
        aria-describedby="email-error"
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

export default function CheckIn({ moduleNum, phase }) {
  const course = "OBLD500";
  const [status, setStatus] = useState("loading"); // loading | error | intro
  const [errorMessage, setErrorMessage] = useState("");
  const [instrument, setInstrument] = useState(null);
  const [email, setEmail] = useState("");

  const loadInstrument = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch(`/api/instrument/${course}/${moduleNum}/${phase}`);
      if (!res.ok) {
        throw new Error(res.status === 404 ? "No check-in found for this module." : `Error ${res.status}`);
      }
      const data = await res.json();
      setInstrument({ ...data, intro: data.intro });
      setStatus("intro");
    } catch (err) {
      setErrorMessage(err.message);
      setStatus("error");
    }
  }, [course, moduleNum, phase]);

  useEffect(() => { loadInstrument(); }, [loadInstrument]);

  if (status === "loading") return <LoadingScreen />;
  if (status === "error") return <ErrorScreen message={errorMessage} />;

  return (
    <IntroScreen
      instrument={instrument}
      moduleNum={moduleNum}
      phase={phase}
      email={email}
      setEmail={setEmail}
      onStart={() => { /* wired up in a later task */ }}
    />
  );
}
