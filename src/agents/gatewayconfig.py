from enum import Enum
from dataclasses import dataclass

class Platform(Enum):
    TELEGRAM = "telegram"
    DISCORD = "discord"
    API_SERVER = "api_server"
    # ...

@dataclass
class APIServerConfig:
    enabled: bool = False
    port: int = 8642
    host: str = "127.0.0.1"
    key: str = ""
    allow_model_override: bool = False
    max_concurrent: int = 5

@dataclass
class Config:
    # ...
    api_server: APIServerConfig
