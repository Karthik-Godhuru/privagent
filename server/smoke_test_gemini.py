"""
PrivAgent - Google Gemini Connectivity Smoke Test

Safely verifies model reasoning pipeline and grounding without:
- Exposing or printing any characters of API keys
- Sending sensitive data, PII, passwords, OTPs, or screenshots
- Triggering browser side-effects or unintended paid API calls

Usage:
    # 1. Safe offline dry-run test (verifies grounding, privacy gating, and schema validation):
    python server/smoke_test_gemini.py

    # 2. Explicit read-only metadata diagnostic (uses GEMINI_API_KEY from .env):
    python server/smoke_test_gemini.py --metadata

    # 3. Live API reasoning test (only when explicitly requested):
    python server/smoke_test_gemini.py --live
"""

import json
import os
import sys
import urllib.error
import urllib.request

# Ensure local server directory is in sys.path
sys.path.insert(0, os.path.dirname(__file__))

from llm_planner import (
    build_planner_prompt,
    load_env_file,
    parse_model_response,
    plan_with_model,
    prompt_contains_sensitive_data,
    validate_model_name,
)


def run_offline_validation() -> bool:
    """
    Completely offline verification of privacy gating, prompt formatting,
    and hallucination defense without making any external network requests.
    """
    print("\n--- Running Safe Offline Pipeline Validation ---")

    # 1. Privacy gate check
    assert prompt_contains_sensitive_data("my password is secret"), "Fail-closed check failed"
    assert prompt_contains_sensitive_data("my OTP is 123456"), "OTP check failed"
    assert not prompt_contains_sensitive_data("shopping for headphones"), "False positive on 'shopping'"
    assert not prompt_contains_sensitive_data("view bank statement"), "Safe goal flagged incorrectly"
    print("[PASS] Privacy Gate: Fail-closed sensitivity detection verified.")

    # 2. Prompt construction check
    sample_controls = [
        {"type": "button", "label": "View Statement", "selector": "#statementButton", "enabled": True},
        {"type": "button", "label": "Disabled Button", "selector": "#disabledBtn", "enabled": False},
    ]
    sample_labels = [{"text": "Secure Banking Portal", "role": "page_title"}]
    prompt = build_planner_prompt("view statement", sample_controls, sample_labels)
    assert "#statementButton" in prompt, "Prompt missing valid control selector"
    assert "#disabledBtn" not in prompt, "Disabled control was incorrectly included"
    print("[PASS] Prompt Construction: Only safe, enabled controls included.")

    # 3. Grounding & Hallucination rejection check
    allowed = {"#statementButton"}
    grounded_json = '{"action": "click", "selector": "#statementButton"}'
    parsed_grounded = parse_model_response(grounded_json, allowed)
    assert parsed_grounded is not None and parsed_grounded["selector"] == "#statementButton", "Grounded selector failed"

    hallucinated_json = '{"action": "click", "selector": "#hallucinatedButton"}'
    parsed_hallucinated = parse_model_response(hallucinated_json, allowed)
    assert parsed_hallucinated is None, "Failed to reject hallucinated selector"
    print("[PASS] Grounding Engine: Grounded selectors accepted, hallucinations rejected.")

    # 4. Contextual harmless links & sensitive inputs privacy verification
    try:
        from main import validate_context, local_planner, SanitizedContext, VisibleControl, ActionCandidate
    except ImportError:
        from server.main import validate_context, local_planner, SanitizedContext, VisibleControl, ActionCandidate
    from fastapi import HTTPException

    # Contextual navigation link (e.g. W3Schools demo page)
    ctx_w3c = SanitizedContext(
        goal="click Toggle Hide and Show button",
        visible_controls=[
            VisibleControl(type="a", label="Password Validation - Trigger Button on Enter", selector="#link1", enabled=True),
            VisibleControl(type="a", label="Toggle Password Visibility - Password Validation", selector="#link2", enabled=True),
            VisibleControl(type="button", label="Toggle Hide and Show button", selector="#btnToggle", enabled=True)
        ],
        safe_labels=[],
        redacted_regions=[],
        action_candidates=[]
    )
    validate_context(ctx_w3c)

    # Sensitive inputs must be rejected
    ctx_bad_input = SanitizedContext(
        goal="click submit",
        visible_controls=[VisibleControl(type="input", label="Password", selector="#pass", enabled=True)],
        safe_labels=[],
        redacted_regions=[],
        action_candidates=[]
    )
    rejected_input = False
    try:
        validate_context(ctx_bad_input)
    except HTTPException as err:
        if err.status_code == 400:
            rejected_input = True
    assert rejected_input, "Sensitive input was not rejected"

    # Actual sensitive value must be rejected
    ctx_bad_card = SanitizedContext(
        goal="click pay",
        visible_controls=[VisibleControl(type="button", label="Pay with 4111 2222 3333 4444", selector="#pay", enabled=True)],
        safe_labels=[],
        redacted_regions=[],
        action_candidates=[]
    )
    rejected_card = False
    try:
        validate_context(ctx_bad_card)
    except HTTPException as err:
        if err.status_code == 400:
            rejected_card = True
    assert rejected_card, "Actual card value was not rejected"

    print("[PASS] Context Privacy: Contextual links accepted; sensitive inputs & card values strictly rejected.")

    # 5. Local planner target resolution & ambiguity defense
    # Prioritizes button over navigation links with duplicate/similar text
    ctx_w3c_disambig = SanitizedContext(
        goal="click Toggle Hide and Show button",
        visible_controls=[
            VisibleControl(type="a", label="Password Validation - Trigger Button on Enter", selector="#link1", enabled=True),
            VisibleControl(type="a", label="Toggle Password Visibility - Password Validation", selector="#link2", enabled=True),
            VisibleControl(type="a", label="Toggle Hide and Show", selector="#linkNav", enabled=True),
            VisibleControl(type="button", label="Toggle Hide and Show", selector="#btnToggle", enabled=True)
        ],
        safe_labels=[],
        redacted_regions=[],
        action_candidates=[]
    )
    action_disambig = local_planner(ctx_w3c_disambig)
    assert action_disambig.action == "click" and action_disambig.selector == "#btnToggle", (
        f"Expected #btnToggle, got {action_disambig}"
    )

    # When multiple buttons tie equally, preserves safe ambiguity response
    ctx_w3c_ambig = SanitizedContext(
        goal="click Toggle Hide and Show button",
        visible_controls=[
            VisibleControl(type="button", label="Toggle Hide and Show", selector="#btnToggle1", enabled=True),
            VisibleControl(type="button", label="Toggle Hide and Show", selector="#btnToggle2", enabled=True),
            VisibleControl(type="a", label="Toggle Hide and Show", selector="#linkNav", enabled=True)
        ],
        safe_labels=[],
        redacted_regions=[],
        action_candidates=[]
    )
    action_ambig = local_planner(ctx_w3c_ambig)
    assert action_ambig.action == "noop", f"Expected noop for ambiguous duplicate buttons, got {action_ambig}"
    print("[PASS] Target Resolution: Unambiguous button selected; duplicate-target ambiguity safely refused.")

    # 6. View History link disambiguation & candidate handoff check
    ctx_view_history = SanitizedContext(
        goal="click view history",
        visible_controls=[
            VisibleControl(type="a", role="link", label="View source", selector="#viewSource", enabled=True, visible=True),
            VisibleControl(type="a", role="link", label="View", selector="#viewLink", enabled=True, visible=True),
            VisibleControl(type="a", role="link", label="View history", selector="#caHistory", enabled=True, visible=True),
        ],
        safe_labels=[],
        redacted_regions=[],
        action_candidates=[]
    )
    action_view_hist = local_planner(ctx_view_history)
    assert action_view_hist.action == "click" and action_view_hist.selector == "#caHistory", (
        f"Expected #caHistory, got {action_view_hist}"
    )

    # Candidate handoff to server backend: candidate is adopted and validated
    ctx_with_candidate = SanitizedContext(
        goal="click view history",
        visible_controls=[
            VisibleControl(type="a", role="link", label="View history", selector="#caHistory", enabled=True, visible=True)
        ],
        safe_labels=[],
        redacted_regions=[],
        action_candidates=[
            ActionCandidate(action="click", selector="#caHistory")
        ]
    )
    action_candidate_handoff = local_planner(ctx_with_candidate)
    assert action_candidate_handoff.action == "click" and action_candidate_handoff.selector == "#caHistory"
    print("[PASS] View History Resolution: 'View history' accurately resolved over unrelated 'view' links and candidate handed off.")

    # 6. Regression tests for Random article, typing, and search intent
    # 6a. Random article: resolves unique target and ignores unrelated 'article' links
    ctx_random = SanitizedContext(
        goal="click random article",
        visible_controls=[
            VisibleControl(type="a", role="link", label="Nominate an article", selector="#nominate", enabled=True, visible=True),
            VisibleControl(type="a", role="link", label="Start a new article", selector="#start", enabled=True, visible=True),
            VisibleControl(type="a", role="link", label="Random article", selector="#random", enabled=True, visible=True)
        ],
        safe_labels=[],
        redacted_regions=[],
        action_candidates=[]
    )
    action_random = local_planner(ctx_random)
    assert action_random.action == "click" and action_random.selector == "#random", f"Expected #random, got {action_random}"

    # 6b. Random article: duplicate target safe ambiguity refusal
    ctx_random_ambig = SanitizedContext(
        goal="click random article",
        visible_controls=[
            VisibleControl(type="a", role="link", label="Random article", selector="#random1", enabled=True, visible=True),
            VisibleControl(type="a", role="link", label="Random article", selector="#random2", enabled=True, visible=True)
        ],
        safe_labels=[],
        redacted_regions=[],
        action_candidates=[]
    )
    action_random_ambig = local_planner(ctx_random_ambig)
    assert action_random_ambig.action == "noop", f"Expected noop for duplicate random article, got {action_random_ambig}"

    # 6c. Random article: missing target does not select unrelated article link
    ctx_random_missing = SanitizedContext(
        goal="click random article",
        visible_controls=[
            VisibleControl(type="a", role="link", label="Nominate an article", selector="#nominate", enabled=True, visible=True),
            VisibleControl(type="a", role="link", label="Start a new article", selector="#start", enabled=True, visible=True)
        ],
        safe_labels=[],
        redacted_regions=[],
        action_candidates=[]
    )
    action_random_missing = local_planner(ctx_random_missing)
    assert action_random_missing.action == "noop", f"Expected noop for missing random article, got {action_random_missing}"

    # 6d. Typing intent: "type cats into the Search Wikipedia field"
    ctx_type = SanitizedContext(
        goal="type cats into the Search Wikipedia field",
        visible_controls=[
            VisibleControl(type="search", role="searchbox", label="Search Wikipedia", selector="#searchInput", enabled=True, visible=True),
            VisibleControl(type="button", role="button", label="Search", selector="#searchBtn", enabled=True, visible=True)
        ],
        safe_labels=[],
        redacted_regions=[],
        action_candidates=[]
    )
    action_type = local_planner(ctx_type)
    assert action_type.action == "type" and action_type.selector == "#searchInput" and action_type.value == "cats", (
        f"Expected type 'cats' into #searchInput, got {action_type}"
    )

    # 6e. Search intent: "search wikipedia for cats"
    ctx_search = SanitizedContext(
        goal="search wikipedia for cats",
        visible_controls=[
            VisibleControl(type="search", role="searchbox", label="Search Wikipedia", selector="#searchInput", enabled=True, visible=True),
            VisibleControl(type="button", role="button", label="Search", selector="#searchBtn", enabled=True, visible=True)
        ],
        safe_labels=[],
        redacted_regions=[],
        action_candidates=[]
    )
    action_search = local_planner(ctx_search)
    assert action_search.action == "type" and action_search.selector == "#searchInput" and action_search.value == "cats" and action_search.submit is True, (
        f"Expected type 'cats' with submit=True into #searchInput, got {action_search}"
    )

    # 6f. Candidate handoff for typing and search actions
    ctx_cand_type = SanitizedContext(
        goal="search wikipedia for cats",
        visible_controls=[
            VisibleControl(type="search", role="searchbox", label="Search Wikipedia", selector="#searchInput", enabled=True, visible=True)
        ],
        safe_labels=[],
        redacted_regions=[],
        action_candidates=[
            ActionCandidate(action="type", selector="#searchInput", value="cats", submit=True)
        ]
    )
    action_cand_type = local_planner(ctx_cand_type)
    assert action_cand_type.action == "type" and action_cand_type.selector == "#searchInput" and action_cand_type.value == "cats" and action_cand_type.submit is True, (
        f"Expected candidate handoff type action with submit=True, got {action_cand_type}"
    )

    print("[PASS] Random Article, Typing, and Search Intent: Resolved accurately and candidate handoff verified.")

    return True


