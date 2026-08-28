/**
 * Fiat & DeFi Onboarding Module
 * Aggregates fiat-to-crypto gateways (MoonPay, Transak, Stripe, Crypto.com Pay)
 * and assists in multi-chain wallet funding.
 */
const logger = require('../utils/logger');

const PROVIDERS = {
  transak: {
    name: 'Transak',
    feePct: 1.0,
    supportedFiats: ['USD', 'EUR', 'GBP', 'AUD', 'CAD', 'SGD'],
    paymentMethods: ['Bank Transfer (ACH/SEPA)', 'Credit/Debit Card', 'Apple Pay', 'Google Pay'],
    speed: 'Instant (Card) / 1-2 Days (Bank)',
    urlTemplate: 'https://global.transak.com?cryptoCurrencyCode={CRYPTO}&defaultFiatAmount={AMOUNT}&fiatCurrency={FIAT}&network={NETWORK}',
  },
  moonpay: {
    name: 'MoonPay',
    feePct: 1.9,
    supportedFiats: ['USD', 'EUR', 'GBP', 'AUD', 'CAD'],
    paymentMethods: ['Debit/Credit Card', 'Apple Pay', 'Google Pay', 'SEPA'],
    speed: 'Instant (5-10 mins)',
    urlTemplate: 'https://buy.moonpay.com?currencyCode={CRYPTO}&baseCurrencyAmount={AMOUNT}&baseCurrencyCode={FIAT}',
  },
  stripe_crypto: {
    name: 'Stripe Crypto Onramp',
    feePct: 1.5,
    supportedFiats: ['USD', 'EUR'],
    paymentMethods: ['US Bank Account (ACH)', 'Debit Card', 'Apple Pay'],
    speed: 'Instant',
    urlTemplate: 'https://crypto.link.com',
  },
  cryptocom_pay: {
    name: 'Crypto.com Pay',
    feePct: 0.5,
    supportedFiats: ['USD', 'EUR', 'GBP', 'SGD', 'HKD'],
    paymentMethods: ['Crypto.com App Balance', 'Debit Card', 'Bank Wire'],
    speed: 'Instant Zero-Fee Top Up',
    urlTemplate: 'https://crypto.com/pay',
  },
};

/**
 * Get aggregated fiat on-ramp quotes
 */
function getFiatOnrampQuotes({
  fiatCurrency = 'USD',
  fiatAmount = 250,
  cryptoAsset = 'USDC',
  network = 'base',
  walletAddress = process.env.WALLET_ADDRESS_BASE || '0x49B31006509f6e16972049e0B967FE1b6a22cE25',
}) {
  const quotes = Object.entries(PROVIDERS).map(([key, provider]) => {
    const feeUsd = (fiatAmount * provider.feePct) / 100;
    const netDepositUsd = fiatAmount - feeUsd;
    
    // Estimate token amount
    let tokenPrice = 1.0;
    if (cryptoAsset === 'BTC' || cryptoAsset === 'WBTC' || cryptoAsset === 'cbBTC') tokenPrice = 79000;
    else if (cryptoAsset === 'ETH' || cryptoAsset === 'WETH') tokenPrice = 2470;
    else if (cryptoAsset === 'SOL') tokenPrice = 98.3;
    else if (cryptoAsset === 'CRO') tokenPrice = 0.06;

    const estCryptoReceived = (netDepositUsd / tokenPrice).toFixed(6);

    const checkoutUrl = provider.urlTemplate
      .replace('{CRYPTO}', cryptoAsset)
      .replace('{AMOUNT}', fiatAmount)
      .replace('{FIAT}', fiatCurrency)
      .replace('{NETWORK}', network);

    return {
      providerKey: key,
      providerName: provider.name,
      fiatAmount: parseFloat(fiatAmount),
      fiatCurrency,
      cryptoAsset,
      network,
      feePct: `${provider.feePct}%`,
      feeUsd: parseFloat(feeUsd.toFixed(2)),
      netDepositUsd: parseFloat(netDepositUsd.toFixed(2)),
      estCryptoReceived: parseFloat(estCryptoReceived),
      paymentMethods: provider.paymentMethods,
      speed: provider.speed,
      destinationWallet: walletAddress,
      checkoutUrl,
    };
  });

  // Sort best value first
  quotes.sort((a, b) => b.netDepositUsd - a.netDepositUsd);

  return {
    success: true,
    fiatAmount,
    fiatCurrency,
    cryptoAsset,
    network,
    walletAddress,
    bestQuote: quotes[0],
    quotes,
  };
}

module.exports = {
  getFiatOnrampQuotes,
  PROVIDERS,
};
