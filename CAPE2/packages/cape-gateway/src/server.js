const http = require('http');
const fs = require('fs');
const path = require('path');
const { geocodeAddress, searchPlaces } = require('./commute-planner');
const { createOpenClawOrchestrator } = require('./openclaw-orchestrator');

const DEFAULT_PORT = Number(process.env.CAPE_GATEWAY_PORT ?? 8787);
const DEFAULT_HOST = process.env.CAPE_GATEWAY_HOST ?? '127.0.0.1';
const MEMORY_DIR = process.env.OPENCLAW_CAPE_MEMORY_DIR ?? path.resolve(__dirname, '../../../openclaw/runtime');
const OPENCLAW_MEMORY_DIR = process.env.OPENCLAW_CAPE_PROFILE_DIR ?? path.resolve(__dirname, '../../../openclaw/memory');
const OPENCLAW_STATUS = {
  required: String(process.env.OPENCLAW_REQUIRED ?? '').toLowerCase() === 'true',
  baseUrl: process.env.OPENCLAW_BASE_URL ?? null,
  agentId: String(process.env.OPENCLAW_AGENT_ID ?? '').trim() || 'cape',
  method: process.env.OPENCLAW_AGENT_METHOD ?? 'agent'
};

function createServer(options = {}) {
  const runtimeDir = options.runtimeDir ?? MEMORY_DIR;
  const memoryDir = options.memoryDir ?? OPENCLAW_MEMORY_DIR;
  const openclaw = createOpenClawOrchestrator({
    runtimeDir,
    memoryDir,
    reasoningNoteBuilder: options.reasoningNoteBuilder,
    now: options.now,
    commuteAgentOptions: options.commuteAgentOptions
  });

  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        return sendJson(res, 200, {
          ok: true,
          service: 'cape-gateway',
          version: '0.1.0'
        });
      }

      if (req.method === 'GET' && req.url === '/v1/openclaw/status') {
        return sendJson(res, 200, {
          ok: true,
          openclaw: OPENCLAW_STATUS
        });
      }

      if (req.method === 'GET' && req.url === '/v1/runtime/latest') {
        return sendJson(res, 200, readRuntimeSnapshot(runtimeDir));
      }

      if (req.method === 'GET' && req.url === '/v1/runtime/dependencies') {
        return sendJson(res, 200, await checkDependencies());
      }

      if (req.method === 'GET' && req.url === '/dashboard') {
        return sendHtml(res, 200, renderDashboardHtml());
      }

      if (req.method === 'POST' && req.url === '/v1/context/decision') {
        const body = await readJson(req);
        return sendJson(res, 200, await openclaw.runContextDecision(body));
      }

      if (req.method === 'POST' && req.url === '/v1/feedback') {
        const body = await readJson(req);
        const result = await openclaw.recordFeedback(body);
        return sendJson(res, 200, {
          ok: true,
          message: 'feedback_recorded',
          learning: result.learning,
          openclaw: result.openclaw
        });
      }

      if (req.method === 'POST' && req.url === '/v1/maps/geocode') {
        const body = await readJson(req);
        if (!body.query) throw new Error('query_required');
        if (!process.env.GOOGLE_MAPS_API_KEY) throw new Error('google_maps_api_key_missing');
        const place = await geocodeAddress(body.query, process.env.GOOGLE_MAPS_API_KEY);
        return sendJson(res, 200, { place });
      }

      if (req.method === 'POST' && req.url === '/v1/maps/search') {
        const body = await readJson(req);
        if (!body.query) throw new Error('query_required');
        if (!process.env.GOOGLE_MAPS_API_KEY) throw new Error('google_maps_api_key_missing');
        const places = await searchPlaces(body.query, process.env.GOOGLE_MAPS_API_KEY);
        return sendJson(res, 200, { places });
      }

      return sendJson(res, 404, { error: 'not_found' });
    } catch (error) {
      return sendJson(res, 400, {
        error: 'bad_request',
        message: error.message
      });
    }
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('request_too_large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html)
  });
  res.end(html);
}