def run_metadata_diagnostic(model_name: str, api_key: str) -> bool:
    """Make one explicit, read-only Gemini models.get request."""
    from urllib.parse import quote

    url = "https://generativelanguage.googleapis.com/v1beta/models/" + quote(model_name, safe="-")
    request = urllib.request.Request(
        url,
        headers={"x-goog-api-key": api_key, "User-Agent": "PrivAgent/1.1"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=10.0) as response:
            metadata = json.loads(response.read().decode("utf-8"))
        print("[PASS] Gemini model metadata request succeeded.")
        print(json.dumps(metadata, indent=2, sort_keys=True))
        return True
    except urllib.error.HTTPError as err:
        print(f"[FAIL] Gemini metadata request returned HTTP {err.code}.")
    except (urllib.error.URLError, TimeoutError, OSError):
        print("[FAIL] Gemini metadata request failed due to a network error or timeout.")
    except (UnicodeDecodeError, json.JSONDecodeError):
        print("[FAIL] Gemini metadata response was not valid JSON.")
    return False


def main():
    print("\n============================================================")
    print(" PRIVAGENT GEMINI AI INTEGRATION VERIFICATION")
    print("============================================================")

    load_env_file()

    gemini_key = os.getenv("GEMINI_API_KEY") or os.getenv("PRIVAGENT_API_KEY", "")
    raw_model = os.getenv("PRIVAGENT_MODEL_NAME", "")
    model_name = validate_model_name(raw_model)

    key_status = "[CONFIGURED (Protected)]" if gemini_key else "[NOT CONFIGURED]"
    print(f"[*] Gemini API Key Status:  {key_status}")
    print(f"[*] Validated Model Target: {model_name}")
    print("[*] Privacy Boundary:       Sanitized Synthetic Context Only (Zero PII, Zero DOM)")

    # Run offline pipeline tests
    run_offline_validation()

    if "--metadata" in sys.argv:
        if not gemini_key:
            print("[-] --metadata requested but GEMINI_API_KEY is not set in environment or .env.")
            return
        run_metadata_diagnostic(model_name, gemini_key)
        return

    is_live_requested = "--live" in sys.argv

    if not is_live_requested:
        print("\n[i] Offline pipeline check completed successfully.")
        if gemini_key:
            print("    To run the optional read-only model metadata diagnostic, execute:")
            print("    python server/smoke_test_gemini.py --metadata")
        else:
            print("    PrivAgent operates with local-deterministic fallback when GEMINI_API_KEY is not set.")
        print("============================================================\n")
        return

    # If --live was explicitly provided:
    if not gemini_key:
        print("\n[-] --live requested but GEMINI_API_KEY is not set in environment or .env.")
        print("    Please set GEMINI_API_KEY in your .env file to enable live reasoning.")
        print("============================================================\n")
        return

    print("\n[*] Initiating single harmless live reasoning query...")
    sample_controls = [
        {"type": "button", "label": "View Statement", "selector": "#statementButton", "enabled": True},
        {"type": "button", "label": "Account Summary", "selector": "#summaryButton", "enabled": True}
    ]
    sample_labels = [
        {"text": "Secure Banking Portal", "role": "page_title"}
    ]

    result = plan_with_model(
        goal="click view statement",
        visible_controls=sample_controls,
        safe_labels=sample_labels,
        api_key=gemini_key,
        model_name=model_name,
        timeout=30.0
    )

    if not result:
        print("\n[!] Gemini connectivity check did NOT return a valid grounded action.")
        print("    Possible causes:")
        print("    - Invalid API key or quota limit exceeded")
        print("    - Network connectivity issue reaching generativelanguage.googleapis.com")
        print("    PrivAgent will safely use local-deterministic fallback.")
    else:
        action, provenance = result
        print("\n[+] SUCCESS! Live reasoning connected.")
        print(f"    - Provenance: {provenance}")
        print(f"    - Action Selected: {action.get('action')}")
        print(f"    - Target Selector: {action.get('selector')}")
        if action.get("selector") == "#statementButton":
            print("[PASS] Grounding verified: Model accurately selected the intended target.")

    print("============================================================\n")


if __name__ == "__main__":
    main()
