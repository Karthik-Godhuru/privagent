# main.py

import logging
import os
import re
from typing import List, Literal, Optional, Dict, Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, ValidationError

logger = logging.getLogger("privagent.server")

try:
    from llm_planner import load_env_file
except ImportError:
    try:
        from server.llm_planner import load_env_file
    except ImportError:
        def load_env_file(): pass

load_env_file()


# ============================================================
# APP
# ============================================================

app = FastAPI(
    title="PrivAgent API",
    description="Privacy-Preserving Browser AI Agent Gateway",
    version="1.1.0",
)


# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# DATA MODELS
# ============================================================

class SafeLabel(BaseModel):
    text: str
    role: Optional[str] = None
    selector: Optional[str] = None


class RedactedRegion(BaseModel):
    x: float
    y: float
    width: float
    height: float
    reason: Optional[str] = None


class VisibleControl(BaseModel):
    type: str
    label: Optional[str] = None
    role: Optional[str] = None
    aria_label: Optional[str] = None
    selector: Optional[str] = None
    enabled: bool = True
    visible: bool = True


class ActionCandidate(BaseModel):
    action: Literal[
        "click",
        "type",
        "scroll",
        "navigate",
        "wait",
        "noop",
    ]

    selector: Optional[str] = None
    value: Optional[str] = None
    submit: Optional[bool] = False
    url: Optional[str] = None

    x: Optional[float] = None
    y: Optional[float] = None

    amount: Optional[int] = None


class SanitizedContext(BaseModel):
    """
    Internal normalized context used by PrivAgent.

    Only sanitized browser information should reach this model.
    """

    goal: str = Field(..., min_length=1)

    visible_controls: List[VisibleControl] = Field(
        default_factory=list
    )

    safe_labels: List[SafeLabel] = Field(
        default_factory=list
    )

    redacted_regions: List[RedactedRegion] = Field(
        default_factory=list
    )

    action_candidates: List[ActionCandidate] = Field(
        default_factory=list
    )


# ============================================================
# EXTENSION PAGE STATE
# ============================================================

class ExtensionElement(BaseModel):
    """
    Element format produced by extension/content.js.
    """

    id: Optional[str] = None
    type: str = ""
    role: Optional[str] = None
    label: str = ""
    ariaLabel: Optional[str] = None
    selector: Optional[str] = None
    enabled: bool = True
    visible: bool = True


class ExtensionPageState(BaseModel):
    """
    Sanitized page state produced by the Chrome extension.
    """

    title: str = ""
    url: str = ""
    text: str = ""

    elements: List[ExtensionElement] = Field(
        default_factory=list
    )


class AgentRequest(BaseModel):
    """
    Accepts the format sent by the Chrome extension.
    """

    goal: Optional[str] = None
    command: Optional[str] = None

    title: Optional[str] = None
    url: Optional[str] = None
    text: Optional[str] = None

    elements: Optional[List[ExtensionElement]] = None

    sanitizedContext: Optional[Dict[str, Any]] = None
    pageState: Optional[Dict[str, Any]] = None

    visible_controls: Optional[List[VisibleControl]] = None
    safe_labels: Optional[List[SafeLabel]] = None
    redacted_regions: Optional[List[RedactedRegion]] = None
    action_candidates: Optional[List[ActionCandidate]] = None


class Action(BaseModel):
    """
    Final structured action returned to the browser.
    """

    action: Literal[
        "click",
        "type",
        "scroll",
        "navigate",
        "wait",
        "noop",
    ]

    selector: Optional[str] = None
    value: Optional[str] = None
    submit: Optional[bool] = False
    url: Optional[str] = None

    x: Optional[float] = None
    y: Optional[float] = None

    amount: Optional[int] = None

    requires_confirmation: bool = False


class AgentResponse(BaseModel):
    success: bool
    message: str
    action: Action
    planner: Optional[str] = "local-deterministic"
    fallback_reason: Optional[str] = None


# ============================================================
# HEALTH CHECK
# ============================================================

@app.get("/")
async def root():
    return {
        "name": "PrivAgent",
        "status": "running",
        "version": "1.1.0",
        "privacy": "sanitized-context-only",
    }


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "privagent-gateway",
    }


# ============================================================
# PRIVACY VALIDATION
# ============================================================

SENSITIVE_KEYWORDS = [
    "password",
    "passwd",
    "secret",
    "token",
    "authorization",
    "credit_card",
    "credit card",
    "card_number",
    "card number",
    "cvv",
    "cvc",
    "otp",
    "pin",
    "aadhaar",
    "pan_number",
    "pan number",
    "account_number",
    "account number",
    "bank_account",
    "bank account",
]


