"""
PrivAgent - Google Gemini Connectivity Smoke Test

Safely verifies live model reasoning with Google Gemini API without:
- Exposing or printing API keys
- Sending sensitive data, PII, passwords, OTPs, or screenshots
- Triggering browser side-effects or consequential actions

Usage:
    python server/smoke_test_gemini.py
"""

import json
import os
import sys

# Ensure local server directory is in sys.path
sys.path.insert(0, os.path.dirname(__file__))

from llm_planner import load_env_file, plan_with_model

def mask_key(k: str) -> str:
    if not k:
        return "<unset>"
    if len(k) <= 8:
        return "***"
    return f"{k[:4]}...{k[-4:]}"

def main():
    print("\n============================================================")
    print(" PRIVAGENT GEMINI AI CONNECTIVITY SMOKE TEST")
    print("============================================================\n")

    load_env_file()

    gemini_key = os.getenv("GEMINI_API_KEY") or os.getenv("PRIVAGENT_API_KEY", "")
    model_name = os.getenv("PRIVAGENT_MODEL_NAME", "gemini-3.8-flash")

    if not gemini_key:
        print("[-] GEMINI_API_KEY is not configured.")
        print("\nTo test live Gemini reasoning:")
        print("  1. Copy .env.example to .env (in the project root)")
        print("  2. Add your key from Google AI Studio (https://aistudio.google.com/):")
        print("     GEMINI_API_KEY=YOUR_GEMINI_API_KEY_HERE")
        print("  3. Re-run this smoke test: python server/smoke_test_gemini.py")
        print("\nPrivAgent continues to run safely with offline local-deterministic planning.\n")
        sys.exit(0)

    print(f"[*] Detected Gemini Key: {mask_key(gemini_key)}")
    print(f"[*] Configured Model:   {model_name}")
    print("[*] Privacy Boundary:   Sanitized Synthetic Context Only (Zero PII, Zero DOM)")
    print("[*] Initiating harmless test query...")

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
        timeout=10.0
    )

    if not result:
        print("\n[!] Gemini connectivity check did NOT return a valid grounded action.")
        print("    Possible causes:")
        print("    - Invalid API key or quota limit exceeded")
        print("    - Network connectivity issue reaching generativelanguage.googleapis.com")
        print("    PrivAgent will safely use local-deterministic fallback.\n")
        sys.exit(0)

    action, provenance = result
    print("\n[+] SUCCESS! Live reasoning connected.")
    print(f"    - Provenance: {provenance}")
    print(f"    - Action Selected: {action.get('action')}")
    print(f"    - Target Selector: {action.get('selector')}")
    if action.get("reasoning"):
        print(f"    - Model Reasoning: {action.get('reasoning')}")

    if action.get("selector") == "#statementButton":
        print("\n[✓] Grounding verified: Model accurately selected the intended target.")
    else:
        print(f"\n[!] Selected selector: {action.get('selector')} (grounded in controls)")

    print("============================================================\n")

if __name__ == "__main__":
    main()
