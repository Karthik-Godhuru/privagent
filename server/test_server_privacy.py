# ============================================================
# PRIVAGENT — SERVER-SIDE PRIVACY & SECURITY TEST SUITE
#
# Tests:
# 1. Server-side fail-closed rejection on sensitive keywords in goal/labels.
# 2. X-PrivAgent-Token authentication enforcement on /agent.
# 3. Action schema and parameter validation.
# 4. AI model grounding, schema compliance, and hallucination rejection.
# 5. Mocked model providers (Ollama, OpenAI, Gemini) and provenance labeling.
# 6. Observable completion and verified outcome detection.
# 7. Native Google Gemini REST integration, header authentication, and security.
#
# Run with:
#   python -m pytest -o asyncio_mode=auto server/test_server_privacy.py -q
#   python server/test_server_privacy.py
# ============================================================

import asyncio
import json
import os
import sys
import urllib.error
from unittest.mock import patch, MagicMock

from fastapi import HTTPException
from main import (
    contains_sensitive_text,
    validate_context,
    validate_action,
    agent,
    AgentRequest,
    SanitizedContext,
    Action,
    VisibleControl,
    SafeLabel,
    PRIVAGENT_AUTH_TOKEN
)

try:
    from llm_planner import (
        build_planner_prompt,
        parse_model_response,
        plan_with_model,
        load_env_file,
    )
except ImportError:
    from server.llm_planner import (
        build_planner_prompt,
        parse_model_response,
        plan_with_model,
        load_env_file,
    )

passed = 0
failed = 0

def check(description: str, condition: bool) -> None:
    global passed, failed
    if condition:
        print(f"  ✓  {description}")
        passed += 1
    else:
        print(f"  ✗  {description}")
        failed += 1
    assert condition, description


def make_mock_urlopen(status_code: int, json_payload: dict) -> MagicMock:
    mock_resp = MagicMock()
    mock_resp.status = status_code
    mock_resp.read.return_value = json.dumps(json_payload).encode("utf-8")
    mock_resp.__enter__.return_value = mock_resp
    return mock_resp


# ------------------------------------------------------------
# 1. SENSITIVE KEYWORD DETECTION
# ------------------------------------------------------------
def test_sensitive_keyword_detection():
    print("\n--- 1. Sensitive Keyword Detection ---")
    check("Detects password keyword", contains_sensitive_text("enter your password now"))
    check("Detects OTP keyword", contains_sensitive_text("submit with otp 849201"))
    check("Detects CVV keyword", contains_sensitive_text("enter CVV code"))
    check("Detects UPI keyword", contains_sensitive_text("pay via upi handle"))
    check("Detects Account Number keyword", contains_sensitive_text("check account_number status"))
    check("Detects passport keyword", contains_sensitive_text("verify passport number"))
    check("Allows safe command", not contains_sensitive_text("click view statement button"))
    check("Allows safe e-commerce goal", not contains_sensitive_text("add black leather boots to cart"))


# ------------------------------------------------------------
# 2. CONTEXT VALIDATION (FAIL-CLOSED)
# ------------------------------------------------------------
def test_server_context_fail_closed_validation():
    print("\n--- 2. Server Context Fail-Closed Validation ---")

    # Goal with secret keyword
    context_with_secret_goal = SanitizedContext(
        goal="transfer funds using secret password",
        visible_controls=[],
        safe_labels=[]
    )
    try:
        validate_context(context_with_secret_goal)
        check("Blocks goal with sensitive keyword", False)
    except HTTPException as e:
        check("Blocks goal with sensitive keyword (HTTP 400)", e.status_code == 400)

    # Control label with secret keyword
    context_with_secret_label = SanitizedContext(
        goal="click next",
        visible_controls=[
            VisibleControl(type="input", label="card_number input field", selector="#card")
        ],
        safe_labels=[]
    )
    try:
        validate_context(context_with_secret_label)
        check("Blocks control label with sensitive keyword", False)
    except HTTPException as e:
        check("Blocks control label with sensitive keyword (HTTP 400)", e.status_code == 400)

    # Clean context
    clean_context = SanitizedContext(
        goal="click view statement",
        visible_controls=[
            VisibleControl(type="button", label="View Statement", selector="#statementButton")
        ],
        safe_labels=[SafeLabel(text="Banking Portal", role="page_title")]
    )
    try:
        validate_context(clean_context)
        check("Approves clean context without false positives", True)
    except Exception:
        check("Approves clean context without false positives", False)


