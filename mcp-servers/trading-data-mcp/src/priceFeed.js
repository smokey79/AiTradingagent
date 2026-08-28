import { getDexPrice } from "./dexscreenerClient.js";

async function loop() {
  const token = "0xYourTokenAddressHere"; // replace
  const price = await getDexPrice(token, "ethereum");

  if (price) {
    console.log(
      [DexScreener] axios{price.priceUsd.toFixed(4)} | liq=axios{price.liquidityUsd} |  | 
    );
  } else {
    console.log("No price data");
  }
}

setInterval(loop, 5000);
loop();
