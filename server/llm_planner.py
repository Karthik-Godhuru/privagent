"""
PrivAgent - Runtime AI Model Provider & Reasoning Module

Connects runtime reasoning models (Google Gemini API, OpenAI-compatible endpoints,
or local Ollama) through the FastAPI backend.

Architecture:
    SanitizedContext (Strictly PII-free, task-relevant)
            ↓
    Prompt Construction (Grounded in visible controls, zero raw DOM)
            ↓
    Privacy Gate Check (Fails closed if any sensitive keyword in prompt)
            ↓
    Runtime Model Inference (Gemini Native REST / OpenAI-compatible / Ollama)
            ↓
    Structured JSON Action Parsing & Strict Grounding Validation
            ↓
    Deterministic Fallback (with transparent provenance labeling)
"""

from __future__ import annotations

import json
import logging
import os
import random
import re
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional, Set, Tuple

logger = logging.getLogger("privagent.llm_planner")

# Keep retries short so model failures still reach the existing local fallback.
_MAX_TRANSIENT_RETRIES = 2
_RETRY_BASE_DELAY_SECONDS = 1.0
_RETRY_MAX_DELAY_SECONDS = 4.0
_RETRY_JITTER_SECONDS = 0.25


def _open_with_transient_retries(req, timeout: float, retry_transient: bool):
    """Retry only bounded Gemini 503s and network timeouts."""
    for attempt in range(_MAX_TRANSIENT_RETRIES + 1):
        try:
            return urllib.request.urlopen(req, timeout=timeout)
        except urllib.error.HTTPError as err:
            if not retry_transient or err.code != 503 or attempt >= _MAX_TRANSIENT_RETRIES:
                raise
        except (urllib.error.URLError, TimeoutError, OSError) as err:
            reason = getattr(err, "reason", None)
            is_timeout = isinstance(err, TimeoutError) or isinstance(reason, TimeoutError)
            is_timeout = is_timeout or type(reason).__name__ == "timeout"
            if not retry_transient or not is_timeout or attempt >= _MAX_TRANSIENT_RETRIES:
                raise

        delay = min(_RETRY_BASE_DELAY_SECONDS * (2 ** attempt), _RETRY_MAX_DELAY_SECONDS)
        time.sleep(delay + random.uniform(0.0, _RETRY_JITTER_SECONDS))

ALLOWED_ACTIONS = {"click", "type", "scroll", "navigate", "wait", "noop"}

SENSITIVE_KEYWORDS = [
    "password", "passwd", "secret", "token", "authorization",
    "credit_card", "card_number", "cvv", "cvc", "otp",
    "aadhaar", "pan_number", "account_number", "bank_account",
    "upi", "pin", "ssn", "passport"
]

# Supported Gemini models recognized by Google AI Studio API
KNOWN_GEMINI_MODELS = {
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-1.5-pro",
}

DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"