# ------------------------------------------------------------
# 3. ACTION SCHEMA & SECURITY VALIDATION
# ------------------------------------------------------------
def test_action_schema_validation():
    print("\n--- 3. Action Schema Validation ---")

    # Click without selector
    try:
        validate_action(Action(action="click", selector=None))
        check("Rejects click without selector or coordinates", False)
    except HTTPException as e:
        check("Rejects click without selector or coordinates (HTTP 400)", e.status_code == 400)

    # Navigate without URL
    try:
        validate_action(Action(action="navigate", url=None))
        check("Rejects navigate without URL", False)
    except HTTPException as e:
        check("Rejects navigate without URL (HTTP 400)", e.status_code == 400)

    # Valid click
    valid_click = validate_action(Action(action="click", selector="#statementButton"))
    check("Validates grounded click action", valid_click.action == "click" and valid_click.selector == "#statementButton")


# ------------------------------------------------------------
# 4. ENDPOINT AUTHENTICATION (X-PrivAgent-Token)
# ------------------------------------------------------------
async def test_endpoint_security():
    print("\n--- 4. Endpoint Authentication Security ---")
    clean_request = AgentRequest(
        goal="click view statement",
        elements=[
            {"id": "el_1", "type": "button", "label": "View Statement", "selector": "#statementButton"}
        ]
    )

    # Missing token
    try:
        await agent(clean_request, x_privagent_token=None)
        check("Rejects request without X-PrivAgent-Token", False)
    except HTTPException as e:
        check("Rejects request without X-PrivAgent-Token (HTTP 401)", e.status_code == 401)

    # Invalid token
    try:
        await agent(clean_request, x_privagent_token="malicious-token")
        check("Rejects request with invalid token", False)
    except HTTPException as e:
        check("Rejects request with invalid token (HTTP 401)", e.status_code == 401)

    # Valid token
    try:
        response = await agent(clean_request, x_privagent_token=PRIVAGENT_AUTH_TOKEN)
        check("Approves request with valid X-PrivAgent-Token", response.success is True)
        check("Returns grounded action on target control", response.action.action == "click" and response.action.selector == "#statementButton")
    except Exception as e:
        check(f"Approves request with valid token (error: {e})", False)


# ------------------------------------------------------------
# 5. AI MODEL GROUNDING & SAFETY TESTS
# ------------------------------------------------------------
def test_ai_model_grounding_and_safety():
    print("\n--- 5. AI Model Grounding & Safety Tests ---")
    sample_controls = [
        {"type": "button", "label": "Add to Cart", "selector": "#add-to-cart-btn", "enabled": True},
        {"type": "input", "label": "Search Store", "selector": "#search-box", "enabled": True}
    ]
    sample_labels = [{"text": "Shopping Cart", "role": "page_title", "selector": None}]

    prompt = build_planner_prompt("click add to cart", sample_controls, sample_labels)
    check("Prompt contains goal and control labels", "add to cart" in prompt and "Shopping Cart" in prompt)
    check("Prompt does not contain raw HTML or passwords", "<html" not in prompt and "password" not in prompt)

    # Grounding check
    allowed_selectors = {"#add-to-cart-btn", "#search-box"}
    valid_llm_json = '{"action": "click", "selector": "#add-to-cart-btn", "reasoning": "Matches user goal"}'
    parsed = parse_model_response(valid_llm_json, allowed_selectors)
    check("Accepts grounded selector from LLM output", parsed is not None and parsed["selector"] == "#add-to-cart-btn")

    # Hallucinated selector check
    hallucinated_json = '{"action": "click", "selector": "#hallucinated-buy-now", "reasoning": "Made up"}'
    parsed_fake = parse_model_response(hallucinated_json, allowed_selectors)
    check("Rejects ungrounded (hallucinated) selector", parsed_fake is None)

    # Unsupported action check
    unsafe_action_json = '{"action": "eval_javascript", "script": "alert(1)"}'
    parsed_unsafe = parse_model_response(unsafe_action_json, allowed_selectors)
    check("Rejects unsupported action type", parsed_unsafe is None)


