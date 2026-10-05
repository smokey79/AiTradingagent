// scripts/forkTest.js — Stage 1 flash-loan simulation on a local COPY of Arbitrum (hardhat mainnet fork).
// Nothing is broadcast; fake ETH; no keys. Run: npx hardhat run scripts/forkTest.js
//  1. verify the protocol addresses really have contract code on Arbitrum
//  2. measure round-trip cost/edge on real pools (USDC -> WETH -> USDC, different pools)
//  3. SAFETY A: an unprofitable arb with minProfit > 0 must revert (only gas lost)
//  4. PLUMBING B: force one full borrow -> swap -> swap -> repay to prove it works and measure real cost
//  5. SAFETY C: strangers cannot start a loan or trigger the callback
const hre = require('hardhat');
const { ethers } = hre;
const fs = require('fs');
const path = require('path');

const A = {
  vault:  '0xBA12222222228d8Ba445958a75a0704d566BF2C8', // Balancer V2 Vault (0% flash-loan fee)
  usdc:   '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // native USDC on Arbitrum
  weth:   '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  uniRouter: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', // Uniswap V3 SwapRouter02
  uniQuoter: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e', // Uniswap V3 QuoterV2
  sushiRouter: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', // SushiSwap V2 router
};
const ERC20 = ['function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)', 'function transfer(address,uint256) returns (bool)', 'function decimals() view returns (uint8)'];
const UNI_ROUTER = ['function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)'];
const UNI_QUOTER = ['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160,uint32,uint256)'];
const SUSHI = ['function getAmountsOut(uint256,address[]) view returns (uint256[])', 'function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns (uint256[])'];
const VAULT = ['function flashLoan(address,address[],uint256[],bytes)'];
const iERC = new ethers.Interface(ERC20), iUni = new ethers.Interface(UNI_ROUTER), iSushi = new ethers.Interface(SUSHI);
const results = { at: new Date().toISOString(), network: 'arbitrum-mainnet-fork (local, nothing broadcast)', checks: [] };
const log = (ok, name, detail) => { results.checks.push({ ok, name, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

// Quote one leg. venue: {dex:'uni', fee} | {dex:'sushi'}
async function quote(venue, tokenIn, tokenOut, amountIn) {
  if (venue.dex === 'uni') {
    const q = new ethers.Contract(A.uniQuoter, UNI_QUOTER, ethers.provider);
    const r = await q.quoteExactInputSingle.staticCall({ tokenIn, tokenOut, amountIn, fee: venue.fee, sqrtPriceLimitX96: 0 });
    return r[0];
  }
  const s = new ethers.Contract(A.sushiRouter, SUSHI, ethers.provider);
  const r = await s.getAmountsOut(amountIn, [tokenIn, tokenOut]);
  return r[1];
}
// Build approve + swap calls for one leg, executed BY the FlashArb contract.
function legCalls(venue, tokenIn, tokenOut, amountIn, recipient) {
  const router = venue.dex === 'uni' ? A.uniRouter : A.sushiRouter;
  const approve = { target: tokenIn, data: iERC.encodeFunctionData('approve', [router, amountIn]) };
  const swap = venue.dex === 'uni'
    ? { target: router, data: iUni.encodeFunctionData('exactInputSingle', [{ tokenIn, tokenOut, fee: venue.fee, recipient, amountIn, amountOutMinimum: 0, sqrtPriceLimitX96: 0 }]) }
    : { target: router, data: iSushi.encodeFunctionData('swapExactTokensForTokens', [amountIn, 0, [tokenIn, tokenOut], recipient, Math.floor(Date.now() / 1000) + 600]) };
  return [approve, swap];
}
const name = v => (v.dex === 'uni' ? `UniV3 ${v.fee / 10000}%` : 'Sushi V2');
const usd = x => Number(ethers.formatUnits(x, 6));

async function main() {
  const [owner, stranger] = await ethers.getSigners();
  const block = await ethers.provider.getBlock('latest');
  results.forkBlock = block.number;
  console.log(`Forked Arbitrum at block ${block.number} (${new Date(block.timestamp * 1000).toISOString()})`);

  // 1. addresses really are contracts
  for (const [k, v] of Object.entries(A)) {
    const code = await ethers.provider.getCode(v);
    log(code.length > 2, `contract exists: ${k}`, v);
  }

  const Flash = await ethers.getContractFactory('FlashArb');
  const flash = await Flash.deploy(A.vault);
  await flash.waitForDeployment();
  const fa = await flash.getAddress();
  log(true, 'FlashArb deployed on the fork', fa);

  // 2. round-trip edge on real pools
  const venues = [{ dex: 'uni', fee: 500 }, { dex: 'uni', fee: 3000 }, { dex: 'sushi' }];
  const routes = [];
  for (const size of [1000, 10000]) {
    const amt = ethers.parseUnits(String(size), 6);
    for (const v1 of venues) for (const v2 of venues) {
      if (v1 === v2) continue;
      try {
        const mid = await quote(v1, A.usdc, A.weth, amt);
        const back = await quote(v2, A.weth, A.usdc, mid);
        const pnl = usd(back) - size;
        routes.push({ size, leg1: name(v1), leg2: name(v2), v1, v2, mid, back, pnlUsd: +pnl.toFixed(4), pnlPct: +((pnl / size) * 100).toFixed(4) });
      } catch (e) { routes.push({ size, leg1: name(v1), leg2: name(v2), error: e.shortMessage || e.message }); }
    }
  }
  routes.sort((a, b) => (b.pnlUsd ?? -1e9) - (a.pnlUsd ?? -1e9));
  console.log('\nRound trips USDC -> WETH -> USDC (after DEX fees + price impact, before gas):');
  for (const r of routes) console.log(`  $${r.size}  ${r.leg1} -> ${r.leg2}: ${r.error ? 'ERR ' + r.error : `${r.pnlUsd >= 0 ? '+' : ''}$${r.pnlUsd} (${r.pnlPct}%)`}`);
  results.routes = routes.map(({ v1, v2, mid, back, ...rest }) => rest);
  const best = routes.find(r => !r.error);
  const profitable = routes.filter(r => !r.error && r.pnlUsd > 0).length;
  log(true, 'edge scan finished', `${profitable} of ${routes.filter(r => !r.error).length} routes profitable before gas; best ${best.leg1} -> ${best.leg2} $${best.pnlUsd}`);

  // Build the calls for the best route at its size
  const amt = ethers.parseUnits(String(best.size), 6);
  const leg2In = (best.mid * 9999n) / 10000n;      // tiny buffer; same block so output is ~exact
  const calls = [...legCalls(best.v1, A.usdc, A.weth, amt, fa), ...legCalls(best.v2, A.weth, A.usdc, leg2In, fa)];
  const targets = calls.map(c => c.target), datas = calls.map(c => c.data);

  // 3. SAFETY A: demand a profit; an unprofitable route must revert (nothing lost but gas)
  try {
    await flash.execute.staticCall(A.usdc, amt, targets, datas, 1n);
    log(best.pnlUsd > 0, 'SAFETY A: unprofitable trade reverts', best.pnlUsd > 0 ? 'route was actually profitable, so it did not revert' : 'DID NOT REVERT — unsafe');
  } catch (e) {
    const msg = e.shortMessage || e.message;
    log(/below minProfit|repay|transfer/i.test(msg), 'SAFETY A: unprofitable trade reverts', msg.slice(0, 120));
  }

  // 4. PLUMBING B: allow up to 1% loss so one full cycle really executes on the fork, then measure it.
  //    Pre-fund the contract with USDC (bought with fake ETH) so it can cover the loss when repaying.
  const uni = new ethers.Contract(A.uniRouter, UNI_ROUTER, owner);
  await (await uni.exactInputSingle({ tokenIn: A.weth, tokenOut: A.usdc, fee: 500, recipient: owner.address, amountIn: ethers.parseEther('1'), amountOutMinimum: 0, sqrtPriceLimitX96: 0 }, { value: ethers.parseEther('1') })).wait();
  const usdcT = new ethers.Contract(A.usdc, ERC20, owner);
  const buffer = amt / 50n;                          // 2% of the loan
  await (await usdcT.transfer(fa, buffer)).wait();
  const before = await usdcT.balanceOf(fa);
  const tx = await flash.execute(A.usdc, amt, targets, datas, -(amt / 100n));
  const rc = await tx.wait();
  const after = await usdcT.balanceOf(fa);
  const realPnl = usd(after) - usd(before);
  const ethUsd = usd(await quote({ dex: 'uni', fee: 500 }, A.weth, A.usdc, ethers.parseEther('1')));
  const gasEth = Number(ethers.formatEther(rc.gasUsed * (rc.gasPrice ?? rc.effectiveGasPrice ?? 0n)));
  results.fullCycle = { route: `${best.leg1} -> ${best.leg2}`, borrowedUsd: best.size, pnlUsd: +realPnl.toFixed(4), gasUsed: Number(rc.gasUsed), l2GasCostUsd: +(gasEth * ethUsd).toFixed(4), ethUsd: +ethUsd.toFixed(2) };
  log(rc.status === 1, 'PLUMBING B: borrow -> swap -> swap -> repay executed in ONE transaction',
    `borrowed $${best.size}, result ${realPnl >= 0 ? '+' : ''}$${realPnl.toFixed(4)}, gas ${rc.gasUsed} units ≈ $${(gasEth * ethUsd).toFixed(4)} L2 fee (plus a small L1 data fee the fork cannot measure)`);

  // 5. SAFETY C: strangers can't use it
  try { await flash.connect(stranger).execute.staticCall(A.usdc, amt, targets, datas, 0n); log(false, 'SAFETY C1: stranger cannot call execute', 'call succeeded — unsafe'); }
  catch (e) { log(/not owner/i.test(e.shortMessage || e.message), 'SAFETY C1: stranger cannot call execute', (e.shortMessage || e.message).slice(0, 80)); }
  try {
    const vault = new ethers.Contract(A.vault, VAULT, stranger);
    await vault.flashLoan.staticCall(fa, [A.usdc], [amt], ethers.AbiCoder.defaultAbiCoder().encode(['address[]', 'bytes[]', 'int256'], [targets, datas, -(amt)]));
    log(false, 'SAFETY C2: stranger cannot trigger our callback via the Vault', 'call succeeded — unsafe');
  } catch (e) { log(/not started by owner/i.test(e.shortMessage || e.message), 'SAFETY C2: stranger cannot trigger our callback via the Vault', (e.shortMessage || e.message).slice(0, 80)); }

  const out = path.resolve(__dirname, '..', 'results');
  fs.mkdirSync(out, { recursive: true });
  const f = path.join(out, `forkTest_${results.forkBlock}.json`);
  fs.writeFileSync(f, JSON.stringify(results, null, 2));
  const failed = results.checks.filter(c => !c.ok).length;
  console.log(`\n${results.checks.length - failed}/${results.checks.length} checks passed. Results: ${f}`);
}

main().catch(e => { console.error('FORK TEST ERROR:', e.shortMessage || e.message); process.exitCode = 1; });
