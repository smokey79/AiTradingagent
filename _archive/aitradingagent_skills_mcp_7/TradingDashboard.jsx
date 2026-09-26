import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ScatterChart, Scatter, ZAxis } from "recharts";

// ─── Chain + token data ────────────────────────────────────────────────────────

const CHAINS = {
  ethereum:  { name: "Ethereum",      gas: 2.50,  color: "#888780", native: "ETH",  dex: "uniswap v3",    id: 1,     tier: "high" },
  polygon:   { name: "Polygon",       gas: 0.01,  color: "#7F77DD", native: "MATIC",dex: "quickswap",     id: 137,   tier: "low" },
  cronos:    { name: "Cronos",        gas: 0.002, color: "#378ADD", native: "CRO",  dex: "vvs finance",   id: 25,    tier: "ultra" },
  arbitrum:  { name: "Arbitrum one",  gas: 0.03,  color: "#185FA5", native: "ETH",  dex: "uniswap v3",    id: 42161, tier: "low" },
  base:      { name: "Base",          gas: 0.001, color: "#1D9E75", native: "ETH",  dex: "baseswap",      id: 8453,  tier: "ultra" },
  bsc:       { name: "BNB chain",     gas: 0.10,  color: "#BA7517", native: "BNB",  dex: "pancakeswap v3",id: 56,    tier: "medium" },
  avalanche: { name: "Avalanche",     gas: 0.05,  color: "#D85A30", native: "AVAX", dex: "trader joe",    id: 43114, tier: "low" },
};

const DEMO_PRICES = {
  ETH: {
    ethereum:  { price: 3521.00, liq: 5_000_000, vol: 20_000_000, dex: "uniswap v3",   ch1h:  0.12, ch24h: -1.3,  buys: 12400, sells: 10200 },
    arbitrum:  { price: 3519.50, liq: 2_000_000, vol:  8_000_000, dex: "uniswap v3",   ch1h:  0.10, ch24h: -1.2,  buys:  5200, sells:  4800 },
    polygon:   { price: 3515.00, liq: 1_500_000, vol:  5_000_000, dex: "quickswap",    ch1h:  0.08, ch24h: -1.4,  buys:  3100, sells:  2900 },
    base:      { price: 3522.00, liq:   800_000, vol:  2_000_000, dex: "baseswap",     ch1h:  0.15, ch24h: -1.1,  buys:  1800, sells:  1600 },
    cronos:    { price: 3490.00, liq:   200_000, vol:    500_000, dex: "vvs finance",  ch1h: -0.20, ch24h: -2.1,  buys:   420, sells:   380 },
    bsc:       { price: 3518.00, liq: 1_000_000, vol:  3_000_000, dex: "pancakeswap",  ch1h:  0.09, ch24h: -1.3,  buys:  2800, sells:  2600 },
    avalanche: { price: 3512.00, liq:   600_000, vol:  1_500_000, dex: "trader joe",   ch1h:  0.07, ch24h: -1.5,  buys:  1100, sells:   980 },
  },
  WBTC: {
    ethereum:  { price: 67850.00, liq: 8_000_000, vol: 30_000_000, dex: "uniswap v3",  ch1h: 0.05, ch24h: 0.8, buys: 3200, sells: 2800 },
    arbitrum:  { price: 67820.00, liq: 3_000_000, vol: 12_000_000, dex: "uniswap v3",  ch1h: 0.04, ch24h: 0.7, buys: 1800, sells: 1600 },
    polygon:   { price: 67760.00, liq: 1_200_000, vol:  4_000_000, dex: "quickswap",   ch1h: 0.02, ch24h: 0.6, buys:  900, sells:  800 },
    base:      { price: 67870.00, liq:   500_000, vol:  1_500_000, dex: "baseswap",    ch1h: 0.06, ch24h: 0.9, buys:  600, sells:  520 },
  },
  LINK: {
    ethereum:  { price: 14.92, liq: 2_000_000, vol: 8_000_000, dex: "uniswap v3",  ch1h: 0.30, ch24h: 2.1, buys: 4200, sells: 3800 },
    arbitrum:  { price: 14.88, liq:   900_000, vol: 3_500_000, dex: "uniswap v3",  ch1h: 0.25, ch24h: 1.9, buys: 2100, sells: 1900 },
    cronos:    { price: 14.62, liq:    80_000, vol:   200_000, dex: "vvs finance", ch1h:-0.10, ch24h: 1.2, buys:  220, sells:  190 },
    bsc:       { price: 14.85, liq:   600_000, vol: 2_000_000, dex: "pancakeswap", ch1h: 0.20, ch24h: 1.8, buys: 1800, sells: 1600 },
  },
  AAVE: {
    ethereum:  { price: 182.40, liq: 1_500_000, vol: 5_000_000, dex: "uniswap v3",  ch1h: 0.18, ch24h: 3.2, buys: 2100, sells: 1800 },
    polygon:   { price: 181.90, liq:   700_000, vol: 2_000_000, dex: "quickswap",   ch1h: 0.15, ch24h: 3.0, buys:  900, sells:  800 },
    arbitrum:  { price: 182.10, liq:   900_000, vol: 3_000_000, dex: "uniswap v3",  ch1h: 0.16, ch24h: 3.1, buys: 1400, sells: 1200 },
  },
};