# ------------------------------------------------------------
# 6. MOCKED MODEL PROVIDERS & FALLBACK PROVENANCE TESTS
# ------------------------------------------------------------
def test_mocked_model_providers():
    print("\n--- 6. Mocked Model Providers & Fallback Provenance Tests ---")
    sample_controls = [
        {"type": "button", "label": "Add to Cart", "selector": "#add-to-cart-btn", "enabled": True},
        {"type": "input", "label": "Search Store", "selector": "#search-box", "enabled": True}
    ]
    sample_labels = [{"text": "Shopping Cart", "role": "page_title", "selector": None}]

    # 6.1 Missing Configuration Test
    res_unconfigured = plan_with_model("click add to cart", sample_controls, sample_labels, endpoint="", api_key="")
    check("Returns None when endpoint is unconfigured", res_unconfigured is None)

    # 6.2 Mock Ollama Provider Format (/api/generate)
    mock_ollama_resp = make_mock_urlopen(200, {
        "response": json.dumps({"action": "click", "selector": "#add-to-cart-btn", "reasoning": "Ollama choice"})
    })
    with patch("urllib.request.urlopen", return_value=mock_ollama_resp):
        res_ollama = plan_with_model("click add to cart", sample_controls, sample_labels, endpoint="http://localhost:11434")
        check("Ollama mock response parses and validates successfully", res_ollama is not None and res_ollama[0]["selector"] == "#add-to-cart-btn" and res_ollama[1] == "llm")

    # 6.3 Mock OpenAI / Gemini Chat Completions Format
    mock_openai_resp = make_mock_urlopen(200, {
        "choices": [{
            "message": {
                "content": json.dumps({"action": "type", "selector": "#search-box", "value": "laptop", "reasoning": "Search goal"})
            }
        }]
    })
    with patch("urllib.request.urlopen", return_value=mock_openai_resp):
        res_openai = plan_with_model("search for laptop", sample_controls, sample_labels, endpoint="https://api.openai.com/v1")
        check("Chat completions mock response parses and validates successfully", res_openai is not None and res_openai[0]["selector"] == "#search-box" and res_openai[1] == "llm")

    # 6.4 Markdown Code Fence Stripping
    mock_fenced_resp = make_mock_urlopen(200, {
        "response": "```json\n{\"action\": \"click\", \"selector\": \"#add-to-cart-btn\", \"reasoning\": \"Fenced\"}\n```"
    })
    with patch("urllib.request.urlopen", return_value=mock_fenced_resp):
        res_fenced = plan_with_model("click add to cart", sample_controls, sample_labels, endpoint="http://localhost:11434")
        check("Markdown-fenced JSON is stripped and parsed", res_fenced is not None and res_fenced[0]["selector"] == "#add-to-cart-btn")

    # 6.5 Network Error / Timeout Fallback Handling
    with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("Connection refused")):
        res_err = plan_with_model("click add to cart", sample_controls, sample_labels, endpoint="http://localhost:11434")
        check("Network error safely returns None without throwing", res_err is None)

    # 6.6 Non-JSON / Malformed Model Response Handling
    mock_malformed_resp = make_mock_urlopen(200, {
        "response": "Hello, I am an AI model. How can I help you today?"
    })
    with patch("urllib.request.urlopen", return_value=mock_malformed_resp):
        res_malformed = plan_with_model("click add to cart", sample_controls, sample_labels, endpoint="http://localhost:11434")
        check("Non-JSON model response safely returns None", res_malformed is None)