def contains_sensitive_text(text: str) -> bool:
    """
    Basic server-side fail-closed privacy check.

    Redaction markers produced by the local privacy gate are safe
    and should not be treated as actual sensitive information.
    """

    if not text:
        return False

    sanitized_text = text

    redaction_markers = [
        "[EMAIL_REDACTED]",
        "[PHONE_REDACTED]",
        "[AADHAAR_REDACTED]",
        "[PAN_REDACTED]",
        "[CARD_REDACTED]",
    ]

    for marker in redaction_markers:
        sanitized_text = sanitized_text.replace(
            marker,
            ""
        )

    lower_text = sanitized_text.lower()

    for keyword in SENSITIVE_KEYWORDS:
        if len(keyword) <= 4:
            if re.search(r"(?:\b|_)" + re.escape(keyword) + r"(?:\b|_)", lower_text):
                return True
        else:
            if keyword in lower_text:
                return True

    return False


# PII and financial value patterns:
RE_CARD_NUMBER = re.compile(r"\b(?:\d[ -]*?){13,19}\b")
RE_AADHAAR = re.compile(r"\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b")
RE_PAN = re.compile(r"\b[A-Za-z]{5}\d{4}[A-Za-z]\b")
RE_PHONE = re.compile(r"\b(?:\+91[\s-]?)?[6-9]\d{9}\b")
RE_EMAIL = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
RE_EXPLICIT_SECRET = re.compile(r"\b(?:secret|token|password|passwd|cvv|cvc|pin)\s*[:=]\s*\S+", re.IGNORECASE)

# Harmless action labels & contextual navigation patterns:
HARMLESS_ACTION_PATTERNS = [
    re.compile(r"\b(?:show|hide|toggle|view)\s+(?:password|passwd)\b", re.IGNORECASE),
    re.compile(r"\b(?:forgot|reset|change|update)\s+(?:your\s+)?password\b", re.IGNORECASE),
    re.compile(r"\b(?:send|resend|request|get|generate|verify|submit|enter)\s+otp\b", re.IGNORECASE),
    re.compile(r"\b(?:login|sign\s*in|sign\s*up|continue|use)\s+with\s+(?:password|otp)\b", re.IGNORECASE),
    re.compile(r"\b(?:generate|create|view|copy|refresh|revoke)\s+(?:api\s+)?tokens?\b", re.IGNORECASE),
    re.compile(r"\bpassword\s+(?:validation|strength|visibility|requirements|rules|toggle|policy|meter)\b", re.IGNORECASE),
    re.compile(r"\b(?:toggle|trigger)\s+button\b", re.IGNORECASE),
    re.compile(r"^(?:show|hide)$", re.IGNORECASE),
    re.compile(r"\b(?:api\s+tokens?|csrf\s+token)\b", re.IGNORECASE),
]


def contains_actual_sensitive_values(text: str) -> bool:
    """
    Detects presence of actual credentials, full payment card numbers,
    Aadhaar, PAN, phone, email, or key-value secret assignments.
    """
    if not text:
        return False

    sanitized_text = text
    for marker in [
        "[EMAIL_REDACTED]",
        "[PHONE_REDACTED]",
        "[AADHAAR_REDACTED]",
        "[PAN_REDACTED]",
        "[CARD_REDACTED]",
    ]:
        sanitized_text = sanitized_text.replace(marker, "")

    if RE_CARD_NUMBER.search(sanitized_text):
        return True
    if RE_AADHAAR.search(sanitized_text):
        return True
    if RE_PAN.search(sanitized_text):
        return True
    if RE_PHONE.search(sanitized_text):
        return True
    if RE_EMAIL.search(sanitized_text):
        return True
    if RE_EXPLICIT_SECRET.search(sanitized_text):
        return True

    return False


def is_harmless_action_label(label: str) -> bool:
    """
    Checks if a label represents an ordinary harmless button or navigation
    action/documentation link (such as 'Show Password', 'Forgot Password?',
    'Password Validation - Trigger Button on Enter', or 'Toggle Password Visibility')
    rather than exposing credential values.
    """
    if not label or not isinstance(label, str):
        return False

    clean = label.strip()
    if contains_actual_sensitive_values(clean):
        return False

    return any(p.search(clean) for p in HARMLESS_ACTION_PATTERNS)


