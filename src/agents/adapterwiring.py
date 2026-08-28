from gateway.platforms.api_server import APIServerAdapter
from gateway.config import get_config, Platform

def _create_adapter(gateway, platform: Platform):
    cfg = get_config()
    if platform == Platform.API_SERVER and cfg.api_server.enabled:
        return APIServerAdapter(gateway)
    # existing adapters...