// ─── Opportunity detection ─────────────────────────────────────────────────────

function detectOpportunities(prices) {
  const opps = [];
  const now = new Date().toISOString();
  for (const [token, chainPrices] of Object.entries(prices)) {
    const ckeys = Object.keys(chainPrices);
    for (const buy of ckeys) {
      for (const sell of ckeys) {
        if (buy === sell) continue;
        const bp = chainPrices[buy].price ?? chainPrices[buy].price_usd ?? 0;
        const sp = chainPrices[sell].price ?? chainPrices[sell].price_usd ?? 0;
        if (!bp || !sp || bp <= 0 || sp <= 0) continue;
        const gross = (sp - bp) / bp * 100;
        if (gross <= 0) continue;
        const buyGas  = CHAINS[buy]?.gas  ?? 1;
        const sellGas = CHAINS[sell]?.gas ?? 1;
        const gasPct  = ((buyGas + sellGas) / 1000) * 100;
        const net     = gross - gasPct;
        if (net < 0.3) continue;
        const buyLiq  = chainPrices[buy].liq  ?? chainPrices[buy].liquidity  ?? 0;
        const sellLiq = chainPrices[sell].liq ?? chainPrices[sell].liquidity ?? 0;
        opps.push({
          token, buyChain: buy, sellChain: sell,
          buyPrice: bp, sellPrice: sp,
          buyDex:   chainPrices[buy].dex  ?? chainPrices[buy].dex  ?? "",
          sellDex:  chainPrices[sell].dex ?? chainPrices[sell].dex ?? "",
          buyLiq, sellLiq,
          grossPct: parseFloat(gross.toFixed(4)),
          gasPct:   parseFloat(gasPct.toFixed(4)),
          netPct:   parseFloat(net.toFixed(4)),
          netUsd:   parseFloat((net / 100 * 1000).toFixed(2)),
          ts: now,
        });
      }
    }
  }
  opps.sort((a, b) => b.netPct - a.netPct);
  return opps;
}

// ─── Shared components ─────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, accent }) {
  return (
    <div style={{
      background: "var(--color-background-secondary)",
      borderRadius: "var(--border-radius-md)",
      padding: "0.75rem 1rem",
    }}>
      <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 500, color: accent || "var(--color-text-primary)" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function ChainDot({ chain, size = 8 }) {
  const c = CHAINS[chain];
  return <span style={{ width: size, height: size, borderRadius: "50%", background: c?.color ?? "#888", display: "inline-block", flexShrink: 0 }} />;
}

function ChainPill({ chain }) {
  const c = CHAINS[chain];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      fontSize: 12, fontFamily: "var(--font-mono)",
      background: "var(--color-background-secondary)",
      border: "0.5px solid var(--color-border-secondary)",
      borderRadius: "var(--border-radius-md)",
      padding: "2px 8px",
    }}>
      <ChainDot chain={chain} />
      {c?.name ?? chain}
    </span>
  );
}