# ------------------------------------------------------------
# 7. PROVENANCE LABELING ON /agent ROUTE
# ------------------------------------------------------------
async def test_provenance_labeling():
    print("\n--- 7. Provenance Labeling Tests ---")
    test_request = AgentRequest(
        goal="click view statement",
        elements=[
            {"id": "el_1", "type": "button", "label": "View Statement", "selector": "#statementButton"}
        ]
    )

    mock_ollama_resp = make_mock_urlopen(200, {
        "response": json.dumps({"action": "click", "selector": "#add-to-cart-btn", "reasoning": "Ollama choice"})
    })

    # A) When model endpoint is unset -> "local-deterministic"
    with patch.dict(os.environ, {"PRIVAGENT_MODEL_ENDPOINT": "", "GEMINI_API_KEY": ""}):
        resp_unconf = await agent(test_request, x_privagent_token=PRIVAGENT_AUTH_TOKEN)
        check("Endpoint without model configured reports local-deterministic", resp_unconf.planner == "local-deterministic")

    # B) When model endpoint is set but model fails -> "deterministic-fallback"
    with patch.dict(os.environ, {"PRIVAGENT_MODEL_ENDPOINT": "http://127.0.0.1:11434", "GEMINI_API_KEY": ""}), \
         patch("urllib.request.urlopen", side_effect=urllib.error.URLError("Connection refused")):
        resp_fallback = await agent(test_request, x_privagent_token=PRIVAGENT_AUTH_TOKEN)
        check("Endpoint when model fails reports deterministic-fallback", resp_fallback.planner == "deterministic-fallback")
        check("Message explicitly notes fallback", "deterministic-fallback" in resp_fallback.message)

    # C) When model endpoint is set and succeeds -> "llm"
    with patch.dict(os.environ, {"PRIVAGENT_MODEL_ENDPOINT": "http://127.0.0.1:11434", "GEMINI_API_KEY": ""}), \
         patch("urllib.request.urlopen", return_value=mock_ollama_resp):
        cart_request = AgentRequest(
            command="click add to cart",
            sanitizedContext={
                "elements": [{"type": "button", "label": "Add to Cart", "selector": "#add-to-cart-btn", "enabled": True}]
            }
        )
        resp_llm = await agent(cart_request, x_privagent_token=PRIVAGENT_AUTH_TOKEN)
        check("Endpoint when model succeeds reports llm planner", resp_llm.planner == "llm")
        check("Message explicitly notes llm reasoning", "(llm)" in resp_llm.message)


# ------------------------------------------------------------
# 8. OBSERVABLE COMPLETION & VERIFIED OUTCOME TESTS
# ------------------------------------------------------------
async def test_observable_completion():
    print("\n--- 8. Observable Completion & Verified Outcome Tests ---")

    # 8.1 Initial State: Statement button is unclicked
    req_initial = AgentRequest(
        goal="click view statement",
        elements=[
            {"id": "el_stmt", "type": "button", "label": "View Statement", "selector": "#statementButton"}
        ]
    )
    resp_init = await agent(req_initial, x_privagent_token=PRIVAGENT_AUTH_TOKEN)
    check("Initial unclicked statement targets #statementButton with click", resp_init.action.action == "click" and resp_init.action.selector == "#statementButton")

    # 8.2 Observable Completion: Button label updated to 'Statement Loaded'
    req_loaded = AgentRequest(
        goal="click view statement",
        step=2,
        history=[{"action": "click", "selector": "#statementButton"}],
        elements=[
            {"id": "el_stmt", "type": "button", "label": "Statement Loaded", "selector": "#statementButton"}
        ]
    )
    resp_loaded = await agent(req_loaded, x_privagent_token=PRIVAGENT_AUTH_TOKEN)
    check("Observable completion on 'Statement Loaded' returns noop", resp_loaded.action.action == "noop")

    # 8.3 Observable Completion: Safe label indicates statement loaded
    req_safe_label_loaded = AgentRequest(
        goal="click view statement",
        step=2,
        history=[{"action": "click", "selector": "#statementButton"}],
        visible_controls=[
            VisibleControl(type="button", label="Hide Statement", selector="#statementButton")
        ],
        safe_labels=[
            SafeLabel(text="Account Statement loaded successfully", role="heading")
        ]
    )
    resp_safe_lbl = await agent(req_safe_label_loaded, x_privagent_token=PRIVAGENT_AUTH_TOKEN)
    check("Observable completion on safe label text returns noop", resp_safe_lbl.action.action == "noop")

    # 8.4 Completed Single-Action Click in History
    req_history_verified = AgentRequest(
        goal="click view statement",
        step=2,
        history=[{"action": "click", "selector": "#statementButton"}],
        visible_controls=[
            VisibleControl(type="button", label="Statement Loaded", selector="#statementButton")
        ]
    )
    resp_hist = await agent(req_history_verified, x_privagent_token=PRIVAGENT_AUTH_TOKEN)
    check("Completed single click with verified state returns noop", resp_hist.action.action == "noop")

    # 8.5 Unchanged State without Verified Outcome Does NOT Fake Noop
    req_unchanged = AgentRequest(
        goal="click view statement",
        elements=[
            {"id": "el_stmt", "type": "button", "label": "View Statement", "selector": "#statementButton"}
        ]
    )
    resp_unchanged = await agent(req_unchanged, x_privagent_token=PRIVAGENT_AUTH_TOKEN)
    check("Unchanged unverified state does not fake noop (targets click)", resp_unchanged.action.action == "click")