function readRuntimeSnapshot(runtimeDir) {
  const latestPath = path.join(runtimeDir, 'latest-context.json');
  const eventsPath = path.join(runtimeDir, 'events.jsonl');
  const latest = fs.existsSync(latestPath)
    ? JSON.parse(fs.readFileSync(latestPath, 'utf8'))
    : null;
  const recentEvents = fs.existsSync(eventsPath)
    ? fs.readFileSync(eventsPath, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .slice(-5)
        .map(line => JSON.parse(line))
        .reverse()
    : [];

  return {
    ok: true,
    runtimeDir,
    latest,
    recentEvents,
    openclaw: OPENCLAW_STATUS
  };
}

function renderDashboardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CAPE Live Console</title>
  <style>
    :root {
      --bg: #f3f7fc;
      --ink: #0f1f38;
      --muted: #60718c;
      --line: #d9e3ef;
      --card: rgba(255,255,255,0.82);
      --card-strong: rgba(255,255,255,0.94);
      --blue: #1c5ed6;
      --blue-soft: #eaf2ff;
      --navy: #122b57;
      --green: #198754;
      --green-soft: #eaf8f1;
      --amber: #b7791f;
      --amber-soft: #fff6e6;
      --red: #c53b43;
      --red-soft: #ffecee;
      --shadow: 0 20px 60px rgba(14, 33, 62, 0.09);
      --radius: 22px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(63, 126, 243, 0.20) 0, transparent 28%),
        radial-gradient(circle at 85% 0%, rgba(39, 174, 96, 0.17) 0, transparent 25%),
        linear-gradient(180deg, #f7fbff 0%, #eef4fb 100%);
    }
    .wrap { max-width: 1380px; margin: 0 auto; padding: 28px 20px 48px; }
    .hero {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-start;
      padding: 26px;
      margin-bottom: 18px;
      border-radius: 28px;
      background: linear-gradient(135deg, rgba(18,43,87,0.98), rgba(28,94,214,0.88));
      color: white;
      box-shadow: var(--shadow);
    }
    h1 { margin: 0; font-size: 34px; letter-spacing: -0.03em; }
    .sub { color: rgba(255,255,255,0.8); margin-top: 8px; max-width: 760px; line-height: 1.5; }
    .hero-stack { display: flex; flex-direction: column; gap: 12px; }
    .hero-strip { display: flex; flex-wrap: wrap; gap: 10px; }
    .pill {
      display: inline-flex;
      gap: 8px;
      align-items: center;
      padding: 8px 12px;
      border-radius: 999px;
      background: rgba(255,255,255,0.12);
      border: 1px solid rgba(255,255,255,0.18);
      font-size: 13px;
      color: white;
      backdrop-filter: blur(18px);
    }
    .grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 16px; }
    .card {
      background: var(--card);
      border: 1px solid rgba(217,227,239,0.95);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 18px;
      backdrop-filter: blur(20px);
    }
    .card-strong { background: var(--card-strong); }
    .span-4 { grid-column: span 4; }
    .span-6 { grid-column: span 6; }
    .span-8 { grid-column: span 8; }
    .span-3 { grid-column: span 3; }
    .span-5 { grid-column: span 5; }
    .span-7 { grid-column: span 7; }
    .span-9 { grid-column: span 9; }
    .span-12 { grid-column: span 12; }
    .eyebrow { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .10em; font-weight: 700; }
    .metric { font-size: 36px; font-weight: 800; margin: 8px 0 4px; letter-spacing: -0.04em; }
    .small { color: var(--muted); font-size: 13px; }
    .tiny { color: var(--muted); font-size: 11px; }
    .kv { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--line); align-items: flex-start; }
    .kv:last-child { border-bottom: 0; }
    .section-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      margin-bottom: 10px;
    }
    .hero-metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      min-width: min(460px, 100%);
    }
    .hero-metric {
      padding: 14px;
      border-radius: 20px;
      background: rgba(255,255,255,0.12);
      border: 1px solid rgba(255,255,255,0.16);
    }
    .hero-metric strong { display: block; font-size: 24px; letter-spacing: -0.03em; margin-top: 4px; }
    .summary-card {
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-height: 170px;
      justify-content: space-between;
    }
    .summary-badge {
      display: inline-flex;
      width: fit-content;
      padding: 6px 10px;
      border-radius: 999px;
      background: var(--blue-soft);
      color: var(--blue);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .06em;
    }
    .summary-copy {
      font-size: 22px;
      line-height: 1.25;
      font-weight: 700;
      letter-spacing: -0.03em;
    }
    .trace, .events { display: grid; gap: 10px; }
    .trace-item, .event-item {
      padding: 13px 14px;
      border-radius: 16px;
      border: 1px solid var(--line);
      background: #fff;
    }
    .trace-head, .event-head { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 6px; }
    .status {
      padding: 4px 8px; border-radius: 999px; font-size: 11px; font-weight: 700;
      text-transform: uppercase;
    }
    .ok { background: var(--green-soft); color: var(--green); }
    .suggest { background: var(--amber-soft); color: var(--amber); }
    .blocked, .error { background: var(--red-soft); color: var(--red); }
    .remote { background: var(--blue-soft); color: var(--blue); }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .action {
      border-radius: 999px; padding: 7px 10px; background: var(--blue-soft); color: var(--blue);
      font-size: 12px; font-weight: 600;
    }
    .reason {
      white-space: pre-wrap;
      line-height: 1.6;
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 14px 16px;
      margin-top: 10px;
    }
    .grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .signal-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .signal {
      padding: 14px;
      border-radius: 18px;
      background: rgba(255,255,255,0.95);
      border: 1px solid var(--line);
    }
    .signal strong {
      display: block;
      font-size: 24px;
      margin-top: 6px;
      letter-spacing: -0.03em;
    }
    .list-note {
      padding: 12px 14px;
      border-radius: 16px;
      border: 1px dashed var(--line);
      color: var(--muted);
      font-size: 13px;
      background: rgba(255,255,255,0.6);
    }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    @media (max-width: 900px) {
      .span-3, .span-4, .span-5, .span-6, .span-7, .span-8, .span-9 { grid-column: span 12; }
      .hero { flex-direction: column; align-items: start; }
      .hero-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); min-width: 100%; }
      .signal-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .grid-2 { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hero">
      <div class="hero-stack">
        <div class="pill" id="runtimePill">Loading runtime…</div>
        <div>
          <h1>CAPE Live Console</h1>
          <div class="sub">A real-time control surface for the Android app: live user context, stress intelligence, commute readiness, policy actions, safety gating, feedback memory, and OpenClaw runtime status.</div>
        </div>
        <div class="hero-strip" id="heroStrip"></div>
      </div>
      <div class="hero-metrics">
        <div class="hero-metric">
          <div class="tiny">Stress</div>
          <strong id="stressScore">--</strong>
          <div class="tiny" id="stressLevel">Waiting for runtime</div>
        </div>
        <div class="hero-metric">
          <div class="tiny">Pack</div>
          <strong id="packId">--</strong>
          <div class="tiny" id="decisionType">--</div>
        </div>
        <div class="hero-metric">
          <div class="tiny">Confidence</div>
          <strong id="confidence">--</strong>
          <div class="tiny" id="safetyState">--</div>
        </div>
        <div class="hero-metric">
          <div class="tiny">OpenClaw</div>
          <strong id="runtimeMode">--</strong>
          <div class="tiny" id="runtimeModeHint">--</div>
        </div>
      </div>
    </div>
    <div class="grid">
      <div class="card card-strong span-5">
        <div class="summary-card">
          <div>
            <div class="summary-badge">Current user state</div>
            <div class="summary-copy" id="userSummary">Waiting for CAPE to receive a live Android context snapshot.</div>
          </div>
          <div class="grid-2" id="summaryMeta"></div>
        </div>
      </div>
      <div class="card card-strong span-7">
        <div class="section-head">
          <div>
            <div class="eyebrow">Decision rationale</div>
            <div class="small">Why CAPE selected this pack and what it plans to change on the device right now.</div>
          </div>
        </div>
        <div class="reason" id="reasoningNote">No reasoning yet.</div>
        <div class="actions" id="actionsList"></div>
      </div>

      <div class="card span-12">
        <div class="section-head">
          <div>
            <div class="eyebrow">Live activity signals</div>
            <div class="small">What the phone is seeing about the user right now.</div>
          </div>
        </div>
        <div class="signal-grid" id="signalGrid"></div>
      </div>

      <div class="card span-4">
        <div class="section-head">
          <div>
            <div class="eyebrow">Context and permissions</div>
            <div class="small">Snapshot of user state, location, meeting readiness, and Android permission health.</div>
          </div>
        </div>
        <div id="contextList"></div>
      </div>

      <div class="card span-4">
        <div class="section-head">
          <div>
            <div class="eyebrow">Stress breakdown</div>
            <div class="small">Signal contribution and adaptive reasons behind the current score.</div>
          </div>
        </div>
        <div id="stressBreakdown"></div>
      </div>

      <div class="card span-4">
        <div class="section-head">
          <div>
            <div class="eyebrow">Commute intelligence</div>
            <div class="small">Departure timing, route readiness, and late-risk handling.</div>
          </div>
        </div>
        <div id="commutePanel"></div>
      </div>

      <div class="card span-8">
        <div class="section-head">
          <div>
            <div class="eyebrow">OpenClaw and agent pipeline</div>
            <div class="small">Full multi-agent reasoning path from intake to pack execution.</div>
          </div>
        </div>
        <div class="trace" id="traceList"></div>
      </div>
      <div class="card span-4">
        <div class="section-head">
          <div>
            <div class="eyebrow">Recent CAPE sessions</div>
            <div class="small">Latest decisions and learning events written by the gateway.</div>
          </div>
        </div>
        <div class="events" id="eventsList"></div>
      </div>

      <div class="card span-12">
        <div class="section-head">
          <div>
            <div class="eyebrow">Dependency readiness</div>
            <div class="small">Live health of OpenClaw, Ollama, Maps configuration, and Telegram dispatch.</div>
          </div>
        </div>
        <div class="trace" id="dependencyList"></div>
      </div>
    </div>
  </div>
  <script>
    const statusClass = value => {
      const text = String(value || '').toLowerCase();
      if (text.includes('block') || text.includes('error')) return 'blocked';
      if (text.includes('suggest')) return 'suggest';
      if (text.includes('remote')) return 'remote';
      return 'ok';
    };

    const fmt = value => value == null || value === '' ? '--' : value;
    const minutes = value => value == null ? '--' : value + ' min';
    const pct = value => value == null ? '--' : Math.round(Number(value) * 100) + '%';
    const joinOrNone = arr => Array.isArray(arr) && arr.length ? arr.join(', ') : 'none';
    const html = value => String(value ?? '').replace(/[&<>"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[char]));

    function summaryFor(context, decision, stress, openclaw) {
      const location = context.locationState || 'unknown';
      const title = context.nextMeetingTitle || 'no upcoming titled event';
      const meeting = context.nextMeetingMinutes != null ? context.nextMeetingMinutes + ' minutes away' : 'not imminent';
      const pack = decision.packId || 'no pack';
      const runtime = openclaw.runtime || 'not started';
      return \`User is currently \${location}, with \${meeting} and CAPE has selected \${pack} while running in \${runtime} mode. Next focus point: \${title}.\`;
    }

    async function load() {
      try {
        const [runtimeResponse, dependencyResponse] = await Promise.all([
          fetch('/v1/runtime/latest', { cache: 'no-store' }),
          fetch('/v1/runtime/dependencies', { cache: 'no-store' })
        ]);
        const data = await runtimeResponse.json();
        const dependencies = await dependencyResponse.json();
        const latest = data.latest || {};
        const decision = latest.decision || {};
        const context = latest.context || {};
        const stress = decision.stress || {};
        const openclaw = latest.openclaw || {};
        const safety = decision.safety || {};
        const commutePlan = decision.commutePlan || {};

        document.getElementById('runtimePill').textContent =
          'Runtime: ' + fmt(openclaw.runtime || data.openclaw.baseUrl || 'not started');
        document.getElementById('runtimeMode').textContent = fmt(openclaw.runtime || 'not started');
        document.getElementById('runtimeModeHint').textContent =
          openclaw.fallbackReason ? ('Fallback reason: ' + openclaw.fallbackReason) : ('Agent: ' + fmt(data.openclaw.agentId || openclaw.agentId));
        document.getElementById('stressScore').textContent =
          stress.score != null ? stress.score + '/100' : '--';
        document.getElementById('stressLevel').textContent =
          'Level: ' + fmt(stress.level) + ' · Reasons: ' + ((stress.reasons || []).join(', ') || 'none');
        document.getElementById('packId').textContent = fmt(decision.packId);
        document.getElementById('decisionType').textContent =
          'Type: ' + fmt(decision.type);
        document.getElementById('confidence').textContent =
          decision.confidence != null ? Math.round(decision.confidence * 100) + '%' : '--';
        document.getElementById('safetyState').textContent =
          'Safety: ' + fmt(safety.status) + (safety.blockers && safety.blockers.length ? ' · ' + safety.blockers.join('; ') : '');
        document.getElementById('reasoningNote').textContent =
          fmt(decision.reasoningNote || decision.explanation || 'No reasoning yet.');
        document.getElementById('userSummary').textContent = summaryFor(context, decision, stress, openclaw);
        document.getElementById('heroStrip').innerHTML = [
          ['Session', latest.sessionId || openclaw.sessionId || 'not recorded'],
          ['Location', context.locationState || 'unknown'],
          ['Meeting', context.nextMeetingTitle || 'none'],
          ['Todo pressure', context.todoPressureScore != null ? context.todoPressureScore + '/100' : 'none']
        ].map(([label, value]) => '<div class="pill"><strong>' + html(label) + ':</strong> ' + html(value) + '</div>').join('');
        document.getElementById('summaryMeta').innerHTML = [
          ['Current task mode', context.timeSegment],
          ['OpenClaw agent', data.openclaw.agentId || openclaw.agentId],
          ['Fallback reason', openclaw.fallbackReason],
          ['Safety status', safety.status]
        ].map(([label, value]) => '<div class="kv"><span>' + html(label) + '</span><strong>' + html(fmt(value)) + '</strong></div>').join('');

        const contextEntries = [
          ['Location', context.locationState],
          ['GPS', context.currentLocation ? (context.currentLocation.lat.toFixed(4) + ', ' + context.currentLocation.lng.toFixed(4)) : null],
          ['Meeting title', context.nextMeetingTitle],
          ['Meeting starts in', context.nextMeetingMinutes != null ? context.nextMeetingMinutes + ' min' : null],
          ['Meeting location', context.nextMeetingLocation],
          ['Sleep debt', context.sleepDebtMinutes != null ? context.sleepDebtMinutes + ' min' : null],
          ['App switches', context.appSwitchCountLast30Min],
          ['Unlocks', context.screenUnlockCountLast30Min],
          ['Notifications', context.notificationCountLast30Min],
          ['Screen time', context.screenTimeLast2hMinutes != null ? context.screenTimeLast2hMinutes + ' min' : null],
          ['Todo pressure', context.todoPressureScore != null ? context.todoPressureScore + '/100' : null],
          ['Implicit workload', context.implicitWorkload],
          ['Permissions', [
            context.permissions?.notificationPolicyAccess ? 'DND' : null,
            context.permissions?.writeSettings ? 'brightness' : null,
            context.permissions?.notifications ? 'notifications' : null,
            context.permissions?.calendar ? 'calendar' : null,
            context.permissions?.location ? 'location' : null,
            context.permissions?.usageStats ? 'usage' : null
          ].filter(Boolean).join(', ') || 'missing']
        ];
        document.getElementById('contextList').innerHTML = contextEntries
          .map(([label, value]) => '<div class="kv"><span>' + html(label) + '</span><strong>' + html(fmt(value)) + '</strong></div>')
          .join('');

        document.getElementById('actionsList').innerHTML = (decision.actions || decision.suggestedActions || [])
          .map(action => '<div class="action">' + html(action) + '</div>')
          .join('');

        document.getElementById('signalGrid').innerHTML = [
          ['Location state', context.locationState || 'unknown', 'Where the user is right now'],
          ['Foreground pattern', context.foregroundAppCategory || 'mixed', 'What kind of app behavior is active'],
          ['App switching', fmt(context.appSwitchCountLast30Min), 'Cognitive fragmentation proxy'],
          ['Unlock bursts', fmt(context.screenUnlockCountLast30Min), 'Focus drop proxy'],
          ['Screen intensity', minutes(context.screenTimeLast2hMinutes), 'Recent device intensity'],
          ['Notifications', fmt(context.notificationCountLast30Min), 'Recent interruption density'],
          ['Todo pressure', context.todoPressureScore != null ? context.todoPressureScore + '/100' : '--', 'Pending + urgent user load'],
          ['Workload signal', context.implicitWorkload || 'LOW', 'Derived workload estimate']
        ].map(([label, value, note]) => \`
          <div class="signal">
            <div class="tiny">\${html(label)}</div>
            <strong>\${html(fmt(value))}</strong>
            <div class="tiny">\${html(note)}</div>
          </div>\`).join('');

        document.getElementById('stressBreakdown').innerHTML = [
          ['Sleep', stress.components?.sleep != null ? stress.components.sleep + '/100' : null],
          ['App switches', stress.components?.appSwitches != null ? stress.components.appSwitches + '/100' : null],
          ['Unlocks', stress.components?.unlocks != null ? stress.components.unlocks + '/100' : null],
          ['Notifications', stress.components?.notifications != null ? stress.components.notifications + '/100' : null],
          ['Meetings', stress.components?.meetings != null ? stress.components.meetings + '/100' : null],
          ['Commute', stress.components?.commute != null ? stress.components.commute + '/100' : null],
          ['Usage', stress.components?.usage != null ? stress.components.usage + '/100' : null],
          ['Todo', stress.components?.todo != null ? stress.components.todo + '/100' : null],
          ['Reasons', joinOrNone(stress.reasons)],
          ['Smoothing', stress.smoothing || 'none']
        ].map(([label, value]) => '<div class="kv"><span>' + html(label) + '</span><strong>' + html(fmt(value)) + '</strong></div>').join('');

        document.getElementById('commutePanel').innerHTML = commutePlan && Object.keys(commutePlan).length
          ? [
              ['Destination', commutePlan.destination],
              ['Leave by', commutePlan.leaveByLocal],
              ['ETA', minutes(commutePlan.etaMinutes)],
              ['Buffer', minutes(commutePlan.bufferMinutes)],
              ['Alert needed', commutePlan.shouldAlert ? 'yes' : 'no'],
              ['Source', commutePlan.source],
              ['Reason', commutePlan.reason]
            ].map(([label, value]) => '<div class="kv"><span>' + html(label) + '</span><strong>' + html(fmt(value)) + '</strong></div>').join('')
          : '<div class="list-note">No commute plan is active for the current context.</div>';

        document.getElementById('traceList').innerHTML = (latest.agentTrace || [])
          .map(item => \`
            <div class="trace-item">
              <div class="trace-head">
                <strong>\${html(item.agent || 'agent')}</strong>
                <span class="status \${statusClass(item.status)}">\${fmt(item.status)}</span>
              </div>
              <div class="small">\${html(fmt(item.output))}</div>
            </div>\`)
          .join('') || '<div class="small">No trace yet.</div>';

        document.getElementById('eventsList').innerHTML = (data.recentEvents || [])
          .map(event => \`
            <div class="event-item">
              <div class="event-head">
                <strong>\${html(fmt(event.kind))}</strong>
                <span class="status \${statusClass(event.openclaw?.runtime || event.openclawSession?.status)}">\${fmt(event.openclaw?.runtime || event.openclawSession?.status)}</span>
              </div>
              <div class="small">\${html(fmt(event.decision?.packId || event.feedback?.packId || event.learning?.updated?.packId))}</div>
            </div>\`)
          .join('') || '<div class="small">No recent events yet.</div>';

        document.getElementById('dependencyList').innerHTML = Object.entries(dependencies.checks || {})
          .map(([name, check]) => \`
            <div class="trace-item">
              <div class="trace-head">
                <strong>\${html(name)}</strong>
                <span class="status \${statusClass(check.status)}">\${fmt(check.status)}</span>
              </div>
              <div class="small">\${html(fmt(check.detail))}</div>
            </div>\`)
          .join('');
      } catch (error) {
        document.getElementById('runtimePill').textContent = 'Dashboard load failed';
        document.getElementById('reasoningNote').textContent = error.message;
      }
    }

    load();
    setInterval(load, 2000);
  </script>
</body>
</html>`;
}

async function checkDependencies() {
  const checks = {
    openclaw: await probeJsonEndpoint(
      process.env.OPENCLAW_BASE_URL,
      '/health',
      'OpenClaw gateway'
    ),
    ollama: await probeJsonEndpoint(
      process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
      '/api/tags',
      'Ollama'
    ),
    maps: {
      status: hasConfiguredValue(process.env.GOOGLE_MAPS_API_KEY) ? 'configured' : 'missing',
      detail: hasConfiguredValue(process.env.GOOGLE_MAPS_API_KEY)
        ? 'Google Maps API key present'
        : 'GOOGLE_MAPS_API_KEY missing'
    },
    telegram: {
      status: hasConfiguredValue(process.env.TELEGRAM_BOT_TOKEN) && hasConfiguredValue(process.env.TELEGRAM_CHAT_ID)
        ? 'configured'
        : 'missing',
      detail: hasConfiguredValue(process.env.TELEGRAM_BOT_TOKEN) && hasConfiguredValue(process.env.TELEGRAM_CHAT_ID)
        ? 'Telegram bot token and chat id present'
        : 'Telegram env vars missing'
    }
  };

  return {
    ok: true,
    checks
  };
}

async function probeJsonEndpoint(baseUrl, pathSuffix, label) {
  const normalizedBaseUrl = normalizeDependencyUrl(baseUrl);
  if (!normalizedBaseUrl) {
    return {
      status: 'missing',
      detail: `${label} URL missing`
    };
  }

  try {
    const response = await fetch(`${normalizedBaseUrl}${pathSuffix}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    const text = await response.text();
    return {
      status: response.ok ? 'ok' : 'blocked',
      detail: response.ok
        ? `${label} reachable at ${normalizedBaseUrl}`
        : `${label} responded ${response.status}: ${text.slice(0, 140)}`
    };
  } catch (error) {
    return {
      status: 'blocked',
      detail: `${label} probe failed: ${error.message}`
    };
  }
}

function normalizeDependencyUrl(value) {
  const text = String(value ?? '').trim();
  if (!text || text.startsWith('replace_with')) return null;
  if (text.startsWith('ws://')) return text.replace(/^ws:\/\//, 'http://');
  if (text.startsWith('wss://')) return text.replace(/^wss:\/\//, 'https://');
  return text.replace(/\/$/, '');
}

function hasConfiguredValue(value) {
  const text = String(value ?? '').trim();
  return Boolean(text) && !text.startsWith('replace_with');
}

if (require.main === module) {
  const server = createServer();
  server.listen(DEFAULT_PORT, DEFAULT_HOST, () => {
    console.log(`CAPE gateway listening on http://${DEFAULT_HOST}:${DEFAULT_PORT}`);
    console.log(`CAPE memory writing to ${MEMORY_DIR}`);
  });
}

module.exports = {
  createServer
};
