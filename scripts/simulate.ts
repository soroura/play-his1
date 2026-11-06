// Spawn fake players against a running server.
//   bun scripts/simulate.ts [url] [--players 30] [--code 1234] [--auto --pin 1234] [--origin https://...] [--fast] [--rounds 1,3,5]
// Without --auto the host is driven manually in the browser; pass --code <room code>.
// With --auto the script logs in as host (PIN from --pin or HOST_PIN), creates the game and drives every step.
export {};
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string, d?: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const url = (args[0]?.startsWith("http") ? args[0] : "http://127.0.0.1:8098").replace(/\/+$/, "");
const N = Number(opt("players", "30"));
const auto = flag("auto");
const fast = flag("fast");
const roundIds = opt("rounds") ? opt("rounds")!.split(",").map((x) => Number(x.trim())) : undefined; // default: server's core rounds
const pin = opt("pin", process.env.HOST_PIN ?? "1234")!;
const reqOrigin = opt("origin", new URL(url).origin)!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(path: string, body?: unknown, cookie = "", ip = ""): Promise<{ status: number; data: any; cookie: string }> {
  const res = await fetch(url + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", Origin: reqOrigin, ...(ip ? { "CF-Connecting-IP": ip } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const sc = res.headers.get("set-cookie");
  let data: any = {};
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }
  return { status: res.status, data, cookie: sc ? sc.split(";")[0]! : cookie };
}

let hostCookie = "";
async function hostLogin() {
  const r = await call("/api/host/login", { pin });
  if (r.status !== 200) throw new Error("host login failed: " + JSON.stringify(r.data));
  hostCookie = r.cookie;
}
const hostGet = () => call("/api/host/state", undefined, hostCookie);
const hostDo = (what: string, from?: string) => call("/api/host/" + what, { from }, hostCookie);

let finished = false;
let expectedRounds = 0; // set when --auto creates the game
const stats = { answers: 0, errors: 0, joined: 0 };

async function player(i: number, code: string) {
  const ip = `10.1.${Math.floor(i / 200)}.${i % 200}`;
  const r = await call("/api/join", { code, nickname: `Sim${i}`, lang: i % 3 === 0 ? "ar" : "en" }, "", ip);
  if (r.status !== 200) {
    stats.errors++;
    console.error(`player ${i} join failed`, r.data);
    return undefined;
  }
  stats.joined++;
  const token: string = r.data.token;
  const answered = new Set<number>();
  while (!finished) {
    const s = await call(`/api/state?token=${token}`, undefined, "", ip);
    if (s.status !== 200) {
      stats.errors++;
      await sleep(1000);
      continue;
    }
    const st = s.data;
    if (st.game?.phase === "final") return token;
    if (st.game?.phase === "question" && !st.answer && !answered.has(st.game.round)) {
      answered.add(st.game.round);
      const keys: string[] = st.round.options.map((o: any) => o.key);
      const delay = fast ? Math.random() * 1500 : 500 + Math.random() * 12000;
      setTimeout(async () => {
        const a = await call("/api/answer", { token, key: keys[Math.floor(Math.random() * keys.length)] }, "", ip);
        if (a.status === 200) stats.answers++;
        else if (a.status !== 409) stats.errors++;
      }, delay);
    }
    await sleep(1500);
  }
  return token;
}

async function main() {
  let code = opt("code");
  if (auto) {
    await hostLogin();
    const g = await call("/api/host/game", roundIds ? { roundIds } : {}, hostCookie);
    if (g.status !== 200) throw new Error("create game failed: " + JSON.stringify(g.data));
    code = g.data.game.code;
    expectedRounds = g.data.game.rounds;
    console.log(`created game, room code ${code}, rounds ${JSON.stringify(g.data.game.roundIds)}`);
  }
  if (!code) throw new Error("need --code <room code> (or --auto --pin <pin>)");
  console.log(`joining ${N} players to ${url} room ${code}`);
  const runs: Promise<string | undefined>[] = [];
  for (let i = 1; i <= N; i++) {
    runs.push(player(i, code));
    await sleep(40);
  }
  if (auto) {
    await sleep(1500);
    let s = (await hostGet()).data;
    console.log(`lobby: ${s.players.total} players`);
    let guard = 0;
    while (s.game.phase !== "final" && guard++ < 3000) {
      const ph: string = s.game.phase;
      if (ph === "question") {
        await sleep(500);
        s = (await hostGet()).data;
        continue;
      }
      await sleep(fast ? 300 : ph === "scene" ? 3000 : 1500);
      if (ph === "reveal") console.log(`round ${s.game.round + 1} revealed: answered ${s.answered}/${s.answerTotal}`);
      s = (await hostDo("advance", `${ph}:${s.game.round}`)).data;
    }
    console.log("final reached; podium:", JSON.stringify(s.podium));
  }
  const tokens = (await Promise.all(runs)).filter(Boolean) as string[];
  finished = true;
  let bad = 0;
  for (const t of tokens.slice(0, 5)) {
    const rep = await call("/api/report/" + t);
    if (rep.status !== 200) bad++;
    else if (expectedRounds && rep.data.rounds.length !== expectedRounds) {
      bad++;
      console.error(`report has ${rep.data.rounds.length} rounds, expected ${expectedRounds}`);
    } else console.log(`report ok: ${rep.data.name} total=${rep.data.total} rank=${rep.data.rank}/${rep.data.of} ko=${rep.data.knockouts} rounds=${rep.data.rounds.length}`);
  }
  console.log(`done: joined=${stats.joined} answers=${stats.answers} errors=${stats.errors} reportFailures=${bad}`);
  process.exit(stats.errors || bad ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