# ------------------------------------------------------------
# 9. GOOGLE GEMINI NATIVE REST & SECURITY TESTS
# ------------------------------------------------------------
async def test_gemini_integration():
    print("\n--- 9. Google Gemini Native REST & Security Tests ---")
    sample_controls_gemini = [
        {"type": "button", "label": "View Statement", "selector": "#statementButton", "enabled": True}
    ]
    sample_labels_gemini = [{"text": "Banking Portal", "role": "page_title", "selector": None}]

    # 9.1 Native Gemini REST Response Parsing
    mock_gemini_raw = {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {
                            "text": json.dumps({
                                "action": "click",
                                "selector": "#statementButton",
                                "reasoning": "Gemini selected View Statement"
                            })
                        }
                    ]
                }
            }
        ]
    }
    mock_gemini_resp = make_mock_urlopen(200, mock_gemini_raw)

    captured_requests = []
    def intercepting_urlopen(req, timeout=None):
        captured_requests.append(req)
        return mock_gemini_resp

    with patch.dict(os.environ, {"GEMINI_API_KEY": "AIzaSyFakeTestKeyForTestingOnly", "PRIVAGENT_MODEL_ENDPOINT": ""}), \
         patch("urllib.request.urlopen", side_effect=intercepting_urlopen):
        res_gemini = plan_with_model("click view statement", sample_controls_gemini, sample_labels_gemini)
        check("Gemini native response parses action correctly", res_gemini is not None and res_gemini[0]["selector"] == "#statementButton")
        check("Gemini provenance is accurately tagged as 'gemini'", res_gemini is not None and res_gemini[1] == "gemini")
        check("Gemini request uses x-goog-api-key header", len(captured_requests) > 0 and captured_requests[0].headers.get("X-goog-api-key") == "AIzaSyFakeTestKeyForTestingOnly")
        check("Gemini API key is NEVER exposed in request URL", "key=" not in captured_requests[0].full_url)
        check("Gemini endpoint defaults to generativelanguage.googleapis.com", "generativelanguage.googleapis.com" in captured_requests[0].full_url)
        check("Gemini endpoint defaults to gemini-3.8-flash model", "gemini-3.8-flash" in captured_requests[0].full_url)

    # 9.2 Ungrounded Selector Hallucination Rejected (Returns None)
    mock_hallucinated = make_mock_urlopen(200, {
        "candidates": [{"content": {"parts": [{"text": json.dumps({"action": "click", "selector": "#hallucinated-selector"})}]}}]
    })
    with patch.dict(os.environ, {"GEMINI_API_KEY": "AIzaSyFakeTestKeyForTestingOnly", "PRIVAGENT_MODEL_ENDPOINT": ""}), \
         patch("urllib.request.urlopen", return_value=mock_hallucinated):
        res_hallu = plan_with_model("click view statement", sample_controls_gemini, sample_labels_gemini)
        check("Gemini hallucinated selector is rejected safely (returns None)", res_hallu is None)

    # 9.3 Sensitive Data in Goal Blocks Gemini Transmission (Fail-Closed)
    with patch.dict(os.environ, {"GEMINI_API_KEY": "AIzaSyFakeTestKeyForTestingOnly", "PRIVAGENT_MODEL_ENDPOINT": ""}), \
         patch("urllib.request.urlopen") as mock_never_called:
        res_leak = plan_with_model("enter your secret password", sample_controls_gemini, sample_labels_gemini)
        check("Sensitive goal aborts before Gemini request (fail-closed)", res_leak is None)
        check("No network request was transmitted for sensitive goal", mock_never_called.call_count == 0)

    # 9.4 Network / HTTP 403 / 500 Error Falls Back Gracefully
    http_err = urllib.error.HTTPError(
        url="https://generativelanguage.googleapis.com",
        code=403,
        msg="Forbidden",
        hdrs={},
        fp=None
    )
    with patch.dict(os.environ, {"GEMINI_API_KEY": "AIzaSyFakeTestKeyForTestingOnly", "PRIVAGENT_MODEL_ENDPOINT": ""}), \
         patch("urllib.request.urlopen", side_effect=http_err):
        res_err = plan_with_model("click view statement", sample_controls_gemini, sample_labels_gemini)
        check("HTTP 403 error returns None without unhandled exception", res_err is None)

    # 9.5 End-to-End Server /agent Route with Gemini Key & Mocked Success
    test_req = AgentRequest(
        goal="click view statement",
        elements=[
            {"id": "el_1", "type": "button", "label": "View Statement", "selector": "#statementButton"}
        ]
    )
    with patch.dict(os.environ, {"GEMINI_API_KEY": "AIzaSyFakeTestKeyForTestingOnly", "PRIVAGENT_MODEL_ENDPOINT": ""}), \
         patch("urllib.request.urlopen", return_value=mock_gemini_resp):
        resp_agent_gemini = await agent(test_req, x_privagent_token=PRIVAGENT_AUTH_TOKEN)
        check("Server /agent endpoint reports provenance 'gemini'", resp_agent_gemini.planner == "gemini")
        check("Server response message notes gemini reasoning", "(gemini)" in resp_agent_gemini.message)
        check("Server returns grounded action targeting #statementButton", resp_agent_gemini.action.selector == "#statementButton")

    # 9.6 End-to-End Server /agent Route with Gemini Key & Fallback on Network Error
    with patch.dict(os.environ, {"GEMINI_API_KEY": "AIzaSyFakeTestKeyForTestingOnly", "PRIVAGENT_MODEL_ENDPOINT": ""}), \
         patch("urllib.request.urlopen", side_effect=urllib.error.URLError("Connection reset")):
        resp_fallback_gemini = await agent(test_req, x_privagent_token=PRIVAGENT_AUTH_TOKEN)
        check("Server /agent falls back to deterministic-fallback when Gemini fails", resp_fallback_gemini.planner == "deterministic-fallback")
        check("Fallback still provides grounded action", resp_fallback_gemini.action.selector == "#statementButton")


# ------------------------------------------------------------
# MAIN EXECUTION (Direct Python Invocation)
# ------------------------------------------------------------
if __name__ == "__main__":
    print("\n============================================================")
    print(" PRIVAGENT SERVER PRIVACY & SECURITY TEST SUITE")
    print("============================================================\n")

    test_sensitive_keyword_detection()
    test_server_context_fail_closed_validation()
    test_action_schema_validation()
    asyncio.run(test_endpoint_security())
    test_ai_model_grounding_and_safety()
    test_mocked_model_providers()
    asyncio.run(test_provenance_labeling())
    asyncio.run(test_observable_completion())
    asyncio.run(test_gemini_integration())

    print("\n============================================================")
    print(f" RESULTS: {passed} passed, {failed} failed")
    print("============================================================\n")

    if failed > 0:
        sys.exit(1)
