from __future__ import annotations

import json
import os
import unittest
from unittest.mock import patch

import httpx

from ai_service.app import DEFAULT_BASE_URL, app

TOKEN = "t" * 40
API_KEY = "deepseek-test-secret"
PROVIDER_URL = f"{DEFAULT_BASE_URL}/chat/completions"


def provider_response(message: dict, finish_reason: str = "stop") -> httpx.Response:
    tool_calls = message.get("tool_calls", [])
    if tool_calls:
        calls = [{"name": item["function"]["name"], "arguments": json.loads(item["function"]["arguments"])} for item in tool_calls]
        content = json.dumps({"answer": "", "tool_calls": calls}, ensure_ascii=False)
    else:
        content = json.dumps({"answer": message.get("content", ""), "tool_calls": []}, ensure_ascii=False)
    return httpx.Response(
        200,
        json={"choices": [{"message": {"role": "assistant", "content": content}, "finish_reason": finish_reason}], "usage": {"prompt_tokens": 3, "completion_tokens": 2}},
    )


class AIServiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.env = patch.dict(os.environ, {
            "DEEPSEEK_API_KEY": API_KEY,
            "AGENT_SERVICE_TOKEN": TOKEN,
            "KUPALA_BACKEND_URL": "https://backend.test",
            "DEEPSEEK_BASE_URL": DEFAULT_BASE_URL,
            "DEEPSEEK_MODEL": "legacy-override-must-be-ignored",
        }, clear=True)
        self.env.start()
        self.app_transport = httpx.ASGITransport(app=app)

    def tearDown(self) -> None:
        self.env.stop()
        app.state.http_transport = None

    async def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=self.app_transport, base_url="http://service.test")

    async def test_authentication_and_safe_health(self) -> None:
        async def handler(request: httpx.Request) -> httpx.Response:
            self.fail(f"unexpected request: {request.url}")

        app.state.http_transport = httpx.MockTransport(handler)
        async with await self._client() as client:
            unauthorized = await client.get("/health")
            self.assertEqual(unauthorized.status_code, 401)
            health = await client.get("/health", headers={"Authorization": f"Bearer {TOKEN}"})
            self.assertEqual(health.status_code, 200)
            self.assertEqual(health.json(), {"configured": True, "model": "deepseek-flash", "reason": "ready"})
            with patch.dict(os.environ, {"DEEPSEEK_API_KEY": ""}):
                unavailable = await client.get("/health", headers={"Authorization": f"Bearer {TOKEN}"})
            self.assertEqual(unavailable.json(), {"configured": False, "model": "deepseek-flash", "reason": "missing_api_key"})

    async def test_missing_api_key_returns_unavailable_without_provider_call(self) -> None:
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": ""}):
            async with await self._client() as client:
                response = await client.post("/chat", headers={"Authorization": f"Bearer {TOKEN}"}, json={"message": "Привет", "history": [], "context": {}, "grant": "opaque"})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"detail": "AI service is not configured"})

    async def test_debug_base_url_posts_to_debug_endpoint(self) -> None:
        async def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(str(request.url), "https://llm.azati.ai/debug")
            data = json.loads(request.content)
            self.assertEqual(data["model"], "deepseek-flash")
            self.assertEqual(data["max_tokens"], 2000)
            self.assertEqual(data["response_format"], {"type": "json_object"})
            return provider_response({"role": "assistant", "content": "Готово."})

        app.state.http_transport = httpx.MockTransport(handler)
        with patch.dict(os.environ, {"DEEPSEEK_BASE_URL": "https://llm.azati.ai/debug"}):
            async with await self._client() as client:
                response = await client.post("/chat", headers={"Authorization": f"Bearer {TOKEN}"}, json={
                    "message": "Привет", "history": [], "context": {}, "grant": "opaque",
                })
        self.assertEqual(response.status_code, 200, response.text)

    async def test_invalid_provider_url_is_unavailable_without_outgoing_call(self) -> None:
        calls: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            calls.append(request)
            self.fail("invalid provider URL must prevent outgoing calls")

        app.state.http_transport = httpx.MockTransport(handler)
        with patch.dict(os.environ, {"DEEPSEEK_BASE_URL": "https://user:password@llm.azati.ai/v1?token=secret"}):
            async with await self._client() as client:
                health = await client.get("/health", headers={"Authorization": f"Bearer {TOKEN}"})
                response = await client.post("/chat", headers={"Authorization": f"Bearer {TOKEN}"}, json={
                    "message": "Привет", "history": [], "context": {}, "grant": "opaque",
                })
        self.assertEqual(health.json()["reason"], "invalid_provider_base_url")
        self.assertFalse(health.json()["configured"])
        self.assertEqual(response.status_code, 503)
        self.assertEqual(calls, [])

    async def test_malformed_provider_json_returns_sanitized_error(self) -> None:
        async def handler(_: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": "not-json"}}]})

        app.state.http_transport = httpx.MockTransport(handler)
        async with await self._client() as client:
            response = await client.post("/chat", headers={"Authorization": f"Bearer {TOKEN}"}, json={
                "message": "Привет", "history": [], "context": {}, "grant": "opaque",
            })
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json(), {"detail": "AI provider error"})

    async def test_tool_loop_passes_grant_only_to_backend_and_collects_proposal(self) -> None:
        observed: list[httpx.Request] = []
        step = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal step
            observed.append(request)
            if request.url == httpx.URL(PROVIDER_URL):
                step += 1
                data = json.loads(request.content)
                self.assertNotIn("opaque-grant", json.dumps(data))
                self.assertEqual(data["response_format"], {"type": "json_object"})
                self.assertNotIn("thinking", data)
                self.assertNotIn("tools", data)
                self.assertNotIn("tool_choice", data)
                self.assertEqual(data["model"], "deepseek-flash")
                prompt = json.dumps(data["messages"], ensure_ascii=False)
                self.assertIn("propose_task", prompt)
                self.assertIn("get_schedule", prompt)
                self.assertEqual(data["max_tokens"], 2000)
                if step == 1:
                    return provider_response({"role": "assistant", "tool_calls": [{
                        "id": "call-1",
                        "type": "function",
                        "function": {"name": "propose_task", "arguments": '{"title":"Повторить тему"}'},
                    }]}, "tool_calls")
                self.assertEqual(data["messages"][-1]["role"], "user")
                self.assertIn('"proposal"', data["messages"][-1]["content"])
                return provider_response({"role": "assistant", "content": "Подготовил предложение о задаче."})
            self.assertEqual(str(request.url), "https://backend.test/internal/assistant/tools")
            self.assertEqual(request.headers["authorization"], f"Bearer {TOKEN}")
            self.assertEqual(request.headers["x-agent-grant"], "opaque-grant")
            self.assertEqual(json.loads(request.content), {"name": "propose_task", "arguments": {"title": "Повторить тему"}})
            return httpx.Response(200, json={"data": {"status": "proposal"}, "sources": [], "proposal": {"kind": "create_task", "title": "Повторить тему"}})

        app.state.http_transport = httpx.MockTransport(handler)
        async with await self._client() as client:
            response = await client.post("/chat", headers={"Authorization": f"Bearer {TOKEN}"}, json={
                "message": "Добавь повторение темы", "history": [], "context": {
                    "tasks": [],
                    "sources": [
                        {"title": "Fake label", "url": "/#tasks"},
                        {"title": "External", "url": "https://attacker.example"},
                    ],
                }, "grant": "opaque-grant",
            })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["answer"], "Подготовил предложение о задаче.")
        self.assertEqual(response.json()["proposals"], [{"kind": "create_task", "title": "Повторить тему"}])
        self.assertEqual(response.json()["sources"], [{"title": "Личные задачи", "url": "/#tasks"}])
        self.assertEqual(response.json()["usage"], {"prompt_tokens": 6, "completion_tokens": 4})
        self.assertEqual(len(observed), 3)

    async def test_provider_error_is_sanitized(self) -> None:
        async def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(401, text=f"bad key {API_KEY}")

        app.state.http_transport = httpx.MockTransport(handler)
        async with await self._client() as client:
            response = await client.post("/chat", headers={"Authorization": f"Bearer {TOKEN}"}, json={"message": "Привет", "history": [], "context": {}, "grant": "g"})
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json(), {"detail": "AI provider error"})
        self.assertNotIn(API_KEY, response.text)

    async def test_unknown_tool_is_not_sent_to_backend(self) -> None:
        step = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal step
            if request.url == httpx.URL(PROVIDER_URL):
                step += 1
                if step == 1:
                    return provider_response({"role": "assistant", "tool_calls": [{
                        "id": "call-unknown", "type": "function",
                        "function": {"name": "delete_everything", "arguments": "{}"},
                    }]}, "tool_calls")
                self.assertIn("неизвестный", request.content.decode().lower())
                return provider_response({"role": "assistant", "content": "Не удалось выполнить это действие."})
            self.fail("unknown tool must not be called on the backend")

        app.state.http_transport = httpx.MockTransport(handler)
        async with await self._client() as client:
            response = await client.post("/chat", headers={"Authorization": f"Bearer {TOKEN}"}, json={"message": "Сделай", "history": [], "context": {}, "grant": "g"})
        self.assertEqual(response.status_code, 200, response.text)

    async def test_provider_round_limit_and_truncated_answer_fail_safely(self) -> None:
        provider_count = 0
        backend_count = 0

        async def loop_handler(request: httpx.Request) -> httpx.Response:
            nonlocal provider_count, backend_count
            if request.url == httpx.URL(PROVIDER_URL):
                provider_count += 1
                call_number = provider_count
                return provider_response({"role": "assistant", "tool_calls": [{
                    "id": f"call-{call_number}", "type": "function",
                    "function": {"name": "get_tasks", "arguments": "{}"},
                }]}, "tool_calls")
            backend_count += 1
            return httpx.Response(200, json={"data": []})

        app.state.http_transport = httpx.MockTransport(loop_handler)
        async with await self._client() as client:
            too_many_rounds = await client.post("/chat", headers={"Authorization": f"Bearer {TOKEN}"}, json={"message": "План", "history": [], "context": {}, "grant": "g"})
        self.assertEqual(too_many_rounds.status_code, 502)
        self.assertEqual(too_many_rounds.json(), {"detail": "AI provider exceeded the response round limit"})
        self.assertEqual(provider_count, 4)
        self.assertEqual(backend_count, 4)

        app.state.http_transport = httpx.MockTransport(lambda request: provider_response({"role": "assistant", "content": "Обрезано"}, "length"))
        async with await self._client() as client:
            truncated = await client.post("/chat", headers={"Authorization": f"Bearer {TOKEN}"}, json={"message": "План", "history": [], "context": {}, "grant": "g"})
        self.assertEqual(truncated.status_code, 502)
        self.assertEqual(truncated.json(), {"detail": "AI provider returned an incomplete answer"})

    async def test_oversized_backend_tool_response_is_bounded_and_safe(self) -> None:
        provider_calls = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal provider_calls
            if request.url == httpx.URL(PROVIDER_URL):
                provider_calls += 1
                if provider_calls == 1:
                    return provider_response({"role": "assistant", "tool_calls": [{
                        "id": "call-large-tool", "type": "function",
                        "function": {"name": "get_tasks", "arguments": "{}"},
                    }]}, "tool_calls")
                messages = json.loads(request.content)["messages"]
                tool_result = json.loads(messages[-1]["content"].split("\n", 1)[1])[0]["result"]
                self.assertEqual(tool_result, {"error": "Ответ инструмента слишком большой."})
                return provider_response({"role": "assistant", "content": "Не удалось прочитать данные."})
            return httpx.Response(200, content=b"x" * (64 * 1024 + 1))

        app.state.http_transport = httpx.MockTransport(handler)
        async with await self._client() as client:
            response = await client.post("/chat", headers={"Authorization": f"Bearer {TOKEN}"}, json={
                "message": "Покажи задачи", "history": [], "context": {}, "grant": "g",
            })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["answer"], "Не удалось прочитать данные.")

    async def test_oversized_provider_response_returns_sanitized_error(self) -> None:
        valid_payload = json.dumps({"choices": [{"message": {"role": "assistant", "content": "answer"}, "finish_reason": "stop"}]})

        async def handler(request: httpx.Request) -> httpx.Response:
            content = (valid_payload + " " * (256 * 1024 + 1)).encode()
            return httpx.Response(200, content=content)

        app.state.http_transport = httpx.MockTransport(handler)
        async with await self._client() as client:
            response = await client.post("/chat", headers={"Authorization": f"Bearer {TOKEN}"}, json={
                "message": "Привет", "history": [], "context": {}, "grant": "g",
            })
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json(), {"detail": "AI provider error"})

    async def test_invalid_backend_url_is_unavailable_without_forwarding_secrets(self) -> None:
        calls: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            calls.append(request)
            self.fail("invalid backend URL must prevent all outgoing calls")

        app.state.http_transport = httpx.MockTransport(handler)
        with patch.dict(os.environ, {"KUPALA_BACKEND_URL": "http://remote.example"}):
            async with await self._client() as client:
                health = await client.get("/health", headers={"Authorization": f"Bearer {TOKEN}"})
                response = await client.post("/chat", headers={"Authorization": f"Bearer {TOKEN}"}, json={
                    "message": "Привет", "history": [], "context": {}, "grant": "g",
                })
        self.assertEqual(health.json()["reason"], "invalid_backend_url")
        self.assertFalse(health.json()["configured"])
        self.assertEqual(response.status_code, 503)
        self.assertEqual(calls, [])

    async def test_backend_redirect_is_not_followed_or_forwarded(self) -> None:
        provider_calls = 0
        backend_calls = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal provider_calls, backend_calls
            if request.url == httpx.URL(PROVIDER_URL):
                provider_calls += 1
                if provider_calls == 1:
                    return provider_response({"role": "assistant", "tool_calls": [{
                        "id": "call-redirect", "type": "function",
                        "function": {"name": "get_tasks", "arguments": "{}"},
                    }]}, "tool_calls")
                return provider_response({"role": "assistant", "content": "Данные временно недоступны."})
            backend_calls += 1
            self.assertEqual(request.url.host, "backend.test")
            return httpx.Response(302, headers={"Location": "https://attacker.example/collect"})

        app.state.http_transport = httpx.MockTransport(handler)
        async with await self._client() as client:
            response = await client.post("/chat", headers={"Authorization": f"Bearer {TOKEN}"}, json={
                "message": "Что задано?", "history": [], "context": {}, "grant": "g",
            })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(backend_calls, 1)
        self.assertEqual(provider_calls, 2)


if __name__ == "__main__":
    unittest.main()
