"""
Environment Variable Validation and Configuration Module
Validates all required environment variables and provides configuration utilities
"""

import os
import sys
from pathlib import Path
from typing import Optional, Dict, List, Any
from dotenv import load_dotenv

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

# Load .env file from root directory
ENV_FILE = Path(__file__).resolve().parent.parent.parent / '.env'
if ENV_FILE.exists():
    load_dotenv(ENV_FILE)


class EnvValidator:
    """Validates and manages environment variable configuration."""

    # Required environment variables by category
    REQUIRED_VARS = {
        'llm': {
            'OPENROUTER_API_KEY': 'OpenRouter API key for multi-LLM access',
        },
        'exchange': {
            'BITGET_API_KEY': 'Bitget exchange API key',
            'BITGET_SECRET_KEY': 'Bitget exchange secret key',
            'BITGET_PASSPHRASE': 'Bitget exchange passphrase',
        },
        'notifications': {
            'TELEGRAM_BOT_TOKEN': 'Telegram bot token for alerts',
            'TELEGRAM_CHAT_ID': 'Telegram chat ID for alerts',
        },
    }

    # Optional but recommended variables
    OPTIONAL_RECOMMENDED = {
        'llm': [
            'ANTHROPIC_API_KEY',
            'OPENAI_API_KEY',
            'GEMINI_API_KEY',
        ],
        'exchange': [
            'BINANCE_API_KEY',
            'OKX_API_KEY',
        ],
    }

    # Variable categories for organization
    CATEGORIES = [
        'llm',
        'exchange',
        'notifications',
        'trading',
        'security',
        'database',
        'monitoring',
    ]

    @staticmethod
    def load_env_file(env_path: Optional[str] = None) -> bool:
        """
        Load environment variables from .env file.

        Args:
            env_path: Path to .env file (defaults to project root)

        Returns:
            True if .env file was loaded, False otherwise
        """
        if env_path is None:
            env_path = str(ENV_FILE)

        if Path(env_path).exists():
            load_dotenv(env_path)
            return True
        return False

    @staticmethod
    def get(key: str, default: Optional[str] = None, required: bool = False) -> Optional[str]:
        """
        Safely get an environment variable.

        Args:
            key: Environment variable name
            default: Default value if not found
            required: Raise error if not found

        Returns:
            Environment variable value or default

        Raises:
            EnvironmentError: If required variable is missing
        """
        value = os.getenv(key, default)

        if required and not value:
            raise EnvironmentError(f'Required environment variable missing: {key}')

        return value

    @classmethod
    def validate_required(cls) -> tuple[bool, List[str]]:
        """
        Validate all required environment variables are set.

        Returns:
            Tuple of (is_valid, list_of_missing_vars)
        """
        missing = []

        for category, vars_dict in cls.REQUIRED_VARS.items():
            for var_name, description in vars_dict.items():
                if not os.getenv(var_name):
                    missing.append(f'{var_name} ({category}: {description})')

        return len(missing) == 0, missing

    @classmethod
    def validate_optional(cls) -> Dict[str, List[str]]:
        """
        Check optional recommended variables.

        Returns:
            Dictionary of missing optional variables by category
        """
        missing_by_category = {}

        for category, var_list in cls.OPTIONAL_RECOMMENDED.items():
            missing = []
            for var_name in var_list:
                if not os.getenv(var_name):
                    missing.append(var_name)
            if missing:
                missing_by_category[category] = missing

        return missing_by_category

    @classmethod
    def check_configuration(cls) -> Dict[str, Any]:
        """
        Comprehensive configuration check.

        Returns:
            Dictionary with validation results
        """
        required_valid, missing_required = cls.validate_required()
        missing_optional = cls.validate_optional()

        return {
            'required_valid': required_valid,
            'missing_required': missing_required,
            'missing_optional': missing_optional,
            'has_all_required': len(missing_required) == 0,
            'environment': os.getenv('NODE_ENV', 'development'),
            'paper_trading': os.getenv('PAPER_TRADING', 'true').lower() == 'true',
        }

    @classmethod
    def print_configuration_report(cls) -> None:
        """Print a detailed configuration report to stdout."""
        config = cls.check_configuration()

        print('\n' + '=' * 70)
        print('🔧 ENVIRONMENT CONFIGURATION REPORT')
        print('=' * 70)

        print(f'\n📍 Environment: {config["environment"]}')
        print(f'📈 Trading Mode: {"PAPER" if config["paper_trading"] else "LIVE"}')

        # Required variables status
        if config['required_valid']:
            print('\n✅ All required variables are set')
        else:
            print(f'\n❌ Missing {len(config["missing_required"])} required variables:')
            for var in config['missing_required']:
                print(f'   - {var}')

        # Optional variables status
        if config['missing_optional']:
            print(f'\n⚠️  Missing optional variables (recommended):')
            for category, vars_list in config['missing_optional'].items():
                print(f'   {category.upper()}:')
                for var in vars_list:
                    print(f'      - {var}')
        else:
            print('\n✅ All optional recommended variables are set')

        print('\n' + '=' * 70)

    @classmethod
    def get_config_summary(cls) -> Dict[str, Any]:
        """
        Get a summary of current configuration (without exposing secrets).

        Returns:
            Dictionary with configuration summary
        """
        config = cls.check_configuration()

        summary = {
            'status': 'Ready' if config['has_all_required'] else 'Incomplete',
            'environment': config['environment'],
            'trading_mode': 'Paper' if config['paper_trading'] else 'Live',
            'required_vars_set': not bool(config['missing_required']),
            'missing_required_count': len(config['missing_required']),
            'missing_optional_count': sum(
                len(v) for v in config['missing_optional'].values()
            ),
        }

        return summary