def is_harmless_action_goal(goal: str) -> bool:
    """
    Checks if a user goal refers to clicking or selecting a harmless action
    control (e.g. 'click Show Password', 'click Send OTP', 'click Toggle Hide and Show button',
    'click Toggle Password Visibility').
    """
    if not goal or not isinstance(goal, str):
        return False

    if contains_actual_sensitive_values(goal):
        return False

    clean_goal = re.sub(
        r"^(?:please\s+)?(?:click|press|select|tap|choose|open)\s+",
        "",
        goal.strip(),
        flags=re.IGNORECASE
    ).strip()

    if is_harmless_action_label(clean_goal):
        return True

    return not contains_sensitive_text(goal)


def is_sensitive_control(control: VisibleControl) -> bool:
    """
    Evaluates whether a browser control violates privacy boundaries.
    - Strictly rejects any control containing actual sensitive values (PII, cards, secrets).
    - Strictly rejects sensitive editable fields (inputs/textareas with password, cvv, otp, etc.).
    - Allows ordinary buttons or navigation links with harmless or contextual action labels.
    """
    if not control.label:
        return False

    # 1. Any actual sensitive values are strictly rejected across all controls
    if contains_actual_sensitive_values(control.label):
        return True

    ctrl_type = (control.type or "").lower().strip()

    # 2. Editable controls (input, textarea) must NEVER contain sensitive field descriptors
    if ctrl_type in {"input", "textarea"}:
        return contains_sensitive_text(control.label)

    # 3. Action controls (button, a, submit) are permitted if they represent harmless actions
    # or contextual navigation links without actual sensitive values.
    if ctrl_type in {"button", "a", "submit"}:
        if is_harmless_action_label(control.label):
            return False
        # Ordinary buttons/links do not capture user inputs; unless they contain actual
        # sensitive values (rejected above), they are safe navigation/action elements.
        return False

    # 4. For unknown or other control types:
    if is_harmless_action_label(control.label):
        return False
    return contains_sensitive_text(control.label)


def validate_context(context: SanitizedContext) -> None:
    """
    Reject suspicious sensitive information if it reaches
    the server.
    """

    if contains_actual_sensitive_values(context.goal):
        raise HTTPException(
            status_code=400,
            detail=(
                "Sensitive information detected in goal. "
                "Request rejected."
            ),
        )

    if contains_sensitive_text(context.goal):
        if not is_harmless_action_goal(context.goal):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Sensitive information detected in goal. "
                    "Request rejected."
                ),
            )

    for label in context.safe_labels:

        if contains_actual_sensitive_values(label.text) or (
            contains_sensitive_text(label.text) and not is_harmless_action_label(label.text)
        ):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Sensitive information detected "
                    "in sanitized labels."
                ),
            )

    for control in context.visible_controls:

        if is_sensitive_control(control):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Sensitive information detected "
                    "in browser controls."
                ),
            )


# ============================================================
# NORMALIZE EXTENSION REQUEST
# ============================================================

