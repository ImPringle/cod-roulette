const REPEATS = 40;
const SPIN_DURATION = {
  game: 1800,
  map: 2200,
  challenge: 2600,
};
const SPIN_STAGGER = 220;
const SETTINGS_KEY = "cod-roulette-enabled";

let data = null;
let enabled = null;
let currentPick = null;
let settingsOpen = false;
const gameOpen = {};
const reels = {};
let spinning = false;
let hasSpun = false;

function itemHeight() {
  return parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--item-h"),
  );
}

function reelAxis() {
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue("--reel-axis")
      .trim() || "y"
  );
}

function itemSize() {
  if (reelAxis() === "x") {
    const item = document.querySelector(".reel .item");
    if (item) {
      const width = item.getBoundingClientRect().width;
      if (width) return width;
    }
    const reel = document.querySelector(".reel");
    if (reel) return reel.getBoundingClientRect().width / 3;
  }
  return itemHeight();
}

function stripTransform(index) {
  const offset = -((index - 1) * itemSize());
  return reelAxis() === "x"
    ? `translateX(${offset}px)`
    : `translateY(${offset}px)`;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatLabel(category, name) {
  const safe = escapeHtml(name);
  if (category !== "game") return safe;
  return safe.replace(/(\d+)/g, '<span class="num">$1</span>');
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function sameList(a, b) {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function mapKey(gameName, mapName) {
  return `${gameName}:::${mapName}`;
}

function defaultEnabled() {
  const next = { games: {}, maps: {}, challenges: {}, players: 4 };
  data.game.forEach((game) => {
    next.games[game.name] = true;
    game.maps.forEach((map) => {
      next.maps[mapKey(game.name, map.map)] = true;
    });
  });
  data.challenges.forEach((challenge) => {
    next.challenges[challenge.challenge] = true;
  });
  return next;
}

function normalizePlayers(value) {
  const count = Number(value);
  if (count >= 1 && count <= 4) return count;
  return 4;
}

function loadEnabled() {
  const defaults = defaultEnabled();
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
    if (!saved) return defaults;
    return {
      games: { ...defaults.games, ...saved.games },
      maps: { ...defaults.maps, ...saved.maps },
      challenges: { ...defaults.challenges, ...saved.challenges },
      players: normalizePlayers(saved.players ?? defaults.players),
    };
  } catch {
    return defaults;
  }
}

function saveEnabled() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(enabled));
}

function playerCount() {
  return enabled && enabled.players ? enabled.players : 4;
}

function challengeFitsMap(challenge, map) {
  if (challenge["require-pap"] && !map.pap) return false;
  if (challenge["require-perks"] && !map.perks) return false;
  if (challenge["require-gobblegums"] && !map.gobblegums) return false;
  if (challenge["require-easter-egg"] && !map.easter_egg) return false;
  if (challenge["require-easter-egg"]) {
    const minPlayers = Number(map.ee_min_players) || 1;
    if (playerCount() < minPlayers) return false;
  }
  return true;
}

function enabledMapsFor(game) {
  return game.maps.filter((map) => enabled.maps[mapKey(game.name, map.map)]);
}

function validChallenges(map) {
  return data.challenges.filter(
    (challenge) =>
      enabled.challenges[challenge.challenge] &&
      challengeFitsMap(challenge, map),
  );
}

function playableMaps(game) {
  if (!enabled.games[game.name]) return [];
  return enabledMapsFor(game).filter((map) => validChallenges(map).length);
}

function playableGames() {
  return data.game.filter((game) => playableMaps(game).length);
}

function firstPlayable() {
  const game = playableGames()[0];
  if (!game) return null;
  const map = playableMaps(game)[0];
  const challenge = validChallenges(map)[0];
  return { game, map, challenge };
}

function pickIsPlayable(pickState) {
  if (!pickState) return false;
  const game = data.game.find((entry) => entry.name === pickState.game.name);
  if (!game) return false;
  const map = playableMaps(game).find(
    (entry) => entry.map === pickState.map.map,
  );
  if (!map) return false;
  return validChallenges(map).some(
    (challenge) => challenge.challenge === pickState.challenge.challenge,
  );
}

function buildStrip(options) {
  const items = [];
  for (let i = 0; i < REPEATS; i += 1) {
    items.push(...options);
  }
  return items;
}

function idleIndex(options, optionIndex) {
  return options.length + optionIndex;
}

