# main.py

from typing import List, Literal, Optional, Dict, Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


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
    selector: Optional[str] = None
    enabled: bool = True


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
    label: str = ""
    selector: Optional[str] = None
    enabled: bool = True


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

    Supported formats:

    1. {
        "goal": "...",
        "title": "...",
        "url": "...",
        "text": "...",
        "elements": [...]
    }

    2. {
        "command": "...",
        "sanitizedContext": {
            "title": "...",
            "url": "...",
            "text": "...",
            "elements": [...]
        }
    }

    3. Direct structured sanitized context.
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
    url: Optional[str] = None

    x: Optional[float] = None
    y: Optional[float] = None

    amount: Optional[int] = None

    requires_confirmation: bool = False


class AgentResponse(BaseModel):
    success: bool
    message: str
    action: Action


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
    "card_number",
    "cvv",
    "otp",
    "aadhaar",
    "pan_number",
    "account_number",
    "bank_account",
]


def contains_sensitive_text(text: str) -> bool:
    """
    Basic server-side fail-closed privacy check.
    """

    if not text:
        return False

    lower_text = text.lower()

    for keyword in SENSITIVE_KEYWORDS:
        if keyword in lower_text:
            return True

    return False


def validate_context(context: SanitizedContext) -> None:
    """
    Reject suspicious sensitive information if it reaches
    the server.
    """

    if contains_sensitive_text(context.goal):
        raise HTTPException(
            status_code=400,
            detail="Sensitive information detected in goal. Request rejected.",
        )

    for label in context.safe_labels:

        if contains_sensitive_text(label.text):
            raise HTTPException(
                status_code=400,
                detail="Sensitive information detected in sanitized labels.",
            )

    for control in context.visible_controls:

        if control.label and contains_sensitive_text(control.label):
            raise HTTPException(
                status_code=400,
                detail="Sensitive information detected in browser controls.",
            )


# ============================================================
# NORMALIZE EXTENSION REQUEST
# ============================================================

def normalize_request(request: AgentRequest) -> SanitizedContext:
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
        structured_controls = source.get("visible_controls")


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

        raw_elements = source.get("elements", [])

        visible_controls = []

        for raw in raw_elements:

            if isinstance(raw, ExtensionElement):
                element = raw

            else:
                element = ExtensionElement(
                    id=raw.get("id"),
                    type=raw.get("type", ""),
                    label=raw.get("label", ""),
                    selector=raw.get("selector"),
                    enabled=raw.get("enabled", True),
                )

            visible_controls.append(
                VisibleControl(
                    type=element.type,
                    label=element.label,
                    selector=element.selector,
                    enabled=element.enabled,
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
        or source.get("redacted_regions", [])
        or []
    )


    # --------------------------------------------------------
    # 8. Action candidates
    # --------------------------------------------------------

    action_candidates = (
        request.action_candidates
        or source.get("action_candidates", [])
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
            action.x is None or action.y is None
        ):
            raise HTTPException(
                status_code=400,
                detail="Click requires selector or coordinates.",
            )


    elif action.action == "type":

        if not action.selector:
            raise HTTPException(
                status_code=400,
                detail="Type action requires a selector.",
            )

        if action.value is None:
            raise HTTPException(
                status_code=400,
                detail="Type action requires a value.",
            )


    elif action.action == "navigate":

        if not action.url:
            raise HTTPException(
                status_code=400,
                detail="Navigate action requires a URL.",
            )


    elif action.action == "scroll":

        if action.amount is None:
            raise HTTPException(
                status_code=400,
                detail="Scroll action requires an amount.",
            )


    return action


# ============================================================
# SIMPLE LOCAL PLANNER
# ============================================================

def local_planner(context: SanitizedContext) -> Action:
    """
    Temporary rule-based planner.

    This allows the complete browser -> privacy -> server
    -> action pipeline to work before connecting an LLM/VLM.
    """

    goal = context.goal.lower().strip()


    # ========================================================
    # CLICK
    # ========================================================

    if (
        "click" in goal
        or "press" in goal
        or "select" in goal
        or "open" in goal
    ):

        # Remove common command words.
        command_words = {
            "click",
            "press",
            "select",
            "open",
            "the",
            "button",
            "on",
            "please",
        }

        target_words = [
            word
            for word in goal
            .replace(",", " ")
            .replace(".", " ")
            .split()
            if word not in command_words
        ]


        # ----------------------------------------------------
        # Exact / partial label matching
        # ----------------------------------------------------

        for control in context.visible_controls:

            if not control.enabled:
                continue

            label = (control.label or "").lower().strip()

            if not label:
                continue


            # Full phrase match
            target_phrase = " ".join(target_words)

            if target_phrase and target_phrase in label:

                return Action(
                    action="click",
                    selector=control.selector,
                    requires_confirmation=False,
                )


            # Word match
            for word in target_words:

                if len(word) < 2:
                    continue

                if word in label:

                    return Action(
                        action="click",
                        selector=control.selector,
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

        candidate = context.action_candidates[0]

        return Action(
            action=candidate.action,
            selector=candidate.selector,
            value=candidate.value,
            url=candidate.url,
            x=candidate.x,
            y=candidate.y,
            amount=candidate.amount,
            requires_confirmation=(
                candidate.action == "navigate"
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
async def agent(request: AgentRequest):

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

    context = normalize_request(request)


    # --------------------------------------------------------
    # 2. Privacy validation
    # --------------------------------------------------------

    validate_context(context)


    # --------------------------------------------------------
    # 3. Plan action
    # --------------------------------------------------------

    action = local_planner(context)


    # --------------------------------------------------------
    # 4. Validate action
    # --------------------------------------------------------

    action = validate_action(action)


    # --------------------------------------------------------
    # 5. Return result
    # --------------------------------------------------------

    return AgentResponse(
        success=True,
        message="PrivAgent processed the sanitized page successfully.",
        action=action,
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


    validate_context(context)

    action = local_planner(context)

    action = validate_action(action)


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
        port=8000,
        reload=True,
    )
