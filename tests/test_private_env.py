import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from core.private_env import load_api_defaults

class PrivateDefaultsTest(unittest.TestCase):
    def test_existing_settings_and_private_material_remain_excluded(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {}, clear=True):
            root = Path(folder)
            master = root / 'master.env'
            master.write_text('FIRECRAWL_API_KEY=synthetic-current-value-12345\nOPENROUTER_API_KEY=synthetic-router-value-12345\nOPENROUTER_API_KEY_2_HISTORICAL=synthetic-old-value-12345\nNEXO_PRIVATE_KEY=synthetic-private-value-12345\nTRADING_MODE=live\n', encoding='utf-8')
            (root / '.env').write_text('OPENROUTER_API_KEY=\n', encoding='utf-8')
            self.assertEqual(load_api_defaults(root, master), ['FIRECRAWL_API_KEY'])
            self.assertNotIn('TRADING_MODE', os.environ)
            self.assertNotIn('OPENROUTER_API_KEY', os.environ)
            self.assertNotIn('OPENROUTER_API_KEY_2_HISTORICAL', os.environ)
            self.assertNotIn('NEXO_PRIVATE_KEY', os.environ)
            os.environ['FIRECRAWL_API_KEY'] = 'synthetic-process-value-12345'
            self.assertEqual(load_api_defaults(root, master), [])
            self.assertEqual(os.environ['FIRECRAWL_API_KEY'], 'synthetic-process-value-12345')

if __name__ == '__main__': unittest.main()