def normalize_request(
    request: AgentRequest
) -> SanitizedContext:

    """
    Converts Chrome extension page-state data into the
    server's internal SanitizedContext format.
    """

    # --------------------------------------------------------
    # 1. Find command / goal
    # --------------------------------------------------------

    goal = (
        request.goal
        or request.command
        or ""
    ).strip()


    # --------------------------------------------------------
    # 2. Find page state
    # --------------------------------------------------------

    source: Dict[str, Any] = {}

    if request.sanitizedContext:
        source = request.sanitizedContext

    elif request.pageState:
        source = request.pageState

    else:
        source = {
            "title": request.title or "",
            "url": request.url or "",
            "text": request.text or "",
            "elements": [
                element.model_dump()
                for element in (request.elements or [])
            ],
        }


    # --------------------------------------------------------
    # 3. If command is inside sanitizedContext
    # --------------------------------------------------------

    if not goal:
        goal = (
            source.get("goal")
            or source.get("command")
            or ""
        ).strip()


    if not goal:
        raise HTTPException(
            status_code=400,
            detail="No agent command was provided.",
        )


    # --------------------------------------------------------
    # 4. Already structured context
    # --------------------------------------------------------

    structured_controls = request.visible_controls

    if structured_controls is None:
        structured_controls = source.get(
            "visible_controls"
        )


    if structured_controls:

        visible_controls = [
            control
            if isinstance(control, VisibleControl)
            else VisibleControl(**control)
            for control in structured_controls
        ]

    else:

        # ----------------------------------------------------
        # 5. Convert extension elements -> visible_controls
        # ----------------------------------------------------

        raw_elements = source.get(
            "elements",
            []
        )

        visible_controls = []

        for raw in raw_elements:

            if isinstance(
                raw,
                ExtensionElement
            ):
                element = raw

            else:
                element = ExtensionElement(
                    id=raw.get("id"),
                    type=raw.get("type", ""),
                    role=raw.get("role"),
                    label=raw.get("label", ""),
                    ariaLabel=raw.get("ariaLabel"),
                    selector=raw.get("selector"),
                    enabled=raw.get(
                        "enabled",
                        True
                    ),
                    visible=raw.get(
                        "visible",
                        True
                    ),
                )

            visible_controls.append(
                VisibleControl(
                    type=element.type,
                    role=element.role,
                    label=element.label,
                    aria_label=element.ariaLabel,
                    selector=element.selector,
                    enabled=element.enabled,
                    visible=element.visible,
                )
            )


    # --------------------------------------------------------
    # 6. Safe labels
    # --------------------------------------------------------

    safe_labels = request.safe_labels

    if safe_labels is None:

        safe_labels = []

        for control in visible_controls:

            if control.label:

                safe_labels.append(
                    SafeLabel(
                        text=control.label,
                        role=control.type,
                        selector=control.selector,
                    )
                )


    # --------------------------------------------------------
    # 7. Redacted regions
    # --------------------------------------------------------

    redacted_regions = (
        request.redacted_regions
        or source.get(
            "redacted_regions",
            []
        )
        or []
    )


    # --------------------------------------------------------
    # 8. Action candidates
    # --------------------------------------------------------

    action_candidates = (
        request.action_candidates
        or source.get(
            "action_candidates",
            []
        )
        or []
    )


    return SanitizedContext(
        goal=goal,
        visible_controls=visible_controls,
        safe_labels=safe_labels,
        redacted_regions=redacted_regions,
        action_candidates=action_candidates,
    )


# ============================================================
# ACTION VALIDATION
# ============================================================

def validate_action(action: Action) -> Action:
    """
    Validate every action before returning it to Chrome.
    """

    if action.action == "click":

        if not action.selector and (
            action.x is None
            or action.y is None
        ):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Click requires selector "
                    "or coordinates."
                ),
            )


    elif action.action == "type":

        if not action.selector:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Type action requires "
                    "a selector."
                ),
            )

        if action.value is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Type action requires "
                    "a value."
                ),
            )


    elif action.action == "navigate":

        if not action.url:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Navigate action requires "
                    "a URL."
                ),
            )


    elif action.action == "scroll":

        if action.amount is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Scroll action requires "
                    "an amount."
                ),
            )


    return action


# ============================================================
# SIMPLE LOCAL PLANNER
# ============================================================

