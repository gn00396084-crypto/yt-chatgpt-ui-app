// index.js — FINAL (UI + API + MCP-ready, Railway-ready)
// Env required:
//   CF_WORKER_BASE_URL = https://xxx.workers.dev

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.PORT || 3000);
const CF_WORKER_BASE_URL = process.env.CF_WORKER_BASE_URL;

if (!CF_WORKER_BASE_URL) {
  console.error("Missing CF_WORKER_BASE_URL env, e.g. https://xxx.workers.dev");
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ---------------- Security headers ---------------- */
function withSecurityHeaders(res, contentType = "text/html; charset=utf-8") {
  res.setHeader("Content-Type", contentType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");

  // UI uses inline <style>/<script>
  // allow YouTube embeds via frame-src
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "img-src 'self' data: https:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline'",
    "connect-src 'self' https:",
    "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
  ].join("; ");

  res.setHeader("Content-Security-Policy", csp);
}

function sendJson(res, status, data) {
  res.statusCode = status;
  withSecurityHeaders(res, "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function sendText(res, status, text) {
  res.statusCode = status;
  withSecurityHeaders(res, "text/plain; charset=utf-8");
  res.end(text);
}

async function sendFile(res, status, filename, contentType = "text/html; charset=utf-8") {
  const p = path.join(__dirname, filename);
  const buf = await readFile(p);
  res.statusCode = status;
  withSecurityHeaders(res, contentType);
  res.end(buf);
}

async function fetchWorkerJson(workerPath) {
  const url = new URL(workerPath, CF_WORKER_BASE_URL).toString();
  const r = await fetch(url, { headers: { accept: "application/json" } });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { ok: r.ok, status: r.status, json };
}

/* ---------------- Helpers ---------------- */
function normalizeText(s) {
  return String(s || "").toLowerCase().trim();
}

/**
 * Accept:
 * - "INyQfaZ8Xck"
 * - "https://www.youtube.com/watch?v=INyQfaZ8Xck"
 * - "https://youtu.be/INyQfaZ8Xck"
 * - "https://www.youtube.com/embed/INyQfaZ8Xck"
 * Return: 11-char videoId or ""
 */
function extractVideoId(input) {
  if (!input) return "";
  const s = String(input).trim();

  // already looks like a youtube video id
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;

  // try parse as URL
  try {
    const u = new URL(s);

    // watch?v=
    const v = u.searchParams.get("v");
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;

    // youtu.be/<id>
    if (u.hostname.includes("youtu.be")) {
      const id = u.pathname.replace("/", "");
      if (/^[a-zA-Z0-9_-]{11}$/.test(id)) return id;
    }

    // /embed/<id>
    const m = u.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
    if (m) return m[1];
  } catch {
    // not a URL, continue below
  }

  // fallback: find v=XXXXXXXXXXX anywhere
  const