function setReelOptions(category, options, selectedName = options[0]) {
  const reelEl = document.querySelector(`[data-category="${category}"]`);
  const strip = reelEl.querySelector(".strip");
  const items = buildStrip(options);
  const optionIndex = Math.max(0, options.indexOf(selectedName));
  const start = idleIndex(options, optionIndex);

  strip.innerHTML = items
    .map(
      (name, index) =>
        `<div class="item" data-index="${index}"><span class="item-text">${formatLabel(category, name)}</span></div>`,
    )
    .join("");
  strip.style.transition = "none";
  strip.style.transform = stripTransform(start);

  reels[category] = {
    el: reelEl,
    strip,
    options,
    currentIndex: start,
  };

  reelEl.classList.add("stopped");
  markSelected(category, start);
}

function markSelected(category, index) {
  const { strip } = reels[category];
  strip.querySelectorAll(".item").forEach((item) => {
    item.classList.toggle("selected", Number(item.dataset.index) === index);
  });
}

function pickTarget(category, optionIndex) {
  const { options, currentIndex } = reels[category];
  const currentCycle = Math.floor(currentIndex / options.length);
  const minCycle = currentCycle + 14;
  const extra = Math.floor(Math.random() * 6);
  return (minCycle + extra) * options.length + optionIndex;
}

function spinReel(category, options, result) {
  if (!reels[category] || !sameList(reels[category].options, options)) {
    setReelOptions(category, options);
  }

  const reel = reels[category];
  const optionIndex = Math.max(0, options.indexOf(result));
  const target = pickTarget(category, optionIndex);
  const duration = SPIN_DURATION[category];

  reel.el.classList.remove("stopped");
  markSelected(category, -1);

  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      reel.strip.style.transition = `transform ${duration}ms cubic-bezier(0.12, 0.7, 0.16, 1)`;
      reel.strip.style.transform = stripTransform(target);
      reel.currentIndex = target;

      window.setTimeout(() => {
        markSelected(category, target);
        reel.el.classList.add("stopped");
        settleReel(category, target);
        resolve();
      }, duration);
    });
  });
}

function settleReel(category, index) {
  const reel = reels[category];
  const optionIndex = index % reel.options.length;
  const reset = idleIndex(reel.options, optionIndex);

  window.setTimeout(() => {
    reel.strip.style.transition = "none";
    reel.strip.style.transform = stripTransform(reset);
    reel.currentIndex = reset;
    markSelected(category, reset);
  }, 40);
}

function blinkColumn(category) {
  const col = document
    .querySelector(`[data-category="${category}"]`)
    .closest(".reel-col");
  col.classList.remove("hit");
  void col.offsetWidth;
  col.classList.add("locked", "hit");
}

function clearBlinks() {
  document.querySelectorAll(".reel-col").forEach((col) => {
    col.classList.remove("hit", "locked");
  });
}

function lockAllTitles() {
  document.querySelectorAll(".reel-col").forEach((col) => {
    col.classList.add("locked");
  });
}

function showResult(game, map, challenge) {
  currentPick = { game, map, challenge };
  const games = playableGames();
  setReelOptions(
    "game",
    games.map((entry) => entry.name),
    game.name,
  );
  setReelOptions(
    "map",
    playableMaps(game).map((entry) => entry.map),
    map.map,
  );
  setReelOptions(
    "challenge",
    validChallenges(map).map((entry) => entry.challenge),
    challenge.challenge,
  );
  lockAllTitles();
}

function idleHint() {
  return "Tap or press space to spin";
}

function setRules(challenge) {
  const el = document.getElementById("rules");
  if (!el) return;
  const text = challenge && challenge.rules ? String(challenge.rules).trim() : "";
  if (!hasSpun || !text) {
    el.classList.remove("is-on");
    return;
  }
  el.textContent = text;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.classList.add("is-on");
    });
  });
}

function showEmpty() {
  currentPick = null;
  setReelOptions("game", ["—"], "—");
  setReelOptions("map", ["—"], "—");
  setReelOptions("challenge", ["—"], "—");
  clearBlinks();
  setRules(null);
  document.getElementById("hint").textContent =
    "Enable a game, map, and challenge in settings";
}

function applySettings() {
  saveEnabled();
  if (spinning) return;
  if (pickIsPlayable(currentPick)) {
    showResult(currentPick.game, currentPick.map, currentPick.challenge);
    setRules(currentPick.challenge);
    document.getElementById("hint").textContent = idleHint();
    return;
  }
  const next = firstPlayable();
  if (next) {
    showResult(next.game, next.map, next.challenge);
    setRules(next.challenge);
    document.getElementById("hint").textContent = idleHint();
    return;
  }
  showEmpty();
}