def local_planner(
    context: SanitizedContext
) -> Action:

    """
    Temporary rule-based planner.

    This allows the complete browser -> privacy -> server
    -> action pipeline to work before connecting an LLM/VLM.
    """

    # ========================================================
    # PREFER EXPLICITLY VALIDATED ACTION CANDIDATES
    # ========================================================

    if context.action_candidates:

        candidate = (
            context.action_candidates[0]
        )

        if candidate.action == "click":
            if not candidate.selector or not isinstance(candidate.selector, str):
                return Action(action="noop", requires_confirmation=False)

            matching_ctrl = next(
                (c for c in context.visible_controls if c.selector == candidate.selector),
                None
            )

            if (
                matching_ctrl is None
                or matching_ctrl.enabled is False
                or matching_ctrl.visible is False
                or getattr(matching_ctrl, "width", None) == 0
                or getattr(matching_ctrl, "height", None) == 0
            ):
                return Action(action="noop", requires_confirmation=False)

            return Action(
                action="click",
                selector=candidate.selector,
                requires_confirmation=False
            )

        elif candidate.action == "type":
            if not candidate.selector or not isinstance(candidate.selector, str):
                return Action(action="noop", requires_confirmation=False)

            matching_ctrl = next(
                (c for c in context.visible_controls if c.selector == candidate.selector),
                None
            )

            if (
                matching_ctrl is None
                or matching_ctrl.enabled is False
                or matching_ctrl.visible is False
                or getattr(matching_ctrl, "width", None) == 0
                or getattr(matching_ctrl, "height", None) == 0
            ):
                return Action(action="noop", requires_confirmation=False)

            return Action(
                action="type",
                selector=candidate.selector,
                value=candidate.value or "",
                submit=bool(candidate.submit),
                requires_confirmation=False,
            )

        candidate = (
            context.action_candidates[0]
        )

        return Action(
            action=candidate.action,
            selector=candidate.selector,
            value=candidate.value,
            url=candidate.url,
            x=candidate.x,
            y=candidate.y,
            amount=candidate.amount,
            requires_confirmation=(
                candidate.action
                == "navigate"
            ),
        )

    goal = context.goal.lower().strip()


    # ========================================================
    # CLICK / ADD / BUY
    # ========================================================

    if (
        "click" in goal
        or "press" in goal
        or "select" in goal
        or "open" in goal
        or "add" in goal
        or "buy" in goal
        or "tap" in goal
        or "check" in goal
    ):
        semantic_constraint = None
        if re.search(r"\b(?:button|btn)\b", goal, re.IGNORECASE):
            semantic_constraint = "button"
        elif re.search(r"\b(?:link|hyperlink)\b", goal, re.IGNORECASE):
            semantic_constraint = "link"
        elif re.search(r"\b(?:tab)\b", goal, re.IGNORECASE):
            semantic_constraint = "tab"
        elif re.search(r"\b(?:checkbox|check\s*box)\b", goal, re.IGNORECASE):
            semantic_constraint = "checkbox"
        elif re.search(r"\b(?:radio(?:\s*button)?)\b", goal, re.IGNORECASE):
            semantic_constraint = "radio"
        elif re.search(r"\b(?:menu\s*item|menuitem)\b", goal, re.IGNORECASE):
            semantic_constraint = "menuitem"
        elif re.search(r"\b(?:textbox|text\s*box|input|field)\b", goal, re.IGNORECASE):
            semantic_constraint = "textbox"

        clean_goal = re.sub(
            r"^(?:please\s+)?(?:click|press|tap|select|open|choose|check|uncheck|toggle|add|put|buy|order|purchase|get|pick)\s+(?:on\s+|the\s+)?",
            "",
            goal.strip(),
            flags=re.IGNORECASE,
        ).strip()
        clean_goal = re.sub(r"\s+(?:button|btn|link|checkbox|check\s*box|tab|menu\s*item|menuitem|radio(?:\s*button)?|textbox|text\s*box|input|field)$", "", clean_goal, flags=re.IGNORECASE).strip()
        exact_target_phrase = re.sub(r"[^a-zA-Z0-9\s]", " ", clean_goal).lower().strip()
        exact_target_phrase = " ".join(exact_target_phrase.split())

        command_words = {
            "click",
            "press",
            "select",
            "open",
            "view",
            "add",
            "buy",
            "to",
            "in",
            "into",
            "the",
            "button",
            "on",
            "cart",
            "bag",
            "please",
            "link",
            "tab",
            "checkbox",
        }

        target_words = [
            word
            for word in (
                goal
                .replace(",", " ")
                .replace(".", " ")
                .split()
            )
            if word not in command_words
        ]
        if not target_words:
            target_words = [
                word
                for word in clean_goal.split()
                if word not in {"the", "a", "an", "please"}
            ]

        target_phrase = " ".join(
            target_words
        )

        # ----------------------------------------------------
        # Multi-factor candidate scoring and disambiguation
        # ----------------------------------------------------

        matching_controls = []

        for control in context.visible_controls:

            if not control.selector:
                continue

            if control.enabled is False or control.visible is False:
                continue

            if getattr(control, "width", None) == 0 or getattr(control, "height", None) == 0:
                continue

            label = (control.label or "").lower().strip()
            aria_label = (control.aria_label or "").lower().strip()

            if not label and not aria_label:
                continue

            label_norm = " ".join(re.sub(r"[^a-zA-Z0-9\s]", " ", label).split())
            aria_label_norm = " ".join(re.sub(r"[^a-zA-Z0-9\s]", " ", aria_label).split())

            control_role = (control.role or control.type or "").lower().strip()
            is_button = (
                control_role == "button"
                or control.type in {"button", "submit"}
                or (not control.type and ("add" in label or "cart" in label))
            )
            is_link = control_role == "link" or control.type == "a"
            is_tab = control_role == "tab"
            is_checkbox = control_role == "checkbox"
            is_menuitem = control_role == "menuitem"
            is_textbox = (
                control_role == "textbox"
                or control.type in {"input", "textarea", "search"}
            ) and not is_button

            if semantic_constraint:
                if semantic_constraint == "button":
                    if is_textbox:
                        continue
                elif semantic_constraint == "link":
                    if is_button or is_textbox:
                        continue
                elif semantic_constraint == "textbox":
                    if is_button or is_link:
                        continue
                elif semantic_constraint == "checkbox" and not is_checkbox:
                    continue
                elif semantic_constraint == "tab" and not is_tab:
                    continue
                elif semantic_constraint == "menuitem" and not is_menuitem:
                    continue

            score = 0
            if exact_target_phrase and (label_norm == exact_target_phrase or aria_label_norm == exact_target_phrase):
                score += 50
            elif target_phrase and (label_norm == target_phrase or aria_label_norm == target_phrase):
                score += 45
            elif exact_target_phrase and (exact_target_phrase in label_norm or exact_target_phrase in aria_label_norm):
                score += 25
            elif target_phrase and (target_phrase in label_norm or target_phrase in aria_label_norm):
                score += 20
            else:
                word_matches = sum(1 for word in target_words if len(word) >= 2 and (word in label_norm or word in aria_label_norm))
                if len(target_words) >= 2 and word_matches < 2:
                    word_matches = 0
                if word_matches > 0:
                    score += word_matches * 3

            if score > 0:
                if control.visible is not False:
                    score += 10
                else:
                    score -= 40

                if control.enabled is not False:
                    score += 10
                else:
                    score -= 40

                if semantic_constraint:
                    if semantic_constraint == "button":
                        if is_button:
                            score += 30
                        elif is_textbox:
                            # A requested button must not resolve to a textbox or input
                            continue
                        elif is_link:
                            score -= 30
                        else:
                            score -= 20
                    elif semantic_constraint == "link":
                        if is_link:
                            score += 30
                        elif is_button:
                            # A requested link must not resolve to a button
                            continue
                        elif is_textbox:
                            continue
                        else:
                            score -= 20
                    elif semantic_constraint == "textbox":
                        if is_textbox:
                            score += 30
                        elif is_button or is_link:
                            continue
                        else:
                            score -= 20
                    elif semantic_constraint == "tab":
                        if is_tab:
                            score += 30
                        else:
                            score -= 20
                    elif semantic_constraint == "checkbox":
                        if is_checkbox:
                            score += 30
                        else:
                            score -= 20
                    elif semantic_constraint == "menuitem":
                        if is_menuitem:
                            score += 30
                        else:
                            score -= 20
                elif is_button:
                    score += 5

                matching_controls.append((control, score))

        if matching_controls:
            matching_controls.sort(key=lambda item: item[1], reverse=True)
            best_score = matching_controls[0][1]
            if best_score <= 0:
                return Action(action="noop", requires_confirmation=False)

            top_matches = [c for c, s in matching_controls if s == best_score]

            if len(top_matches) > 1:
                # Ambiguous: multiple matching controls share the top score.
                # Refuse to click arbitrarily to preserve safety.
                return Action(
                    action="noop",
                    requires_confirmation=False,
                )

            best_control = top_matches[0]
            return Action(
                action="click",
                selector=best_control.selector,
                requires_confirmation=False,
            )


    # ========================================================
    # TYPE / ENTER / FILL TEXT
    # ========================================================

    if (
        goal.startswith("type ")
        or goal.startswith("enter ")
        or goal.startswith("fill ")
    ):

        instruction = goal

        # Remove command word

        for prefix in [
            "type ",
            "enter ",
            "fill ",
        ]:

            if instruction.startswith(prefix):

                instruction = instruction[
                    len(prefix):
                ]

                break


        # ----------------------------------------------------
        # Supported forms:
        #
        # type hello into customer name
        # enter hello into customer name
        # fill hello in customer name
        # ----------------------------------------------------

        separator = None

        if " into " in instruction:

            separator = " into "

        elif " in " in instruction:

            separator = " in "


        if separator:

            value_text, target_text = (
                instruction.split(
                    separator,
                    1
                )
            )

            value_text = value_text.strip()
            target_text = target_text.strip()


            if value_text and target_text:

                # --------------------------------------------
                # Find matching input using SAFE LABEL ONLY.
                #
                # The server never needs the actual
                # current value of the input.
                # --------------------------------------------
                clean_target = re.sub(r"^(?:the|a|an)\s+", "", target_text, flags=re.IGNORECASE)
                clean_target = re.sub(r"\s+(?:field|input|box|textbox|text\s*box|searchbox|search\s*box)$", "", clean_target, flags=re.IGNORECASE).strip().lower()
                target_words = [w for w in re.sub(r"[^a-z0-9\s]", " ", clean_target).split() if w]

                scored_inputs = []
                for control in (
                    context.visible_controls
                ):
                    if control.enabled is False or control.visible is False:
                        continue

                    c_type = (control.type or "").lower()
                    c_role = (control.role or "").lower()
                    if c_type not in {"input", "textarea", "search"} and c_role not in {"textbox", "searchbox"}:
                        continue

                    label = (control.label or "").lower().strip()
                    aria = (getattr(control, "aria_label", "") or getattr(control, "ariaLabel", "") or "").lower().strip()
                    selector_str = (control.selector or "").lower()

                    score = 0
                    if clean_target and (clean_target == label or clean_target == aria):
                        score += 50
                    elif clean_target and (clean_target in label or clean_target in aria or label in clean_target):
                        score += 30
                    if target_words:
                        wm = sum(1 for w in target_words if w in label or w in aria)
                        score += wm * 5
                    if clean_target and clean_target in selector_str:
                        score += 10

                    if score > 0:
                        scored_inputs.append((control, score))

                if scored_inputs:
                    scored_inputs.sort(key=lambda item: item[1], reverse=True)
                    best_match, best_score = scored_inputs[0]
                    if best_score >= 20:
                        return Action(
                            action="type",
                            selector=best_match.selector,
                            value=value_text,
                            requires_confirmation=False,
                        )


    # ========================================================
    # SEARCH INTENT
    # ========================================================

    search_m = re.match(r"^(?:please\s+)?search(?:\s+[\w\.\-]+)?\s+for\s+(.+)$", goal, re.IGNORECASE)
    if search_m:
        query = search_m.group(1).strip()
        search_inputs = []
        for control in context.visible_controls:
            if control.enabled is False or control.visible is False:
                continue
            c_type = (control.type or "").lower()
            c_role = (control.role or "").lower()
            if c_type not in {"input", "textarea", "search"} and c_role not in {"textbox", "searchbox"}:
                continue

            label = (control.label or "").lower().strip()
            aria = (getattr(control, "aria_label", "") or getattr(control, "ariaLabel", "") or "").lower().strip()
            selector_str = (control.selector or "").lower()

            score = 0
            if c_type == "search" or c_role == "searchbox":
                score += 40
            if "search" in label or "search" in aria:
                score += 30
            if "search" in selector_str:
                score += 15

            if score > 0:
                search_inputs.append((control, score))

        if search_inputs:
            search_inputs.sort(key=lambda item: item[1], reverse=True)
            best_input = search_inputs[0][0]
            return Action(
                action="type",
                selector=best_input.selector,
                value=query,
                submit=True,
                requires_confirmation=False,
            )


    # ========================================================
    # NAVIGATION
    # ========================================================

    if (
        goal.startswith("go to ")
        or goal.startswith("navigate to ")
    ):

        url = goal

        url = url.replace(
            "navigate to ",
            "",
            1,
        )

        url = url.replace(
            "go to ",
            "",
            1,
        ).strip()


        if (
            url.startswith("http://")
            or url.startswith("https://")
        ):

            return Action(
                action="navigate",
                url=url,
                requires_confirmation=True,
            )


    # ========================================================
    # SCROLL DOWN
    # ========================================================

    if (
        "scroll down" in goal
        or "scroll lower" in goal
    ):

        return Action(
            action="scroll",
            amount=600,
            requires_confirmation=False,
        )


    # ========================================================
    # SCROLL UP
    # ========================================================

    if (
        "scroll up" in goal
        or "scroll higher" in goal
    ):

        return Action(
            action="scroll",
            amount=-600,
            requires_confirmation=False,
        )


    # ========================================================
    # ACTION CANDIDATE FALLBACK
    # ========================================================

    if context.action_candidates:

        candidate = (
            context.action_candidates[0]
        )

        if candidate.action == "click":
            if not candidate.selector or not isinstance(candidate.selector, str):
                return Action(action="noop", requires_confirmation=False)

            matching_ctrl = next(
                (c for c in context.visible_controls if c.selector == candidate.selector),
                None
            )

            if (
                matching_ctrl is None
                or matching_ctrl.enabled is False
                or matching_ctrl.visible is False
                or getattr(matching_ctrl, "width", None) == 0
                or getattr(matching_ctrl, "height", None) == 0
            ):
                return Action(action="noop", requires_confirmation=False)

            return Action(
                action="click",
                selector=candidate.selector,
                requires_confirmation=False
            )

        elif candidate.action == "type":
            if not candidate.selector or not isinstance(candidate.selector, str):
                return Action(action="noop", requires_confirmation=False)

            matching_ctrl = next(
                (c for c in context.visible_controls if c.selector == candidate.selector),
                None
            )

            if (
                matching_ctrl is None
                or matching_ctrl.enabled is False
                or matching_ctrl.visible is False
                or getattr(matching_ctrl, "width", None) == 0
                or getattr(matching_ctrl, "height", None) == 0
            ):
                return Action(action="noop", requires_confirmation=False)

            return Action(
                action="type",
                selector=candidate.selector,
                value=candidate.value or "",
                submit=bool(candidate.submit),
                requires_confirmation=False,
            )

        candidate = (
            context.action_candidates[0]
        )

        return Action(
            action=candidate.action,
            selector=candidate.selector,
            value=candidate.value,
            url=candidate.url,
            x=candidate.x,
            y=candidate.y,
            amount=candidate.amount,
            requires_confirmation=(
                candidate.action
                == "navigate"
            ),
        )


    # ========================================================
    # NOTHING SAFE TO DO
    # ========================================================

    return Action(
        action="noop",
        requires_confirmation=False,
    )