function NetBadge({ pct }) {
  const col = pct >= 1.5 ? "success" : pct >= 0.7 ? "warning" : "secondary";
  return (
    <span style={{
      fontSize: 13, fontWeight: 500, fontFamily: "var(--font-mono)",
      color: `var(--color-text-${col})`,
      background: `var(--color-background-${col})`,
      borderRadius: "var(--border-radius-md)",
      padding: "2px 8px",
    }}>
      +{pct.toFixed(2)}%
    </span>
  );
}

function TabBar({ tabs, active, onChange }) {
  return (
    <div style={{ display: "flex", borderBottom: "0.5px solid var(--color-border-tertiary)", marginBottom: "1.25rem" }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)} style={{
          padding: "0.5rem 1rem", fontSize: 13, border: "none",
          borderBottom: active === t.id ? "2px solid var(--color-text-primary)" : "2px solid transparent",
          background: "transparent",
          color: active === t.id ? "var(--color-text-primary)" : "var(--color-text-secondary)",
          cursor: "pointer", fontWeight: active === t.id ? 500 : 400,
        }}>{t.label}</button>
      ))}
    </div>
  );
}

function Card({ children, style }) {
  return (
    <div style={{
      background: "var(--color-background-primary)",
      border: "0.5px solid var(--color-border-tertiary)",
      borderRadius: "var(--border-radius-lg)",
      padding: "1rem 1.25rem",
      ...style,
    }}>{children}</div>
  );
}

// ─── Tab: Chain registry ───────────────────────────────────────────────────────

