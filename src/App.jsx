import React, { useEffect, useState } from "react";

const LEGACY_STORAGE_KEY = "merry-match-data";
const EMPTY_DATA = { names: [] };

function normalizeName(name) {
  return name.trim().toLowerCase();
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("The server returned an invalid response. Please try again.");
  }
  if (!response.ok) {
    throw new Error(result.error || "The request could not be completed.");
  }
  return result;
}

function App() {
  const [data, setData] = useState(EMPTY_DATA);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pinIsSet, setPinIsSet] = useState(false);
  const [pinAuthorized, setPinAuthorized] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [resetPhrase, setResetPhrase] = useState("");
  const [resetMode, setResetMode] = useState(false);
  const [pinNotice, setPinNotice] = useState("");
  const [page, setPage] = useState("home");
  const [newName, setNewName] = useState("");
  const [participantName, setParticipantName] = useState("");
  const [activeParticipant, setActiveParticipant] = useState("");
  const [notice, setNotice] = useState("");
  const [apiError, setApiError] = useState("");
  const [currentMatch, setCurrentMatch] = useState("");
  const [alreadyMatched, setAlreadyMatched] = useState(false);
  const [availableRecipients, setAvailableRecipients] = useState([]);

  useEffect(() => {
    async function loadData() {
      try {
        let legacyData = null;
        const saved = window.localStorage.getItem(LEGACY_STORAGE_KEY);
        if (saved) {
          try {
            legacyData = JSON.parse(saved);
          } catch (error) {
            console.error("Could not read saved Merry Match data:", error);
          }
        }
        await apiRequest("/api/legacy-import", {
          method: "POST",
          body: JSON.stringify({ data: legacyData }),
        });
        if (legacyData) window.localStorage.removeItem(LEGACY_STORAGE_KEY);
        setData(await apiRequest("/api/data"));
      } catch (error) {
        setApiError(error.message);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  async function loadResultsAccess() {
    setResultsLoading(true);
    setPinNotice("");
    try {
      const status = await apiRequest("/api/pin/status");
      setPinIsSet(status.pinIsSet);
      setPinAuthorized(status.authorized);
      if (status.authorized) {
        const result = await apiRequest("/api/matches");
        setMatches(result.matches);
      } else {
        setMatches([]);
      }
    } catch (error) {
      setPinNotice(error.message);
      setMatches([]);
      setPinAuthorized(false);
    } finally {
      setResultsLoading(false);
    }
  }

  function openPage(nextPage) {
    setPage(nextPage);
    setNotice("");
    setPinNotice("");
    if (nextPage === "results") {
      setMatches([]);
      setPinAuthorized(false);
      setResetMode(false);
      loadResultsAccess();
    } else {
      setMatches([]);
      setPinAuthorized(false);
    }
    if (nextPage !== "match") {
      setActiveParticipant("");
      setParticipantName("");
      setCurrentMatch("");
      setAlreadyMatched(false);
      setAvailableRecipients([]);
    }
  }

  async function submitPinSetup(event) {
    event.preventDefault();
    if (newPin !== confirmPin) {
      setPinNotice("The PIN entries don’t match.");
      return;
    }
    setBusy(true);
    setPinNotice("");
    try {
      await apiRequest("/api/pin/setup", {
        method: "POST",
        body: JSON.stringify({ pin: newPin }),
      });
      setPinIsSet(true);
      setNewPin("");
      setConfirmPin("");
      setPinNotice("PIN saved. Enter it below to view the matched results.");
    } catch (error) {
      setPinNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitPinUnlock(event) {
    event.preventDefault();
    setBusy(true);
    setPinNotice("");
    try {
      await apiRequest("/api/pin/unlock", {
        method: "POST",
        body: JSON.stringify({ pin: pinInput }),
      });
      const result = await apiRequest("/api/matches");
      setMatches(result.matches);
      setPinAuthorized(true);
      setPinInput("");
    } catch (error) {
      setPinNotice(error.message);
      setPinAuthorized(false);
      setMatches([]);
    } finally {
      setBusy(false);
    }
  }

  async function submitPinReset(event) {
    event.preventDefault();
    if (newPin !== confirmPin) {
      setPinNotice("The PIN entries don’t match.");
      return;
    }
    setBusy(true);
    setPinNotice("");
    try {
      await apiRequest("/api/pin/reset", {
        method: "POST",
        body: JSON.stringify({ phrase: resetPhrase, pin: newPin }),
      });
      setPinIsSet(true);
      setPinAuthorized(false);
      setMatches([]);
      setResetMode(false);
      setResetPhrase("");
      setPinInput("");
      setNewPin("");
      setConfirmPin("");
      setPinNotice("PIN reset. Enter your new PIN to view the matched results.");
    } catch (error) {
      setPinNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function addName(event) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) {
      setNotice("Enter a name to add to the gift list.");
      return;
    }
    setBusy(true);
    setNotice("");
    setApiError("");
    try {
      setData(await apiRequest("/api/names", {
        method: "POST",
        body: JSON.stringify({ name }),
      }));
      setNewName("");
      setNotice(`${name} has been added to the gift list.`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeName(name) {
    const confirmation = `Remove ${name} from the name list? Any saved gift match involving them will also be deleted.`;
    if (!window.confirm(confirmation)) return;

    setBusy(true);
    setNotice("");
    setApiError("");
    try {
      const result = await apiRequest("/api/names", {
        method: "DELETE",
        body: JSON.stringify({ name }),
      });
      setData({ names: result.names });
      if (normalizeName(activeParticipant) === normalizeName(name)) {
        setActiveParticipant("");
        setCurrentMatch("");
        setAvailableRecipients([]);
      }
      setNotice(result.removedMatch
        ? `${name} and their associated match have been removed.`
        : `${name} has been removed from the gift list.`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function startMatching(event) {
    event.preventDefault();
    const name = participantName.trim();
    if (!name) {
      setNotice("Enter your name to continue.");
      return;
    }

    setBusy(true);
    setNotice("");
    setApiError("");
    try {
      const result = await apiRequest("/api/matches/check", {
        method: "POST",
        body: JSON.stringify({ participant: name }),
      });
      setData(await apiRequest("/api/data"));
      setActiveParticipant(result.participant);
      setCurrentMatch("");
      setAlreadyMatched(result.alreadyMatched);
      setAvailableRecipients(result.availableRecipients);
      setNotice("");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function chooseRecipient(name) {
    setBusy(true);
    setNotice("");
    setApiError("");
    try {
      const result = await apiRequest("/api/matches", {
        method: "POST",
        body: JSON.stringify({ participant: activeParticipant, recipient: name }),
      });
      setData(await apiRequest("/api/data"));
      setCurrentMatch(result.match.recipient);
      setAlreadyMatched(false);
      setAvailableRecipients([]);
    } catch (error) {
      setNotice(error.message);
      try {
        const latest = await apiRequest("/api/matches/check", {
          method: "POST",
          body: JSON.stringify({ participant: activeParticipant }),
        });
        setAvailableRecipients(latest.availableRecipients);
        setAlreadyMatched(latest.alreadyMatched);
        setData(await apiRequest("/api/data"));
      } catch (refreshError) {
        setNotice(refreshError.message);
      }
    } finally {
      setBusy(false);
    }
  }

  function matchingAgain() {
    setActiveParticipant("");
    setParticipantName("");
    setCurrentMatch("");
    setAlreadyMatched(false);
    setAvailableRecipients([]);
    setNotice("");
  }

  const matchCount = matches.length;

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => openPage("home")} aria-label="Merry Match home">
          <span className="brand-icon" aria-hidden="true">✦</span>
          <span>Merry Match</span>
        </button>
        <span className="season-label"><span aria-hidden="true">✺</span> A little holiday magic</span>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow"><span aria-hidden="true">✦</span> THE GIFT EXCHANGE</span>
          <h1>Make someone’s<br /><em>season brighter.</em></h1>
          <p>A little mystery, a lot of cheer. Set up your names, find your person, and let the giving begin.</p>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="moon">✦</div>
          <div className="tree tree-back">♠</div>
          <div className="tree tree-front">♠</div>
          <div className="gift gift-one"><span /></div>
          <div className="gift gift-two"><span /></div>
          <div className="sparkle sparkle-one">✦</div>
          <div className="sparkle sparkle-two">✧</div>
          <div className="snow snow-one" />
          <div className="snow snow-two" />
          <div className="snow snow-three" />
        </div>
      </section>

      <nav className="page-nav" aria-label="Gift exchange pages">
        <button className={page === "home" ? "nav-item active" : "nav-item"} onClick={() => openPage("home")}>
          <span className="nav-number">01</span> Start here
        </button>
        <button className={page === "names" ? "nav-item active" : "nav-item"} onClick={() => openPage("names")}>
          <span className="nav-number">02</span> Name list <span className="nav-count">{data.names.length}</span>
        </button>
        <button className={page === "match" ? "nav-item active" : "nav-item"} onClick={() => openPage("match")}>
          <span className="nav-number">03</span> Find your match
        </button>
        <button className={page === "results" ? "nav-item active" : "nav-item"} onClick={() => openPage("results")}>
          <span className="nav-number">04</span> The matches <span className="nav-count">{pinAuthorized ? matchCount : "•••"}</span>
        </button>
      </nav>

      <section className="content-card">
        {apiError && <p className="notice notice-error" role="alert">{apiError}</p>}
        {loading && <div className="empty-state" role="status"><strong>Loading your saved gift exchange…</strong></div>}
        {!loading && page === "home" && (
          <div className="welcome-panel">
            <div className="section-heading">
              <span className="small-kicker">WELCOME TO THE EXCHANGE</span>
              <h2>Where would you like to go?</h2>
              <p>Choose a step below to get your gift exchange ready.</p>
            </div>
            <div className="action-grid">
              <button className="action-card" onClick={() => openPage("names")}>
                <span className="action-icon names-icon">♧</span>
                <span className="action-title">Add the names</span>
                <span className="action-description">Build the list of people who can receive a gift.</span>
                <span className="action-link">Manage name list <b aria-hidden="true">→</b></span>
              </button>
              <button className="action-card" onClick={() => openPage("match")}>
                <span className="action-icon match-icon">✧</span>
                <span className="action-title">Find your person</span>
                <span className="action-description">Enter your name and pick a mystery recipient.</span>
                <span className="action-link">Pick a match <b aria-hidden="true">→</b></span>
              </button>
              <button className="action-card" onClick={() => openPage("results")}>
                <span className="action-icon results-icon">❧</span>
                <span className="action-title">See the matches</span>
                <span className="action-description">Check which gift assignments have been made.</span>
                <span className="action-link">View results <b aria-hidden="true">→</b></span>
              </button>
            </div>
            <div className="privacy-note"><span aria-hidden="true">❄</span> Names stay hidden during the draw. Each person and recipient can only be matched once.</div>
          </div>
        )}

        {!loading && page === "names" && (
          <div className="page-panel">
            <div className="section-heading">
              <span className="small-kicker">STEP ONE · THE GUEST LIST</span>
              <h2>Who’s joining the fun?</h2>
              <p>Add everyone who can be picked as a gift recipient.</p>
            </div>
            <form className="add-name-form" onSubmit={addName}>
              <label className="sr-only" htmlFor="new-name">Name</label>
              <input id="new-name" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Type a name…" maxLength={60} />
              <button className="button button-green" type="submit" disabled={busy}>Add name <span aria-hidden="true">＋</span></button>
            </form>
            {notice && <p className="notice" role="status">{notice}</p>}
            <div className="list-heading"><span>THE NAME LIST</span><span>{data.names.length} {data.names.length === 1 ? "person" : "people"}</span></div>
            {data.names.length ? (
              <ul className="name-list">
                {data.names.map((name, index) => (
                  <li key={normalizeName(name)}>
                    <span className="name-avatar">{name.charAt(0).toLocaleUpperCase()}</span>
                    <span>{name}</span>
                    <span className="list-sprig" aria-hidden="true">{index % 2 ? "✦" : "❧"}</span>
                    <button className="remove-name" type="button" onClick={() => removeName(name)} disabled={busy} aria-label={`Remove ${name}`}>Remove</button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-state"><span aria-hidden="true">❄</span><strong>Your list is waiting for its first name.</strong><p>Add the people who’ll be part of the exchange.</p></div>
            )}
          </div>
        )}

        {!loading && page === "match" && (
          <div className="page-panel match-panel">
            <div className="section-heading">
              <span className="small-kicker">STEP TWO · THE MYSTERY DRAW</span>
              <h2>Ready to find your person?</h2>
              <p>Enter your name first. Your recipient stays secret until you choose.</p>
            </div>
            {!activeParticipant ? (
              <form className="participant-form" onSubmit={startMatching}>
                <label htmlFor="participant-name">Your name</label>
                <div className="input-row">
                  <input id="participant-name" value={participantName} onChange={(event) => setParticipantName(event.target.value)} placeholder="e.g. Alex" maxLength={60} />
                  <button className="button button-green" type="submit" disabled={busy}>Continue <span aria-hidden="true">→</span></button>
                </div>
                {notice && <p className="notice" role="status">{notice}</p>}
              </form>
            ) : (
              <>
                {notice && <p className="notice" role="status">{notice}</p>}
                {currentMatch ? (
                  <div className="reveal-card">
                    <span className="reveal-icon" aria-hidden="true">✦</span>
                    <span className="small-kicker">YOUR ONE-TIME GIFT REVEAL</span>
                    <h3>{currentMatch}</h3>
                    <p className="one-time-warning">This is the only time you can see your result. Once you leave this screen, your recipient won’t be shown again.</p>
                    <button className="text-button" onClick={matchingAgain}>Use a different name</button>
                  </div>
                ) : alreadyMatched ? (
                  <div className="already-matched-card" role="status">
                    <span className="reveal-icon" aria-hidden="true">✦</span>
                    <span className="small-kicker">MATCH ALREADY COMPLETED</span>
                    <h3>You’ve already been matched.</h3>
                    <p><strong>Your recipient was shown once and cannot be viewed again.</strong> Each person can see their match only one time.</p>
                    <button className="text-button" onClick={matchingAgain}>Use a different name</button>
                  </div>
                ) : data.names.length === 0 ? (
                  <div className="empty-state"><span aria-hidden="true">♧</span><strong>The name list is empty.</strong><p>Add recipients before anyone can draw a match.</p><button className="text-button" onClick={() => openPage("names")}>Go to name list →</button></div>
                ) : availableRecipients.length === 0 ? (
                  <div className="empty-state"><span aria-hidden="true">❄</span><strong>No recipients are available for you.</strong><p>All eligible names have been matched, or only your own name is left.</p></div>
                ) : (
                  <div className="draw-area">
                    <div className="draw-intro"><span className="draw-snowflake" aria-hidden="true">❄</span><div><strong>Choose one wrapped gift</strong><p>Your recipient’s name will be revealed just to you.</p></div></div>
                    <div className="gift-grid">
                      {availableRecipients.map((name, index) => (
                        <button className="mystery-gift" key={normalizeName(name)} onClick={() => chooseRecipient(name)} disabled={busy} aria-label={`Reveal mystery gift ${index + 1}`}>
                          <span className="gift-box" aria-hidden="true"><span className="gift-ribbon" /><span className="gift-bow" /></span>
                          <span className="gift-label">MYSTERY GIFT {String(index + 1).padStart(2, "0")}</span>
                        </button>
                      ))}
                    </div>
                    <p className="draw-footnote"><span aria-hidden="true">✦</span> Once you pick, your match is final.</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {!loading && page === "results" && (
          <div className="page-panel">
            <div className="section-heading">
              <span className="small-kicker">THE EXCHANGE · LIVE RESULTS</span>
              <h2>The gift matches</h2>
              <p>{pinAuthorized ? "Every completed match, gathered in one place." : "Enter the PIN to view the completed matches."}</p>
            </div>
            {resultsLoading ? (
              <div className="empty-state" role="status"><strong>Checking PIN access…</strong></div>
            ) : !pinAuthorized ? (
              <div className="pin-gate">
                {!pinIsSet ? (
                  <form className="pin-form" onSubmit={submitPinSetup}>
                    <h3>Create a results PIN</h3>
                    <p>Set a 4–12 digit PIN. You’ll need to enter it to see the matched results.</p>
                    <label htmlFor="new-pin">New PIN</label>
                    <input id="new-pin" type="password" inputMode="numeric" pattern="[0-9]{4,12}" autoComplete="new-password" value={newPin} onChange={(event) => setNewPin(event.target.value)} required />
                    <label htmlFor="confirm-new-pin">Confirm PIN</label>
                    <input id="confirm-new-pin" type="password" inputMode="numeric" pattern="[0-9]{4,12}" autoComplete="new-password" value={confirmPin} onChange={(event) => setConfirmPin(event.target.value)} required />
                    <button className="button button-green" type="submit" disabled={busy}>Save PIN <span aria-hidden="true">→</span></button>
                  </form>
                ) : resetMode ? (
                  <form className="pin-form" onSubmit={submitPinReset}>
                    <h3>Reset the results PIN</h3>
                    <p>Enter the reset phrase and choose a new 4–12 digit PIN.</p>
                    <label htmlFor="reset-phrase">Reset phrase</label>
                    <input id="reset-phrase" value={resetPhrase} onChange={(event) => setResetPhrase(event.target.value)} autoComplete="off" required />
                    <label htmlFor="reset-new-pin">New PIN</label>
                    <input id="reset-new-pin" type="password" inputMode="numeric" pattern="[0-9]{4,12}" autoComplete="new-password" value={newPin} onChange={(event) => setNewPin(event.target.value)} required />
                    <label htmlFor="reset-confirm-pin">Confirm new PIN</label>
                    <input id="reset-confirm-pin" type="password" inputMode="numeric" pattern="[0-9]{4,12}" autoComplete="new-password" value={confirmPin} onChange={(event) => setConfirmPin(event.target.value)} required />
                    <button className="button button-green" type="submit" disabled={busy}>Reset PIN <span aria-hidden="true">→</span></button>
                    <button className="text-button" type="button" onClick={() => { setResetMode(false); setPinNotice(""); }}>Back to PIN entry</button>
                  </form>
                ) : (
                  <form className="pin-form" onSubmit={submitPinUnlock}>
                    <h3>Enter the results PIN</h3>
                    <label htmlFor="results-pin">PIN</label>
                    <input id="results-pin" type="password" inputMode="numeric" pattern="[0-9]{4,12}" autoComplete="current-password" value={pinInput} onChange={(event) => setPinInput(event.target.value)} required />
                    <button className="button button-green" type="submit" disabled={busy}>View matches <span aria-hidden="true">→</span></button>
                    <button className="text-button" type="button" onClick={() => { setResetMode(true); setPinNotice(""); }}>Forgot PIN? Reset it</button>
                  </form>
                )}
                {pinNotice && <p className="notice" role="status">{pinNotice}</p>}
              </div>
            ) : matchCount ? (
              <>
                <div className="results-summary"><span className="summary-icon" aria-hidden="true">✧</span><span><strong>{matchCount} {matchCount === 1 ? "match" : "matches"} made</strong><small>There’s more holiday magic to come.</small></span><span className="summary-count">{String(matchCount).padStart(2, "0")}</span></div>
                <ul className="results-list">
                  {matches.map(({ participant, recipient }, index) => (
                    <li key={normalizeName(participant)}>
                      <span className="result-number">{String(index + 1).padStart(2, "0")}</span>
                      <span className="result-person">{participant}</span>
                      <span className="result-arrow" aria-hidden="true">→</span>
                      <span className="result-person recipient">{recipient}</span>
                      <span className="result-gift" aria-hidden="true">✦</span>
                    </li>
                  ))}
                </ul>
                <div className="pin-reset-action">
                  <button className="text-button" type="button" onClick={() => { setPinAuthorized(false); setMatches([]); setResetMode(true); setPinNotice(""); setNewPin(""); setConfirmPin(""); setResetPhrase(""); }}>Reset results PIN</button>
                </div>
              </>
            ) : (
              <div className="empty-state"><span aria-hidden="true">✧</span><strong>No matches just yet.</strong><p>Once someone picks a gift, their match will show up here.</p><button className="text-button" onClick={() => openPage("match")}>Make the first match →</button><button className="text-button" onClick={() => { setPinAuthorized(false); setMatches([]); setResetMode(true); setPinNotice(""); setNewPin(""); setConfirmPin(""); setResetPhrase(""); }}>Reset results PIN</button></div>
            )}
          </div>
        )}
      </section>

      <footer className="footer">
        <span>MADE FOR MERRY MOMENTS</span><span className="footer-star" aria-hidden="true">✦</span><span>SHARE A LITTLE JOY THIS SEASON</span>
      </footer>
    </main>
  );
}

export default App;