def load_env_file() -> None:
    """
    Loads key-value pairs from .env if present into os.environ.
    Never overwrites existing environment variables. Uses standard library only.
    """
    search_dirs = [
        os.getcwd(),
        os.path.dirname(__file__),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..")),
    ]
    for d in search_dirs:
        env_path = os.path.join(d, ".env")
        if os.path.isfile(env_path):
            try:
                with open(env_path, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith("#") and "=" in line:
                            k, v = line.split("=", 1)
                            k = k.strip()
                            v = v.strip().strip("'\"")
                            if k and k not in os.environ:
                                os.environ[k] = v
                break
            except Exception:
                pass


# Load .env file automatically if present
load_env_file()


def validate_model_name(name: Optional[str]) -> str:
    """
    Validates the configured model name to prevent invalid identifiers,
    injection, or broken endpoints. Defaults to a verified Gemini model.
    """
    if not name or not isinstance(name, str):
        return DEFAULT_GEMINI_MODEL

    cleaned = name.strip()
    if not cleaned:
        return DEFAULT_GEMINI_MODEL

    # Must be valid alphanumeric with hyphens, underscores, or periods
    if not re.match(r"^[a-zA-Z0-9_\.\-]+$", cleaned):
        return DEFAULT_GEMINI_MODEL

    return cleaned


def prompt_contains_sensitive_data(text: str) -> bool:
    """
    Fail-closed privacy check: Verifies that no sensitive keywords exist
    in the prompt or goal before model transmission.
    Uses word boundary check for short acronyms/words (len <= 4, e.g. pin, otp, cvv)
    to prevent false positives like 'shopping' (pin), 'hotpot' (otp), 'opinion' (pin).
    """
    if not text:
        return False
    lower = text.lower()
    for kw in SENSITIVE_KEYWORDS:
        if len(kw) <= 4:
            if re.search(r'(?:\b|_)' + re.escape(kw) + r'(?:\b|_)', lower):
                return True
        else:
            if kw in lower:
                return True
    return False


def build_planner_prompt(
    goal: str,
    controls: List[Dict[str, Any]],
    safe_labels: List[Dict[str, Any]]
) -> str:
    """
    Constructs a grounded, minimal prompt for the reasoning model.
    Contains ONLY safe controls and labels. Never includes raw DOM,
    passwords, auth tokens, or canary secrets.
    """
    compact_controls = []
    for c in controls:
        if c.get("enabled", True) and c.get("visible", True):
            compact_controls.append({
                "type": c.get("type", "control"),
                "role": c.get("role") or c.get("type", "control"),
                "label": c.get("label", ""),
                "selector": c.get("selector", "")
            })

    compact_labels = [l.get("text", "") for l in safe_labels if l.get("text")]

    prompt_data = {
        "user_goal": goal,
        "available_controls": compact_controls,
        "context_labels": compact_labels
    }

    return (
        "You are PrivAgent, an intelligent privacy-preserving browser automation agent.\n"
        "Your task is to select the single best next action to accomplish the user goal.\n"
        "You MUST only select from the provided available controls and their exact selectors.\n"
        "Do NOT hallucinate selectors or actions.\n\n"
        "Allowed actions:\n"
        "- click: {\"action\": \"click\", \"selector\": \"...\", \"reasoning\": \"...\"}\n"
        "- type: {\"action\": \"type\", \"selector\": \"...\", \"value\": \"...\", \"reasoning\": \"...\"}\n"
        "- scroll: {\"action\": \"scroll\", \"amount\": 600, \"reasoning\": \"...\"}\n"
        "- navigate: {\"action\": \"navigate\", \"url\": \"https://...\", \"reasoning\": \"...\"}\n"
        "- wait: {\"action\": \"wait\", \"reasoning\": \"...\"}\n"
        "- noop: {\"action\": \"noop\", \"reasoning\": \"...\"}\n\n"
        "Guidelines:\n"
        "- If the user goal has already been accomplished (for example, the requested section or data is already visible, or a button indicates a completed/loaded state such as 'Statement Loaded'), output action: noop.\n"
        "- Do NOT repeat an action if its observable outcome is already achieved.\n\n"
        "Respond ONLY with a valid JSON object matching the schema above. No markdown code fences, no extra text.\n\n"
        f"Input Data:\n{json.dumps(prompt_data, indent=2)}"
    )


def parse_model_response(
    raw_text: str,
    allowed_selectors: Set[str]
) -> Optional[Dict[str, Any]]:
    """
    Parses and verifies the LLM output against the allowed action schema
    and grounded selectors. Returns None if invalid or hallucinated.
    """
    if not raw_text or not isinstance(raw_text, str):
        return None

    cleaned = raw_text.strip()

    # Strip markdown code fences if present (e.g. ```json ... ```)
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()

    try:
        data = json.loads(cleaned)
    except (json.JSONDecodeError, ValueError):
        logger.warning("[PrivAgent Output Parser] Model response is not valid JSON.")
        return None

    if not isinstance(data, dict):
        logger.warning("[PrivAgent Output Parser] Model JSON root is not an object.")
        return None

    action_type = data.get("action")
    if action_type not in ALLOWED_ACTIONS:
        logger.warning("[PrivAgent Output Parser] Model returned disallowed action type.")
        return None

    # Validate grounding for targeted actions
    if action_type in {"click", "type"}:
        selector = data.get("selector")
        if not selector or selector not in allowed_selectors:
            # Ungrounded selector rejected: model hallucinated a selector
            logger.warning("[PrivAgent Grounding] Model proposed selector not in visible controls; rejected hallucination.")
            return None

    if action_type == "navigate":
        url = data.get("url")
        if not url or not str(url).startswith(("http://", "https://")):
            logger.warning("[PrivAgent Output Parser] Model navigate action has invalid or insecure URL.")
            return None

    if action_type == "scroll":
        try:
            data["amount"] = int(data.get("amount", 600))
        except (ValueError, TypeError):
            data["amount"] = 600

    return data


def extract_content_from_body(body: Dict[str, Any]) -> Optional[str]:
    """
    Extracts the text response across standard model API formats:
    - Native Google Gemini REST: body['candidates'][0]['content']['parts'][0]['text']
    - Ollama generate: body['response']
    - Ollama chat: body['message']['content']
    - OpenAI / Gemini ChatCompletions: body['choices'][0]['message']['content']
    """
    if not isinstance(body, dict):
        return None

    # 1. Native Google Gemini REST API format
    if "candidates" in body and isinstance(body["candidates"], list) and len(body["candidates"]) > 0:
        cand = body["candidates"][0]
        if isinstance(cand, dict) and "content" in cand and isinstance(cand["content"], dict):
            parts = cand["content"].get("parts", [])
            if isinstance(parts, list) and len(parts) > 0:
                part0 = parts[0]
                if isinstance(part0, dict) and "text" in part0 and isinstance(part0["text"], str):
                    return part0["text"]

    # 2. Ollama single generate format
    if "response" in body and isinstance(body["response"], str):
        return body["response"]

    # 3. Ollama chat format
    if "message" in body and isinstance(body["message"], dict):
        content = body["message"].get("content")
        if isinstance(content, str):
            return content

    # 4. OpenAI / Gemini Chat Completions format
    if "choices" in body and isinstance(body["choices"], list) and len(body["choices"]) > 0:
        first = body["choices"][0]
        if isinstance(first, dict):
            msg = first.get("message")
            if isinstance(msg, dict) and "content" in msg and isinstance(msg["content"], str):
                return msg["content"]
            text = first.get("text")
            if isinstance(text, str):
                return text

    return None


def query_llm(
    prompt: str,
    endpoint: Optional[str] = None,
    api_key: Optional[str] = None,
    model_name: Optional[str] = None,
    timeout: Optional[float] = None,
) -> Optional[str]:
    """
    Sends the prompt to the configured model endpoint using Python's standard
    library urllib (zero extra dependencies).

    Supported endpoint types:
    - Native Gemini REST: https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
    - Gemini / OpenAI Compatible: https://.../v1/chat/completions
    - Ollama: http://127.0.0.1:11434/api/generate
    """
    # Fail-closed privacy check: Never transmit prompt if sensitive keywords are detected
    if prompt_contains_sensitive_data(prompt):
        logger.warning("[PrivAgent Privacy Gate] Prompt contains sensitive keywords; transmission aborted.")
        return None

    key = (
        api_key
        if api_key is not None
        else (os.getenv("GEMINI_API_KEY") or os.getenv("PRIVAGENT_API_KEY", ""))
    ).strip()

    target_endpoint = (
        endpoint
        if endpoint is not None
        else os.getenv("PRIVAGENT_MODEL_ENDPOINT", "")
    ).strip()

    # If GEMINI_API_KEY is present or endpoint is omitted with an AIza key:
    if not target_endpoint and (os.getenv("GEMINI_API_KEY") or key.startswith("AIzaSy")):
        target_endpoint = "https://generativelanguage.googleapis.com/v1beta/models"

    if not target_endpoint:
        return None

    raw_model = (
        model_name
        if model_name is not None
        else os.getenv("PRIVAGENT_MODEL_NAME", "")
    )
    model = validate_model_name(raw_model)

    req_timeout = (
        timeout
        if timeout is not None
        else float(os.getenv("PRIVAGENT_MODEL_TIMEOUT", "4.0"))
    )

    base_url = target_endpoint.rstrip("/")
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "PrivAgent/1.1"
    }

    # Protocol 1: Native Google Gemini REST API
    is_native_gemini = "generativelanguage.googleapis.com" in base_url and "/openai" not in base_url
    # Protocol 2: Ollama Local REST API
    is_ollama = "11434" in base_url or base_url.endswith(("/api/generate", "/api/chat"))

    if is_native_gemini:
        if base_url.endswith(":generateContent"):
            url = base_url
        elif base_url.endswith("/models"):
            url = f"{base_url}/{model}:generateContent"
        elif "/models/" in base_url:
            url = f"{base_url}:generateContent"
        else:
            url = f"{base_url}/models/{model}:generateContent"

        # Pass API key in header x-goog-api-key (never in URL query string)
        if key:
            headers["x-goog-api-key"] = key

        payload = {
            "contents": [
                {
                    "parts": [{"text": prompt}]
                }
            ],
            "generationConfig": {
                "temperature": 0.0,
                "responseMimeType": "application/json"
            }
        }

    elif is_ollama:
        url = base_url if base_url.endswith(("/api/generate", "/api/chat")) else f"{base_url}/api/generate"
        payload = {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "format": "json"
        }

    else:
        # Protocol 3: OpenAI / Gemini OpenAI-Compatible / Groq / vLLM Chat Completions
        url = base_url if base_url.endswith("/chat/completions") else f"{base_url}/chat/completions"
        if key:
            headers["Authorization"] = f"Bearer {key}"
        payload = {
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": "You are PrivAgent. Select the best grounded browser action. Output ONLY a JSON object."
                },
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.0
        }

    start_time = time.monotonic()
    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST"
        )
        start_time = time.monotonic()
        with _open_with_transient_retries(req, req_timeout, is_native_gemini) as resp:
            if resp.status == 200:
                raw_bytes = resp.read()
                data = json.loads(raw_bytes.decode("utf-8"))
                return extract_content_from_body(data)
    except urllib.error.HTTPError as err:
        status_code = getattr(err, "code", 0)
        category = "unknown_http_error"
        error_msg = ""
        error_status = ""

        try:
            raw_err = err.read()
            if raw_err:
                err_data = json.loads(raw_err.decode("utf-8", errors="replace"))
                if isinstance(err_data, dict):
                    err_obj = err_data.get("error")
                    if isinstance(err_obj, dict):
                        # Extract error status / reason / type
                        raw_status = err_obj.get("status") or err_obj.get("type") or ""
                        if isinstance(raw_status, str):
                            error_status = raw_status.strip()

                        # Extract error message (truncated and sanitized)
                        raw_msg = err_obj.get("message") or ""
                        if isinstance(raw_msg, str):
                            sanitized = re.sub(r"AIza[0-9A-Za-z-_]{10,}", "[REDACTED_KEY]", raw_msg.strip())
                            error_msg = sanitized.split("\n")[0][:120].strip()
        except Exception:
            pass

        if status_code in (401, 403):
            category = "authentication_or_permission_denied"
        elif status_code == 404:
            category = "model_or_endpoint_not_found"
        elif status_code == 429:
            category = "quota_or_rate_limit_exceeded"
        elif 400 <= status_code < 500:
            category = "invalid_request_or_argument"
        elif 500 <= status_code < 600:
            category = "upstream_service_unavailable"

        detail_parts = [f"status={status_code}", f"category={category}"]
        if error_status:
            detail_parts.append(f"reason={error_status}")
        if error_msg:
            detail_parts.append(f"detail={error_msg}")

        logger.warning(
            f"[PrivAgent Model Gateway] Model HTTP error ({', '.join(detail_parts)})."
        )
        return None
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        elapsed_sec = round(time.monotonic() - start_time, 2)
        category = "network_io_error"
        detail = "connection_failed"

        is_timeout = isinstance(err, TimeoutError)
        underlying = getattr(err, "reason", None)
        if underlying is None and hasattr(err, "__cause__"):
            underlying = err.__cause__

        if isinstance(underlying, TimeoutError) or getattr(underlying, "__class__", None).__name__ == "timeout":
            is_timeout = True

        err_type = type(underlying if underlying is not None else err).__name__
        err_str = str(underlying or err).lower()

        if is_timeout or "timeout" in err_str:
            category = "network_timeout"
            detail = "request_timed_out"
        elif "refused" in err_str or err_type == "ConnectionRefusedError":
            category = "connection_refused"
            detail = "target_port_or_host_unreachable"
        elif "reset" in err_str or err_type == "ConnectionResetError":
            category = "connection_reset"
            detail = "connection_reset_by_peer"
        elif "gaierror" in err_type or "getaddrinfo" in err_str or "name or service not known" in err_str:
            category = "dns_resolution_failed"
            detail = "host_name_not_resolved"
        elif "ssl" in err_str or "certificate" in err_str or "ssl" in err_type.lower():
            category = "ssl_tls_error"
            detail = "tls_handshake_or_verification_failed"

        logger.warning(
            f"[PrivAgent Model Gateway] Model network failure (category={category}, detail={detail}, elapsed={elapsed_sec:.2f}s)."
        )
        return None
    except json.JSONDecodeError:
        logger.warning("[PrivAgent Model Gateway] Model HTTP response could not be parsed as JSON.")
        return None

    return None