function renderSettings() {
  const body = document.getElementById("settings-body");
  const gamesHtml = data.game
    .map((game) => {
      const gameOff = !enabled.games[game.name];
      const collapsed = gameOpen[game.name] === false;
      const maps = game.maps
        .map(
          (map) => `
            <label class="settings-row">
              <input
                type="checkbox"
                data-kind="map"
                data-game="${escapeHtml(game.name)}"
                data-name="${escapeHtml(map.map)}"
                ${enabled.maps[mapKey(game.name, map.map)] ? "checked" : ""}
              />
              <span>${escapeHtml(map.map)}</span>
            </label>
          `,
        )
        .join("");

      return `
        <div class="settings-group${gameOff ? " is-off" : ""}${collapsed ? " is-collapsed" : ""}">
          <div class="settings-game">
            <label class="settings-row">
              <input
                type="checkbox"
                data-kind="game"
                data-name="${escapeHtml(game.name)}"
                ${enabled.games[game.name] ? "checked" : ""}
              />
              <span>${formatLabel("game", game.name)}</span>
            </label>
            <button
              class="settings-fold"
              type="button"
              data-game="${escapeHtml(game.name)}"
              aria-expanded="${collapsed ? "false" : "true"}"
              aria-label="${collapsed ? "Expand" : "Collapse"} ${escapeHtml(game.name)} maps"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z" />
              </svg>
            </button>
          </div>
          <div class="settings-maps">
            <div class="settings-maps-inner">${maps}</div>
          </div>
        </div>
      `;
    })
    .join("");

  const challengesHtml = data.challenges
    .map(
      (challenge) => `
        <label class="settings-row">
          <input
            type="checkbox"
            data-kind="challenge"
            data-name="${escapeHtml(challenge.challenge)}"
            ${enabled.challenges[challenge.challenge] ? "checked" : ""}
          />
          <span>${escapeHtml(challenge.challenge)}</span>
        </label>
      `,
    )
    .join("");

  const playersHtml = [1, 2, 3, 4]
    .map(
      (count) => `
        <label class="settings-player">
          <input
            type="radio"
            name="players"
            data-kind="players"
            value="${count}"
            ${playerCount() === count ? "checked" : ""}
          />
          <span>${count}</span>
        </label>
      `,
    )
    .join("");

  body.innerHTML = `
    <section class="settings-section">
      <h3 class="settings-kicker">Players</h3>
      <div class="settings-players" role="radiogroup" aria-label="Number of players">
        ${playersHtml}
      </div>
    </section>
    <section class="settings-section">
      <h3 class="settings-kicker">Games & maps</h3>
      ${gamesHtml}
    </section>
    <section class="settings-section">
      <h3 class="settings-kicker">Challenges</h3>
      ${challengesHtml}
    </section>
  `;
}

function onSettingsChange(event) {
  const input = event.target.closest("input");
  if (!input) return;

  if (input.dataset.kind === "players") {
    enabled.players = normalizePlayers(input.value);
    applySettings();
    return;
  }

  if (input.type !== "checkbox") return;

  const kind = input.dataset.kind;
  const name = input.dataset.name;
  const on = input.checked;

  if (kind === "game") {
    enabled.games[name] = on;
    input.closest(".settings-group").classList.toggle("is-off", !on);
  } else if (kind === "map") {
    enabled.maps[mapKey(input.dataset.game, name)] = on;
  } else if (kind === "challenge") {
    enabled.challenges[name] = on;
  }

  applySettings();
}

function onSettingsClick(event) {
  const fold = event.target.closest(".settings-fold");
  if (!fold) return;

  const name = fold.dataset.game;
  const group = fold.closest(".settings-group");
  const collapsed = !group.classList.contains("is-collapsed");
  group.classList.toggle("is-collapsed", collapsed);
  fold.setAttribute("aria-expanded", collapsed ? "false" : "true");
  fold.setAttribute(
    "aria-label",
    `${collapsed ? "Expand" : "Collapse"} ${name} maps`,
  );
  gameOpen[name] = !collapsed;
}

function openSettings() {
  settingsOpen = true;
  renderSettings();
  document.body.classList.add("settings-open");
  const overlay = document.getElementById("settings-overlay");
  overlay.setAttribute("aria-hidden", "false");
  document.getElementById("settings-toggle").setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      overlay.classList.add("is-open");
    });
  });
}