# ============================================================
# AGENT ENDPOINT
# ============================================================

@app.post(
    "/agent",
    response_model=AgentResponse,
)
async def agent(
    request: AgentRequest
):

    """
    Main PrivAgent pipeline:

        Chrome Extension
              ↓
        Local Privacy Gate
              ↓
        Sanitized Page State
              ↓
        /agent
              ↓
        Request Normalization
              ↓
        Privacy Validation
              ↓
        Planner
              ↓
        Action Validation
              ↓
        Browser Action
    """

    # --------------------------------------------------------
    # 1. Normalize extension request
    # --------------------------------------------------------

    context = normalize_request(
        request
    )


    # --------------------------------------------------------
    # 2. Privacy validation
    # --------------------------------------------------------

    validate_context(
        context
    )


    # --------------------------------------------------------
    # 3. Plan action (AI Model with Local Deterministic Fallback)
    # --------------------------------------------------------

    action = None
    planner_source = "local-deterministic"
    fallback_reason = None

    model_configured = bool(
        os.getenv("PRIVAGENT_MODEL_ENDPOINT")
        or os.getenv("GEMINI_API_KEY")
        or os.getenv("PRIVAGENT_API_KEY")
    )

    if model_configured:
        try:
            try:
                from llm_planner import plan_with_model
            except ImportError:
                from server.llm_planner import plan_with_model

            if contains_sensitive_text(context.goal):
                fallback_reason = "sensitive_goal_blocked"
            else:
                controls_dicts = [c.model_dump() for c in context.visible_controls]
                labels_dicts = [l.model_dump() for l in context.safe_labels]
                plan_result = plan_with_model(
                    context.goal,
                    controls_dicts,
                    labels_dicts,
                )
                if plan_result:
                    parsed_dict, source = plan_result
                    candidate_action = Action(**parsed_dict)
                    # Every Gemini-generated action must pass server-side action validator
                    action = validate_action(candidate_action)
                    planner_source = source
                else:
                    fallback_reason = "model_returned_no_grounded_action"
        except HTTPException:
            action = None
            fallback_reason = "action_validation_failed"
        except ValidationError:
            action = None
            fallback_reason = "schema_validation_failed"
        except Exception:
            action = None
            fallback_reason = "runtime_error"

    if action is None:
        if model_configured:
            logger.info(
                f"[PrivAgent Planner] Falling back to local planner (category: {fallback_reason or 'unspecified'})."
            )
        action = local_planner(
            context
        )
        planner_source = (
            "deterministic-fallback"
            if model_configured
            else "local-deterministic"
        )
        action = validate_action(
            action
        )


    # --------------------------------------------------------
    # 4. Return result
    # --------------------------------------------------------

    return AgentResponse(
        success=True,
        message=(
            f"PrivAgent processed the sanitized page successfully ({planner_source})."
        ),
        action=action,
        planner=planner_source,
        fallback_reason=fallback_reason,
    )


# ============================================================
# TEST ENDPOINT
# ============================================================

@app.post("/test")
async def test_agent():

    context = SanitizedContext(
        goal="click submit",

        visible_controls=[
            VisibleControl(
                type="button",
                label="Submit",
                selector="#submit",
                enabled=True,
            )
        ],

        safe_labels=[
            SafeLabel(
                text="Submit",
                role="button",
                selector="#submit",
            )
        ],

        redacted_regions=[],
        action_candidates=[],
    )


    validate_context(
        context
    )

    action = local_planner(
        context
    )

    action = validate_action(
        action
    )


    return {
        "success": True,
        "input": context.model_dump(),
        "output": action.model_dump(),
    }


# ============================================================
# RUN DIRECTLY
# ============================================================

if __name__ == "__main__":

    import uvicorn

    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8001,
        reload=True,
    )