function ChainsTab() {
  const list = Object.entries(CHAINS);
  const gasData = list.map(([, c]) => ({ name: c.name.split(" ")[0], gas: c.gas })).sort((a,b) => b.gas - a.gas);
  const tierColor = { ultra: "#1D9E75", low: "#185FA5", medium: "#BA7517", high: "#D85A30" };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10, marginBottom: "1.25rem" }}>
        {list.map(([key, c]) => (
          <Card key={key} style={{ padding: "0.875rem 1rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <ChainDot chain={key} size={10} />
              <span style={{ fontWeight: 500, fontSize: 14 }}>{c.name}</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", fontFamily: "var(--font-mono)", marginBottom: 2 }}>chain id: {c.id}</div>
            <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 6 }}>{c.dex} · {c.native}</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>avg gas</span>
              <span style={{ fontSize: 14, fontWeight: 500, fontFamily: "var(--font-mono)", color: tierColor[c.tier] }}>
                ${c.gas.toFixed(3)}
              </span>
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: "0.75rem" }}>Gas cost per swap — all chains</div>
        <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          {Object.entries(tierColor).map(([tier, col]) => (
            <span key={tier} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--color-text-secondary)" }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: col }} />
              {tier}
            </span>
          ))}
        </div>
        <div style={{ height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={gasData} margin={{ top: 4, right: 0, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.12)" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={v => [`$${v.toFixed(3)}`, "avg gas"]} contentStyle={{ fontSize: 12 }} />
              <Bar dataKey="gas" radius={[3,3,0,0]}
                fill="#185FA5"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

// ─── Tab: Arb scanner ──────────────────────────────────────────────────────────

function ScannerTab({ opportunities, prices }) {
  const [tokenFilter, setTokenFilter] = useState("all");
  const [minNet, setMinNet] = useState(0);
  const [sortBy, setSortBy] = useState("net");
  const [expanded, setExpanded] = useState(null);

  const tokens = [...new Set(opportunities.map(o => o.token))];

  let filtered = opportunities.filter(o => {
    if (tokenFilter !== "all" && o.token !== tokenFilter) return false;
    if ((o.netPct ?? 0) < minNet) return false;
    return true;
  });

  if (sortBy === "liq") filtered = [...filtered].sort((a,b) => Math.min(b.buyLiq,b.sellLiq) - Math.min(a.buyLiq,a.sellLiq));
  if (sortBy === "gross") filtered = [...filtered].sort((a,b) => b.grossPct - a.grossPct);

  const topChainPairs = {};
  filtered.slice(0,20).forEach(o => {
    const k = `${o.buyChain}-${o.sellChain}`;
    topChainPairs[k] = (topChainPairs[k] || 0) + 1;
  });

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Token:</span>
        {["all", ...tokens].map(t => (
          <button key={t} onClick={() => setTokenFilter(t)} style={{
            fontSize: 12, padding: "3px 10px", cursor: "pointer",
            borderRadius: "var(--border-radius-md)",
            border: tokenFilter === t ? "1.5px solid var(--color-border-info)" : "0.5px solid var(--color-border-secondary)",
            background: tokenFilter === t ? "var(--color-background-info)" : "transparent",
            color: tokenFilter === t ? "var(--color-text-info)" : "var(--color-text-secondary)",
          }}>{t}</button>
        ))}
        <span style={{ marginLeft: 4, fontSize: 12, color: "var(--color-text-secondary)" }}>Min net:</span>
        <input type="range" min={0} max={3} step={0.25} value={minNet} onChange={e => setMinNet(+e.target.value)} style={{ width: 80 }} />
        <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--color-text-secondary)", minWidth: 32 }}>{minNet.toFixed(2)}%</span>
        <span style={{ marginLeft: 4, fontSize: 12, color: "var(--color-text-secondary)" }}>Sort:</span>
        {[["net","by net %"],["gross","by gross %"],["liq","by liquidity"]].map(([id,label]) => (
          <button key={id} onClick={() => setSortBy(id)} style={{
            fontSize: 12, padding: "3px 10px", cursor: "pointer",
            borderRadius: "var(--border-radius-md)",
            border: sortBy === id ? "1.5px solid var(--color-border-info)" : "0.5px solid var(--color-border-secondary)",
            background: sortBy === id ? "var(--color-background-info)" : "transparent",
            color: sortBy === id ? "var(--color-text-info)" : "var(--color-text-secondary)",
          }}>{label}</button>
        ))}
      </div>

      <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginBottom: 8 }}>
        {filtered.length} opportunities · click a row for detail
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {filtered.length === 0 && (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 13 }}>
            No opportunities match current filters
          </div>
        )}
        {filtered.map((opp, i) => (
          <div key={i}>
            <div
              onClick={() => setExpanded(expanded === i ? null : i)}
              style={{
                background: "var(--color-background-primary)",
                border: `0.5px solid ${expanded === i ? "var(--color-border-primary)" : "var(--color-border-tertiary)"}`,
                borderRadius: expanded === i ? "var(--border-radius-lg) var(--border-radius-lg) 0 0" : "var(--border-radius-lg)",
                padding: "0.75rem 1rem",
                display: "grid",
                gridTemplateColumns: "48px 1fr 120px 80px",
                gap: "0 12px",
                alignItems: "center",
                cursor: "pointer",
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 500, fontFamily: "var(--font-mono)", background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "2px 6px", textAlign: "center" }}>
                {opp.token}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <ChainPill chain={opp.buyChain} />
                <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--color-text-secondary)" }}>
                  ${(opp.buyPrice).toLocaleString("en-US",{maximumFractionDigits:2})}
                </span>
                <span style={{ color: "var(--color-text-tertiary)", fontSize: 13 }}>→</span>
                <ChainPill chain={opp.sellChain} />
                <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--color-text-secondary)" }}>
                  ${(opp.sellPrice).toLocaleString("en-US",{maximumFractionDigits:2})}
                </span>
              </div>
              <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", fontFamily: "var(--font-mono)", textAlign: "right" }}>
                liq ${(Math.min(opp.buyLiq,opp.sellLiq)/1000).toFixed(0)}k<br/>
                gas -{opp.gasPct.toFixed(3)}%
              </div>
              <div style={{ textAlign: "right" }}>
                <NetBadge pct={opp.netPct} />
                <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2, fontFamily: "var(--font-mono)" }}>
                  ${opp.netUsd.toFixed(2)}/1k
                </div>
              </div>
            </div>

            {expanded === i && (
              <div style={{
                background: "var(--color-background-secondary)",
                border: "0.5px solid var(--color-border-primary)",
                borderTop: "none",
                borderRadius: "0 0 var(--border-radius-lg) var(--border-radius-lg)",
                padding: "0.875rem 1rem",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: 8,
              }}>
                {[
                  ["Token",       opp.token],
                  ["Buy chain",   opp.buyChain],
                  ["Sell chain",  opp.sellChain],
                  ["Buy DEX",     opp.buyDex],
                  ["Sell DEX",    opp.sellDex],
                  ["Buy price",   `$${opp.buyPrice.toLocaleString("en-US",{maximumFractionDigits:2})}`],
                  ["Sell price",  `$${opp.sellPrice.toLocaleString("en-US",{maximumFractionDigits:2})}`],
                  ["Gross spread",`+${opp.grossPct.toFixed(4)}%`],
                  ["Gas cost",    `-${opp.gasPct.toFixed(4)}%`],
                  ["Net profit",  `+${opp.netPct.toFixed(4)}%`],
                  ["Net on $1k",  `$${opp.netUsd.toFixed(2)}`],
                  ["Min liq",     `$${(Math.min(opp.buyLiq,opp.sellLiq)/1000).toFixed(0)}k`],
                ].map(([label, val]) => (
                  <div key={label}>
                    <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
                    <div style={{ fontSize: 13, fontFamily: "var(--font-mono)", color: "var(--color-text-primary)", marginTop: 1 }}>{val}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Tab: AI analysis ─────────────────────────────────────────────────────────

function AnalysisTab({ opportunities, prices }) {
  const [analysis, setAnalysis] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [model, setModel] = useState("claude-sonnet-4-20250514");

  const top5 = opportunities.slice(0, 5);

  const priceSummary = Object.entries(prices).map(([tok, chains]) => {
    const cs = Object.entries(chains)
      .map(([c, d]) => `${c}=$${(d.price ?? d.price_usd ?? 0).toLocaleString("en-US",{maximumFractionDigits:2})}`)
      .join(", ");
    return `${tok}: ${cs}`;
  }).join("\n");

  const oppStr = top5.map((o, i) => {
    const bp = o.buyPrice ?? o.buy_price ?? 0;
    const sp = o.sellPrice ?? o.sell_price ?? 0;
    const net = o.netPct ?? o.net_pct ?? 0;
    const nusd = o.netUsd ?? o.net_usd_1k ?? 0;
    return `${i+1}. ${o.token} BUY ${o.buyChain??o.buy_chain} @$${bp.toLocaleString()} → SELL ${o.sellChain??o.sell_chain} @$${sp.toLocaleString()} | net=${net.toFixed(2)}% ($${nusd.toFixed(2)}/1k)`;
  }).join("\n");

  const fullPrompt = `You are an expert crypto arbitrage analyst for a multi-chain automated trading bot (paper trade mode — no real money at risk).

MARKET DATA (${new Date().toUTCString()}):
${priceSummary}

TOP OPPORTUNITIES:
${oppStr}

Provide:
1. RECOMMENDATION for each (EXECUTE / WATCH / SKIP) — 1 sentence reason
2. RISK FACTORS: liquidity depth, slippage, gas spike exposure
3. PRIORITY ORDER for limited capital
4. ONE KEY INSIGHT — something non-obvious

Be concise and actionable. Avoid generic disclaimers.`;

  const runAnalysis = async () => {
    if (!top5.length) { setError("No opportunities loaded — use demo data or import an export file."); return; }
    setLoading(true); setAnalysis(""); setError("");
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          max_tokens: 1000,
          messages: [{ role: "user", content: fullPrompt }],
        }),
      });
      const data = await resp.json();
      if (data.content) {
        setAnalysis(data.content.filter(b => b.type === "text").map(b => b.text).join(""));
      } else {
        setError(data.error?.message ?? "Unexpected API response — check console");
      }
    } catch (e) {
      setError(`Request failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: "1rem" }}>
        <MetricCard label="Opportunities queued" value={top5.length} sub="top 5 sent to LLM" />
        <MetricCard label="Model" value={model.replace("claude-","").split("-20")[0]} sub="Anthropic API" />
      </div>

      <Card style={{ marginBottom: "1rem" }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Prompt preview</div>
        <pre style={{ fontFamily: "var(--font-mono)", fontSize: 11, whiteSpace: "pre-wrap", margin: 0, maxHeight: 140, overflow: "auto", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
          {fullPrompt}
        </pre>
      </Card>

      <div style={{ display: "flex", gap: 8, marginBottom: "1rem", alignItems: "center" }}>
        <button onClick={runAnalysis} disabled={loading} style={{ padding: "8px 20px", cursor: loading ? "default" : "pointer", opacity: loading ? 0.6 : 1 }}>
          {loading ? "Analysing..." : `Analyse ${top5.length} opportunities ↗`}
        </button>
        <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>calls Anthropic API · paper trade only</span>
      </div>

      {error && (
        <div style={{ color: "var(--color-text-danger)", fontSize: 13, marginBottom: "1rem", padding: "0.75rem", background: "var(--color-background-danger)", borderRadius: "var(--border-radius-md)" }}>
          {error}
        </div>
      )}

      {analysis && (
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "0.75rem" }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#1D9E75" }} />
            <span style={{ fontSize: 14, fontWeight: 500 }}>Analysis complete</span>
            <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginLeft: "auto" }}>{model}</span>
          </div>
          <pre style={{ fontFamily: "var(--font-sans)", fontSize: 13, whiteSpace: "pre-wrap", margin: 0, lineHeight: 1.8, color: "var(--color-text-primary)" }}>
            {analysis}
          </pre>
        </Card>
      )}
    </div>
  );
}

// ─── Tab: Export guide ────────────────────────────────────────────────────────

function GuideTab() {
  const [copied, setCopied] = useState(null);
  const copy = (text, key) => { navigator.clipboard?.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1500); };

  const cmds = [
    { key: "demo",  label: "Demo mode (no network)", cmd: "python data_export.py --demo" },
    { key: "live",  label: "Live data (DexScreener)", cmd: "python data_export.py" },
    { key: "llm",   label: "Live + LLM analysis",    cmd: "python data_export.py --demo  (set APP_ANTHROPIC_API_KEY in .env first)" },
    { key: "tests", label: "Run tests",               cmd: "python -m pytest test_multichain.py -v" },
  ];

  const files = [
    { f: "prices_raw_*.json",     d: "Nested prices  token → chain" },
    { f: "prices_flat_*.csv",     d: "One row per token/chain — Excel ready" },
    { f: "opportunities_*.csv",   d: "Arb opportunity table" },
    { f: "opportunities_*.jsonl", d: "JSONL for LLM fine-tuning" },
    { f: "llm_analysis_*.json",   d: "LLM trade recommendations" },
    { f: "ai_context_*.json",     d: "Ready-to-paste AI prompt context" },
    { f: "master_bundle_*.json",  d: "Everything — paste into this dashboard" },
  ];

  const envVars = [
    "APP_ANTHROPIC_API_KEY=sk-ant-...",
    "APP_OPENAI_API_KEY=sk-...",
    "APP_GROK_API_KEY=...",
    "APP_ACTIVE_LLM=anthropic",
    "INFURA_URL=https://mainnet.infura.io/v3/YOUR_KEY",
    "CRONOS_RPC=https://evm.cronos.org",
    "ARBITRUM_RPC=https://arb1.arbitrum.io/rpc",
    "BASE_RPC=https://mainnet.base.org",
  ];

  const steps = [
    { n:1, t:"Save file",          d:`Download data_export.py → place in project root (same level as config/, src/, core/)` },
    { n:2, t:"Open VS Code terminal", d:"Press Ctrl + ` (backtick — top-left of keyboard). Terminal opens at the bottom." },
    { n:3, t:"Install dependencies", d:"pip install requests python-dotenv", mono:true },
    { n:4, t:"Create .env file",   d:"Create a file called .env in your project root. Add your API keys (see box below)." },
    { n:5, t:"Run demo first",     d:"python data_export.py --demo", mono:true },
    { n:6, t:"Import here",        d:"Open exports/master_bundle_*.json → copy all → paste into the import box at the top of this dashboard." },
  ];

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: "1.5rem" }}>
        {steps.map(s => (
          <div key={s.n} style={{ display:"flex", gap:12, background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", borderRadius:"var(--border-radius-lg)", padding:"0.75rem 1rem", alignItems:"flex-start" }}>
            <span style={{ width:22, height:22, borderRadius:"50%", background:"var(--color-background-info)", color:"var(--color-text-info)", fontSize:11, fontWeight:500, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>{s.n}</span>
            <div>
              <div style={{ fontSize:13, fontWeight:500, marginBottom:2 }}>{s.t}</div>
              {s.mono
                ? <code style={{ fontSize:12, fontFamily:"var(--font-mono)", background:"var(--color-background-secondary)", padding:"2px 8px", borderRadius:4 }}>{s.d}</code>
                : <div style={{ fontSize:12, color:"var(--color-text-secondary)" }}>{s.d}</div>
              }
            </div>
          </div>
        ))}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:"1.25rem" }}>
        <Card>
          <div style={{ fontSize:13, fontWeight:500, marginBottom:8 }}>Quick-run commands</div>
          {cmds.map(c => (
            <div key={c.key} style={{ marginBottom:8 }}>
              <div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginBottom:2 }}>{c.label}</div>
              <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                <code style={{ fontSize:12, fontFamily:"var(--font-mono)", background:"var(--color-background-secondary)", padding:"3px 8px", borderRadius:4, flex:1, color:"var(--color-text-primary)" }}>{c.cmd}</code>
                <button onClick={() => copy(c.cmd.split("  ")[0], c.key)} style={{ fontSize:11, padding:"3px 8px", flexShrink:0 }}>
                  {copied===c.key ? "done" : "copy"}
                </button>
              </div>
            </div>
          ))}
        </Card>

        <Card>
          <div style={{ fontSize:13, fontWeight:500, marginBottom:8 }}>.env file template</div>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
            <span style={{ fontSize:11, color:"var(--color-text-tertiary)" }}>Create .env in project root</span>
            <button onClick={() => copy(envVars.join("\n"), "env")} style={{ fontSize:11, padding:"2px 8px" }}>
              {copied==="env" ? "done" : "copy all"}
            </button>
          </div>
          <pre style={{ fontFamily:"var(--font-mono)", fontSize:11, whiteSpace:"pre-wrap", margin:0, background:"var(--color-background-secondary)", padding:"0.75rem", borderRadius:"var(--border-radius-md)", color:"var(--color-text-secondary)", lineHeight:1.7 }}>
            {envVars.join("\n")}
          </pre>
        </Card>
      </div>

      <Card>
        <div style={{ fontSize:13, fontWeight:500, marginBottom:8 }}>Output files (written to exports/)</div>
        <div style={{ border:"0.5px solid var(--color-border-tertiary)", borderRadius:"var(--border-radius-md)", overflow:"hidden" }}>
          {files.map((f,i) => (
            <div key={i} style={{ display:"flex", gap:12, padding:"0.4rem 0.75rem", borderBottom:i<files.length-1?"0.5px solid var(--color-border-tertiary)":"none" }}>
              <code style={{ fontSize:11, fontFamily:"var(--font-mono)", color:"var(--color-text-info)", flex:"0 0 220px", alignSelf:"center" }}>{f.f}</code>
              <span style={{ fontSize:12, color:"var(--color-text-secondary)" }}>{f.d}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─── Import panel ─────────────────────────────────────────────────────────────

function ImportPanel({ onImport, onClear, hasImported }) {
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const tryImport = () => {
    try { onImport(JSON.parse(text)); setErr(""); }
    catch { setErr("Invalid JSON — paste the full master_bundle_*.json content"); }
  };
  return (
    <Card style={{ marginBottom:"1rem" }}>
      <div style={{ fontSize:13, fontWeight:500, marginBottom:6 }}>Import export file</div>
      <div style={{ fontSize:12, color:"var(--color-text-secondary)", marginBottom:8 }}>
        Run <code style={{ fontFamily:"var(--font-mono)", background:"var(--color-background-secondary)", padding:"1px 5px", borderRadius:3 }}>python data_export.py --demo</code>, open <code style={{ fontFamily:"var(--font-mono)", background:"var(--color-background-secondary)", padding:"1px 5px", borderRadius:3 }}>exports/master_bundle_*.json</code>, copy all, paste below.
      </div>
      <textarea value={text} onChange={e => setText(e.target.value)}
        placeholder='{"meta":{"timestamp":"..."},"prices":{...},"opportunities":[...]}'
        style={{ width:"100%", height:80, fontSize:12, fontFamily:"var(--font-mono)", boxSizing:"border-box", resize:"vertical" }} />
      {err && <div style={{ fontSize:12, color:"var(--color-text-danger)", marginTop:4 }}>{err}</div>}
      <div style={{ display:"flex", gap:8, marginTop:8 }}>
        <button onClick={tryImport} style={{ fontSize:12, padding:"5px 14px" }}>Load data ↗</button>
        {hasImported && <button onClick={onClear} style={{ fontSize:12, padding:"5px 14px" }}>Clear (demo mode)</button>}
      </div>
    </Card>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [activeTab, setActiveTab] = useState("chains");
  const [imported, setImported] = useState(null);
  const [showImport, setShowImport] = useState(false);

  const handleImport = data => { setImported(data); setShowImport(false); setActiveTab("scanner"); };
  const handleClear  = () => { setImported(null); };

  const prices  = imported?.prices  || DEMO_PRICES;
  const rawOpps = imported?.opportunities || null;
  const opportunities = rawOpps ?? detectOpportunities(prices);
  const actionable = opportunities.filter(o => (o.netPct ?? o.net_pct ?? 0) >= 1);

  const tabs = [
    { id:"chains",   label:"Chain registry" },
    { id:"scanner",  label:`Scanner (${opportunities.length})` },
    { id:"analysis", label:"AI analysis" },
    { id:"guide",    label:"How to export" },
  ];

  return (
    <div style={{ padding:"1rem 0", fontFamily:"var(--font-sans)" }}>
      <h2 className="sr-only">Multi-chain trading bot dashboard — arbitrage scanner and AI analysis</h2>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:"1rem", flexWrap:"wrap", gap:8 }}>
        <div>
          <h2 style={{ margin:0, fontSize:20, fontWeight:500 }}>Multi-chain trading bot</h2>
          <p style={{ margin:"2px 0 0", fontSize:13, color:"var(--color-text-secondary)" }}>
            {imported
              ? `Live export loaded · ${new Date(imported.meta?.timestamp ?? Date.now()).toLocaleString()}`
              : "Demo mode · run data_export.py for live prices"
            }
          </p>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <span style={{ fontSize:11, padding:"3px 10px", borderRadius:"var(--border-radius-md)", background:"var(--color-background-success)", color:"var(--color-text-success)" }}>
            paper trade
          </span>
          <button onClick={() => setShowImport(!showImport)} style={{ fontSize:12, padding:"5px 12px" }}>
            {showImport ? "Cancel" : "Import export ↗"}
          </button>
        </div>
      </div>

      {/* Metrics */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:"1.25rem" }}>
        <MetricCard label="Chains monitored" value={Object.keys(CHAINS).length} />
        <MetricCard label="Tokens" value={Object.keys(prices).length} />
        <MetricCard label="Opportunities" value={opportunities.length} sub="detected" />
        <MetricCard label="Actionable" value={actionable.length} sub="≥1% net profit" accent={actionable.length > 0 ? "var(--color-text-success)" : undefined} />
      </div>

      {/* Import panel */}
      {showImport && <ImportPanel onImport={handleImport} onClear={handleClear} hasImported={!!imported} />}

      <TabBar tabs={tabs} active={activeTab} onChange={setActiveTab} />

      {activeTab === "chains"   && <ChainsTab />}
      {activeTab === "scanner"  && <ScannerTab opportunities={opportunities} prices={prices} />}
      {activeTab === "analysis" && <AnalysisTab opportunities={opportunities} prices={prices} />}
      {activeTab === "guide"    && <GuideTab />}
    </div>
  );
}
