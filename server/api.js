import { mkdirSync } from "node:fs";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const defaultDatabasePath = fileURLToPath(new URL("../data/merry-match.sqlite", import.meta.url));

export function normalizeName(name) {
  return name.trim().toLowerCase();
}

export function createDatabase(databasePath = process.env.MERRY_MATCH_DB_PATH || defaultDatabasePath) {
  if (databasePath !== ":memory:") {
    mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS participants (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY,
      participant_id INTEGER NOT NULL UNIQUE REFERENCES participants(id) ON DELETE CASCADE,
      recipient_id INTEGER NOT NULL UNIQUE REFERENCES participants(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (participant_id <> recipient_id)
    );
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return database;
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(response, status, value) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    let tooLarge = false;

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > 64 * 1024) {
        tooLarge = true;
        return;
      }
      body += chunk;
    });
    request.on("end", () => {
      if (tooLarge) {
        reject(new ApiError(413, "Request body is too large."));
        return;
      }
      try {
        const parsed = body ? JSON.parse(body) : {};
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          reject(new ApiError(400, "Request body must be a JSON object."));
          return;
        }
        resolve(parsed);
      } catch {
        reject(new ApiError(400, "Request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function validName(value) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 60;
}

function validPin(value) {
  return typeof value === "string" && /^\d{4,12}$/.test(value);
}

function getData(database) {
  const names = database.prepare("SELECT name FROM participants ORDER BY id").all().map(({ name }) => name);
  return { names };
}

function getMatches(database) {
  const matches = database.prepare(`
    SELECT participant.name AS participant, recipient.name AS recipient
    FROM matches
    JOIN participants AS participant ON participant.id = matches.participant_id
    JOIN participants AS recipient ON recipient.id = matches.recipient_id
    ORDER BY matches.id
  `).all();
  return matches;
}

function withTransaction(database, operation) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function shuffle(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const otherIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[otherIndex]] = [result[otherIndex], result[index]];
  }
  return result;
}

function importLegacyData(database, value) {
  const names = value?.names ?? [];
  const matches = value?.matches ?? {};
  if (
    !Array.isArray(names) ||
    !matches ||
    typeof matches !== "object" ||
    Array.isArray(matches)
  ) {
    throw new ApiError(400, "Saved gift-exchange data could not be imported.");
  }

  return withTransaction(database, () => {
    if (database.prepare("SELECT 1 FROM app_state WHERE key = ?").get("legacy_import_complete")) {
      return { imported: false, ...getData(database) };
    }

    const insertName = database.prepare(
      "INSERT OR IGNORE INTO participants (name, normalized_name) VALUES (?, ?)",
    );
    for (const name of names) {
      if (validName(name)) {
        const cleanedName = name.trim();
        insertName.run(cleanedName, normalizeName(cleanedName));
      }
    }

    const findName = database.prepare("SELECT id FROM participants WHERE normalized_name = ?");
    const insertMatch = database.prepare(
      "INSERT OR IGNORE INTO matches (participant_id, recipient_id) VALUES (?, ?)",
    );
    for (const match of Object.values(matches)) {
      if (!validName(match?.participant) || !validName(match?.recipient)) continue;
      const participant = findName.get(normalizeName(match.participant));
      const recipient = findName.get(normalizeName(match.recipient));
      if (participant && recipient && participant.id !== recipient.id) {
        insertMatch.run(participant.id, recipient.id);
      }
    }

    database.prepare("INSERT INTO app_state (key, value) VALUES (?, ?)").run(
      "legacy_import_complete",
      "1",
    );
    return { imported: true, ...getData(database) };
  });
}

export function createApiMiddleware(database = createDatabase()) {
  const sessions = new Map();
  const pinIsSet = () => Boolean(database.prepare("SELECT 1 FROM app_state WHERE key = ?").get("pin_hash"));
  const cookieName = "merry_match_session";

  function getSession(request) {
    const cookieHeader = request.headers.cookie || "";
    const token = cookieHeader.split(";").map((cookie) => cookie.trim())
      .find((cookie) => cookie.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    if (!token) return null;
    const expiresAt = sessions.get(token);
    if (!expiresAt || expiresAt <= Date.now()) {
      sessions.delete(token);
      return null;
    }
    return token;
  }

  function issueSession(request, response) {
    const token = randomBytes(32).toString("hex");
    sessions.set(token, Date.now() + 8 * 60 * 60 * 1000);
    const forwardedProto = request.headers["x-forwarded-proto"];
    const isHttps = request.socket.encrypted || forwardedProto === "https";
    response.setHeader(
      "Set-Cookie",
      `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=28800${isHttps ? "; Secure" : ""}`,
    );
  }

  function savePin(pin) {
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(pin, salt, 64).toString("hex");
    database.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)").run("pin_salt", salt);
    database.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)").run("pin_hash", hash);
  }

  function pinMatches(pin) {
    const salt = database.prepare("SELECT value FROM app_state WHERE key = ?").get("pin_salt")?.value;
    const expectedHash = database.prepare("SELECT value FROM app_state WHERE key = ?").get("pin_hash")?.value;
    if (!salt || !expectedHash) return false;
    const actualHash = scryptSync(pin, salt, 64);
    const expected = Buffer.from(expectedHash, "hex");
    return expected.length === actualHash.length && timingSafeEqual(expected, actualHash);
  }

  return (request, response, next) => {
    const url = new URL(request.url || "/", "http://localhost");
    if (!url.pathname.startsWith("/api/")) {
      next();
      return;
    }

    const respond = async () => {
      if (request.method === "GET" && url.pathname === "/api/data") {
        sendJson(response, 200, getData(database));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/pin/status") {
        sendJson(response, 200, { pinIsSet: pinIsSet(), authorized: Boolean(getSession(request)) });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/pin/setup") {
        const body = await readJson(request);
        if (pinIsSet()) throw new ApiError(409, "A PIN is already set.");
        if (!validPin(body.pin)) {
          throw new ApiError(400, "Choose a PIN with 4 to 12 digits.");
        }
        savePin(body.pin);
        sendJson(response, 200, { success: true });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/pin/unlock") {
        const body = await readJson(request);
        if (!validPin(body.pin) || !pinMatches(body.pin)) {
          throw new ApiError(401, "That PIN is incorrect.");
        }
        issueSession(request, response);
        sendJson(response, 200, { success: true });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/pin/reset") {
        const body = await readJson(request);
        if (body.phrase !== "devreset") {
          throw new ApiError(403, "The reset phrase is incorrect.");
        }
        if (!validPin(body.pin)) {
          throw new ApiError(400, "Choose a PIN with 4 to 12 digits.");
        }
        savePin(body.pin);
        for (const token of sessions.keys()) sessions.delete(token);
        sendJson(response, 200, { success: true });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/legacy-import") {
        const body = await readJson(request);
        sendJson(response, 200, importLegacyData(database, body.data));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/names") {
        const body = await readJson(request);
        if (!validName(body.name)) {
          throw new ApiError(400, "Enter a name of 1 to 60 characters.");
        }

        const name = body.name.trim();
        try {
          if (
            database.prepare("SELECT 1 FROM participants WHERE normalized_name = ?")
              .get(normalizeName(name))
          ) {
            throw new ApiError(409, "That name is already on the list.");
          }
          database.prepare(
            "INSERT INTO participants (name, normalized_name) VALUES (?, ?)",
          ).run(name, normalizeName(name));
        } catch (error) {
          if (error instanceof ApiError) throw error;
          if (error.message.includes("UNIQUE constraint failed")) {
            throw new ApiError(409, "That name is already on the list.");
          }
          throw error;
        }
        sendJson(response, 201, getData(database));
        return;
      }

      if (request.method === "DELETE" && url.pathname === "/api/names") {
        const body = await readJson(request);
        if (!validName(body.name)) {
          throw new ApiError(400, "Choose a name to remove.");
        }

        const normalizedName = normalizeName(body.name);
        const participant = database.prepare(
          "SELECT id FROM participants WHERE normalized_name = ?",
        ).get(normalizedName);
        if (!participant) {
          throw new ApiError(404, "That name is no longer on the list.");
        }
        const associatedMatch = Boolean(database.prepare(`
          SELECT 1 FROM matches
          WHERE participant_id = ? OR recipient_id = ?
        `).get(participant.id, participant.id));
        database.prepare("DELETE FROM participants WHERE id = ?").run(participant.id);
        sendJson(response, 200, { ...getData(database), removedMatch: associatedMatch });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/matches/check") {
        const body = await readJson(request);
        if (!validName(body.participant)) {
          throw new ApiError(400, "Enter a name from the gift list.");
        }

        const participant = database.prepare(
          "SELECT id, name FROM participants WHERE normalized_name = ?",
        ).get(normalizeName(body.participant));
        if (!participant) {
          throw new ApiError(404, "That name isn’t in the gift list. Add it before matching.");
        }

        const existingMatch = database.prepare(
          "SELECT 1 FROM matches WHERE participant_id = ?",
        ).get(participant.id);
        const availableRecipients = existingMatch
          ? []
          : database.prepare(`
              SELECT candidate.name
              FROM participants AS candidate
              WHERE candidate.id <> ?
                AND NOT EXISTS (
                  SELECT 1 FROM matches
                  WHERE matches.recipient_id = candidate.id
                )
              ORDER BY candidate.id
            `).all(participant.id).map(({ name }) => name);

        sendJson(response, 200, {
          participant: participant.name,
          alreadyMatched: Boolean(existingMatch),
          availableRecipients: shuffle(availableRecipients),
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/matches") {
        if (!getSession(request)) throw new ApiError(401, "Enter the PIN to view the matched results.");
        sendJson(response, 200, { matches: getMatches(database) });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/matches") {
        const body = await readJson(request);
        if (!validName(body.participant) || !validName(body.recipient)) {
          throw new ApiError(400, "Choose a valid participant and recipient.");
        }

        const match = withTransaction(database, () => {
          const findName = database.prepare(
            "SELECT id, name FROM participants WHERE normalized_name = ?",
          );
          const participant = findName.get(normalizeName(body.participant));
          const recipient = findName.get(normalizeName(body.recipient));
          if (!participant || !recipient) {
            throw new ApiError(404, "Both names must be on the gift list.");
          }
          if (participant.id === recipient.id) {
            throw new ApiError(400, "You can’t draw your own name.");
          }
          if (
            database.prepare("SELECT 1 FROM matches WHERE participant_id = ?").get(participant.id)
          ) {
            throw new ApiError(409, "This person already has a match.");
          }
          if (
            database.prepare("SELECT 1 FROM matches WHERE recipient_id = ?").get(recipient.id)
          ) {
            throw new ApiError(409, "That recipient has already been matched. Please choose again.");
          }

          database.prepare(
            "INSERT INTO matches (participant_id, recipient_id) VALUES (?, ?)",
          ).run(participant.id, recipient.id);
          return { participant: participant.name, recipient: recipient.name };
        });
        sendJson(response, 201, { match });
        return;
      }

      sendJson(response, 404, { error: "API endpoint not found." });
    };

    respond().catch((error) => {
      if (error instanceof ApiError) {
        sendJson(response, error.status, { error: error.message });
        return;
      }
      console.error("Merry Match API request failed:", error);
      sendJson(response, 500, { error: "The request could not be completed. Please try again." });
    });
  };
}