def plan_with_model(
    goal: str,
    visible_controls: List[Dict[str, Any]],
    safe_labels: List[Dict[str, Any]],
    endpoint: Optional[str] = None,
    api_key: Optional[str] = None,
    model_name: Optional[str] = None,
    timeout: Optional[float] = None,
) -> Optional[Tuple[Dict[str, Any], str]]:
    """
    High-level entry point for model reasoning.
    Returns (action_dict, provenance) on success, or None if the model is
    unconfigured, failed, timed out, or returned an ungrounded action.
    Provenance is 'gemini' for Google Gemini models, or 'llm' for others.
    """
    # 1. Fail-closed privacy check on user goal
    if prompt_contains_sensitive_data(goal):
        return None

    target_endpoint = (
        endpoint
        if endpoint is not None
        else os.getenv("PRIVAGENT_MODEL_ENDPOINT", "")
    ).strip()

    key = (
        api_key
        if api_key is not None
        else (os.getenv("GEMINI_API_KEY") or os.getenv("PRIVAGENT_API_KEY", ""))
    ).strip()

    # Determine if Gemini or another model is configured
    if not target_endpoint and not key:
        return None

    allowed_selectors = {
        c.get("selector")
        for c in visible_controls
        if c.get("selector")
    }

    prompt = build_planner_prompt(goal, visible_controls, safe_labels)
    raw_response = query_llm(
        prompt,
        endpoint=target_endpoint or None,
        api_key=key or None,
        model_name=model_name,
        timeout=timeout,
    )

    if not raw_response:
        return None

    parsed_action = parse_model_response(raw_response, allowed_selectors)
    if not parsed_action:
        return None

    # Provenance labeling
    eff_endpoint = target_endpoint or "generativelanguage.googleapis.com"
    eff_model = model_name or os.getenv("PRIVAGENT_MODEL_NAME", "")
    if "generativelanguage.googleapis.com" in eff_endpoint or "gemini" in eff_model.lower():
        provenance = "gemini"
    elif not target_endpoint and os.getenv("GEMINI_API_KEY"):
        provenance = "gemini"
    else:
        provenance = "llm"

    return (parsed_action, provenance)