class TradingConfig:
    """Trading-specific configuration."""

    @staticmethod
    def get_primary_symbol() -> str:
        """Get primary trading symbol."""
        return os.getenv('PRIMARY_SYMBOL', 'BTC/USDT')

    @staticmethod
    def get_secondary_symbols() -> List[str]:
        """Get secondary trading symbols."""
        symbols_str = os.getenv('SECONDARY_SYMBOLS', 'ETH/USDT,SOL/USDT')
        return [s.strip() for s in symbols_str.split(',')]

    @staticmethod
    def get_trading_mode() -> str:
        """Get trading mode (paper or live)."""
        return 'paper' if os.getenv('PAPER_TRADING', 'true').lower() == 'true' else 'live'

    @staticmethod
    def get_max_position_size() -> float:
        """Get maximum position size as a fraction."""
        return float(os.getenv('MAX_POSITION_SIZE', '0.1'))

    @staticmethod
    def get_risk_percentage() -> float:
        """Get risk percentage per trade."""
        return float(os.getenv('RISK_PER_TRADE', '2'))


class ExchangeConfig:
    """Exchange-specific configuration."""

    @staticmethod
    def get_exchange(name: str) -> Dict[str, str]:
        """
        Get exchange configuration by name.

        Args:
            name: Exchange name (bitget, binance, okx, etc.)

        Returns:
            Dictionary with exchange credentials
        """
        name = name.upper()

        config = {
            'apiKey': os.getenv(f'{name}_API_KEY', ''),
            'secret': os.getenv(f'{name}_SECRET_KEY', ''),
            'passphrase': os.getenv(f'{name}_PASSPHRASE', ''),
        }

        if name == 'BINANCE':
            config['sandbox'] = os.getenv('BINANCE_TESTNET_API_KEY', '') != ''
        elif name in ('BYBIT', 'OKX'):
            config['testnet'] = os.getenv(f'{name}_TESTNET', 'false').lower() == 'true'

        return config


def validate_on_startup() -> bool:
    """
    Validate configuration on application startup.

    Returns:
        True if all required variables are set, False otherwise
    """
    config = EnvValidator.check_configuration()

    if not config['has_all_required']:
        print('\n❌ CONFIGURATION ERROR: Missing required environment variables!')
        print('Required variables:')
        for var in config['missing_required']:
            print(f'  - {var}')
        print('\nPlease set these variables in your .env file or environment.')
        return False

    return True


if __name__ == '__main__':
    # Run validation report
    EnvValidator.print_configuration_report()
    sys.exit(0 if EnvValidator.check_configuration()['has_all_required'] else 1)
