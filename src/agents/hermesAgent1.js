import os
import json
import time
import uuid
from typing import Any, Dict, List, Optional

from aiohttp import web

from gateway.platforms.base import BasePlatformAdapter
from gateway.config import get_config
from gateway.agent import AIAgent  # or whatever your agent entrypoint is


class APIServerAdapter(BasePlatformAdapter):
    def __init__(self, gateway: Any):
        super().__init__(gateway)
        cfg = get_config().api_server

        self.host = cfg.host
        self.port = cfg.port
        self.key = cfg.key or os.getenv("API_SERVER_KEY")
        self.allow_model_override = cfg.allow_model_override
        self.max_concurrent = cfg.max_concurrent

        self.app = web.Application(middlewares=[self._auth_middleware])
        self._sessions: Dict[str, Any] = {}          # session_id -> session object
        self._responses: Dict[str, Any] = {}         # response_id -> internal chain

    async def connect(self) -> None:
        # Register routes
        self.app.router.add_post("/v1/chat/completions", self._handle_chat_completions)
        self.app.router.add_post("/v1/responses", self._handle_responses)
        self.app.router.add_get("/v1/models", self._handle_models)
        self.app.router.add_get("/health", self._handle_health)

        runner = web.AppRunner(self.app)
        await runner.setup()
        site = web.TCPSite(runner, self.host, self.port)
        await site.start()

        self.logger.info(f"API server listening on http://{self.host}:{self.port}")

    # ---------- middleware ----------

    @web.middleware
    async def _auth_middleware(self, request, handler):
        # Optional: allow unauthenticated if bound to 127.0.0.1 and key is empty
        if self.key:
            auth = request.headers.get("Authorization", "")
            if not auth.startswith("Bearer "):
                return web.json_response({"error": "Unauthorized"}, status=401)
            token = auth.split(" ", 1)[1]
            if token != self.key:
                return web.json_response({"error": "Unauthorized"}, status=401)

        return await handler(request)

    # ---------- helpers ----------

    def _now_ts(self) -> int:
        return int(time.time())

    def _new_id(self, prefix: str) -> str:
        return f"{prefix}-{uuid.uuid4().hex[:12]}"

    def _get_session(self, request) -> Any:
        session_id = request.headers.get("X-Session-ID")
        if not session_id:
            return None
        if session_id not in self._sessions:
            # create new session via gateway/session infra
            self._sessions[session_id] = self.gateway.create_session(
                platform="api_server",
                session_id=session_id,
            )
        return self._sessions[session_id]

    def _map_model(self, requested: str) -> str:
        cfg = get_config()
        if self.allow_model_override and requested:
            return requested
        # otherwise use hermes-agent’s configured model
        return cfg.agent.model_name

    # ---------- endpoints ----------

    async def _handle_health(self, request: web.Request) -> web.Response:
        return web.json_response({"status": "ok"})

    async def _handle_models(self, request: web.Request) -> web.Response:
        created = self._now_ts()
        data = {
            "object": "list",
            "data": [
                {
                    "id": "hermes-agent",
                    "object": "model",
                    "created": created,
                    "owned_by": "hermes-agent",
                }
            ],
        }
        return web.json_response(data)

    async def _handle_chat_completions(self, request: web.Request) -> web.StreamResponse:
        body = await request.json()

        model = body.get("model", "hermes-agent")
        messages = body.get("messages", [])
        stream = bool(body.get("stream", False))
        temperature = body.get("temperature", 0.7)

        session = self._get_session(request)
        mapped_model = self._map_model(model)

        # Build hermes-agent input from OpenAI messages
        # You likely already have a helper for this in other adapters.
        agent_input = self._convert_oai_messages_to_agent_input(messages)

        # Run conversation (Phase 1: synchronous, non-streaming)
        agent = AIAgent(
            model_name=mapped_model,
            session=session,
            temperature=temperature,
        )
        result = await self.gateway.run_agent(agent, agent_input)

        # result should contain: text, usage, maybe internal chain
        full_text = result.output_text
        usage = result.usage or {}

        if not stream:
            # Non-streaming JSON response
            resp = {
                "id": self._new_id("chatcmpl"),
                "object": "chat.completion",
                "created": self._now_ts(),
                "model": "hermes-agent",
                "choices": [
                    {
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": full_text,
                        },
                        "finish_reason": "stop",
                    }
                ],
                "usage": {
                    "prompt_tokens": usage.get("prompt_tokens", 0),
                    "completion_tokens": usage.get("completion_tokens", 0),
                    "total_tokens": usage.get("total_tokens", 0),
                },
            }
            return web.json_response(resp)

        # Phase 1 streaming: single SSE chunk + [DONE]
        response = web.StreamResponse(
            status=200,
            reason="OK",
            headers={"Content-Type": "text/event-stream"},
        )
        await response.prepare(request)

        chunk = {
            "id": self._new_id("chatcmpl"),
            "object": "chat.completion.chunk",
            "choices": [
                {
                    "index": 0,
                    "delta": {
                        "role": "assistant",
                        "content": full_text,
                    },
                    "finish_reason": "stop",
                }
            ],
        }

        await response.write(f"data: {json.dumps(chunk)}\n\n".encode("utf-8"))
        await response.write(b"data: [DONE]\n\n")
        await response.write_eof()
        return response

    async def _handle_responses(self, request: web.Request) -> web.StreamResponse:
        """
        Server-side stateful Responses API:
        - Accepts previous_response_id
        - Reconstructs full internal chain from self._responses
        - Stores new response chain keyed by new response_id
        """
        body = await request.json()

        previous_id = body.get("previous_response_id")
        input_text = body.get("input", "")
        stream = bool(body.get("stream", False))

        session = self._get_session(request)

        # reconstruct context chain if previous_id provided
        previous_chain = self._responses.get(previous_id)

        agent = AIAgent(
            session=session,
            previous_chain=previous_chain,
        )
        result = await self.gateway.run_agent(agent, input_text)

        response_id = self._new_id("resp")
        self._responses[response_id] = result.internal_chain

        if not stream:
            resp = {
                "id": response_id,
                "object": "response",
                "created": self._now_ts(),
                "output_text": result.output_text,
                "usage": result.usage or {},
            }
            return web.json_response(resp)

        # streaming: single chunk for now
        sse = web.StreamResponse(
            status=200,
            reason="OK",
            headers={"Content-Type": "text/event-stream"},
        )
        await sse.prepare(request)

        chunk = {
            "id": response_id,
            "object": "response.chunk",
            "output_text": {
                "delta": result.output_text,
                "finish_reason": "stop",
            },
        }

        await sse.write(f"data: {json.dumps(chunk)}\n\n".encode("utf-8"))
        await sse.write(b"data: [DONE]\n\n")
        await sse.write_eof()
        return sse

    # ---------- message conversion ----------

    def _convert_oai_messages_to_agent_input(self, messages: List[Dict[str, Any]]) -> Any:
        """
        Map OpenAI-style messages into whatever hermes-agent expects.
        Example: concatenate system + user + assistant into a single
        conversation object used by AIAgent.
        """
        # This is pseudo-code; adapt to your actual gateway/session API.
        return {
            "messages": messages,
        }