function closeSettings() {
  settingsOpen = false;
  document.body.classList.remove("settings-open");
  const overlay = document.getElementById("settings-overlay");
  overlay.classList.remove("is-open");
  overlay.setAttribute("aria-hidden", "true");
  document.getElementById("settings-toggle").setAttribute("aria-expanded", "false");
  document.getElementById("settings-toggle").focus();
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function spin() {
  if (spinning || !data || settingsOpen) return;
  const games = playableGames();
  if (!games.length) {
    showEmpty();
    return;
  }

  spinning = true;
  document.body.classList.add("spinning");
  clearBlinks();
  setRules(null);
  document.getElementById("hint").textContent = "Spinning…";

  const game = pick(games);
  const maps = playableMaps(game);
  const map = pick(maps);
  const challenges = validChallenges(map);
  const challenge = pick(challenges);

  const gameSpin = spinReel(
    "game",
    games.map((entry) => entry.name),
    game.name,
  );
  await delay(SPIN_STAGGER);
  const mapSpin = spinReel(
    "map",
    maps.map((entry) => entry.map),
    map.map,
  );
  await delay(SPIN_STAGGER);
  const challengeSpin = spinReel(
    "challenge",
    challenges.map((entry) => entry.challenge),
    challenge.challenge,
  );

  await gameSpin;
  blinkColumn("game");
  await mapSpin;
  blinkColumn("map");
  await challengeSpin;
  blinkColumn("challenge");

  currentPick = { game, map, challenge };
  hasSpun = true;
  spinning = false;
  document.body.classList.remove("spinning");
  setRules(challenge);
  document.getElementById("hint").textContent = idleHint();
}

function startBlood() {
  const layer = document.getElementById("fluid");
  if (!layer) return;

  const canvas = document.createElement("canvas");
  canvas.className = "blood-canvas";
  layer.append(canvas);
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let width = 0;
  let height = 0;
  let last = 0;

  const cells = Array.from({ length: 8 }, () => ({
    nx: Math.random(),
    ny: 0.35 + Math.random() * 0.7,
    nr: 0.18 + Math.random() * 0.22,
    vx: (Math.random() - 0.5) * 0.012,
    vy: (Math.random() - 0.5) * 0.008,
    phase: Math.random() * Math.PI * 2,
  }));

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function wrap(value) {
    if (value < -0.25) return value + 1.5;
    if (value > 1.25) return value - 1.5;
    return value;
  }

  function drawCell(cell, time) {
    const x = cell.nx * width;
    const y = cell.ny * height;
    const pulse = 1 + Math.sin(time * 0.00025 + cell.phase) * 0.06;
    const r = Math.max(width, height) * cell.nr * pulse;
    const glow = ctx.createRadialGradient(x, y, r * 0.08, x, y, r);
    glow.addColorStop(0, "rgba(110, 14, 20, 0.42)");
    glow.addColorStop(0.4, "rgba(72, 8, 12, 0.18)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function tick(time) {
    const dt = last ? Math.min((time - last) / 1000, 0.05) : 0.016;
    last = time;
    ctx.clearRect(0, 0, width, height);
    cells.forEach((cell) => {
      if (!reduced) {
        cell.nx = wrap(cell.nx + cell.vx * dt);
        cell.ny = wrap(cell.ny + cell.vy * dt);
      }
      drawCell(cell, time);
    });
    requestAnimationFrame(tick);
  }

  resize();
  window.addEventListener("resize", resize);
  requestAnimationFrame(tick);
}

async function init() {
  startBlood();

  try {
    const response = await fetch("data.json");
    data = await response.json();
  } catch {
    document.getElementById("hint").textContent =
      "Could not load data.json — check for a syntax error";
    return;
  }

  enabled = loadEnabled();

  const start = firstPlayable();
  if (start) showResult(start.game, start.map, start.challenge);
  else showEmpty();

  document.getElementById("settings-toggle").addEventListener("click", () => {
    if (settingsOpen) closeSettings();
    else openSettings();
  });
  document.getElementById("settings-close").addEventListener("click", closeSettings);
  document.getElementById("settings-overlay").addEventListener("click", (event) => {
    if (event.target.id === "settings-overlay") closeSettings();
  });
  document.getElementById("settings-body").addEventListener("change", onSettingsChange);
  document.getElementById("settings-body").addEventListener("click", onSettingsClick);
  document.querySelector(".stage").addEventListener("click", (event) => {
    if (settingsOpen) return;
    if (event.target.closest(".settings-toggle, .settings-overlay")) return;
    spin();
  });
}

let lastLayoutKey = "";

function layoutKey() {
  return `${reelAxis()}:${itemSize()}`;
}

function relayoutReels() {
  if (spinning) return;
  const key = layoutKey();
  if (!itemSize() || key === lastLayoutKey) return;
  lastLayoutKey = key;
  Object.keys(reels).forEach((category) => {
    const reel = reels[category];
    if (!reel) return;
    reel.strip.style.transition = "none";
    reel.strip.style.transform = stripTransform(reel.currentIndex);
  });
}

init();
window.addEventListener("resize", relayoutReels);
window.addEventListener("orientationchange", relayoutReels);

window.addEventListener("keydown", (event) => {
  if (event.code === "Escape" && settingsOpen) {
    event.preventDefault();
    closeSettings();
    return;
  }

  if (event.code !== "Space" && event.key !== " ") return;
  if (event.repeat) return;
  if (settingsOpen) {
    if (event.target.closest("input, button")) return;
    event.preventDefault();
    return;
  }
  event.preventDefault();
  spin();
});
