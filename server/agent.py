"""
PrivAgent - Decision Agent

The agent receives ONLY sanitized browser context.
It does not access raw page content, passwords, cookies,
browser history, or other sensitive information.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Optional
import re


# -------------------------------------------------------------------
# Action model
# -------------------------------------------------------------------

@dataclass
class AgentAction:
    action: str
    selector: Optional[str] = None
    value: Optional[str] = None
    url: Optional[str] = None
    x: Optional[float] = None
    y: Optional[float] = None
    amount: Optional[float] = None
    requires_confirmation: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# -------------------------------------------------------------------
# Agent
# -------------------------------------------------------------------

class PrivAgent:
    """
    Privacy-preserving decision agent.

    Input:
        Sanitized browser context

    Output:
        A structured, validated action.
    """

    ALLOWED_ACTIONS = {
        "click",
        "type",
        "navigate",
        "scroll",
    }

    def __init__(self) -> None:
        self.name = "PrivAgent"
        self.version = "1.0.0"

    # ---------------------------------------------------------------
    # Public API
    # ---------------------------------------------------------------

    def process(self, context: Dict[str, Any]) -> AgentAction:
        """
        Process sanitized browser context and produce an action.
        """

        self._validate_context(context)

        goal = self._clean_text(context.get("goal", ""))

        visible_controls = context.get("visible_controls", [])
        safe_labels = context.get("safe_labels", [])
        action_candidates = context.get("action_candidates", [])

        if not goal:
            raise ValueError("Goal cannot be empty.")

        # First prefer explicitly supplied action candidates.
        action = self._use_action_candidate(
            goal,
            action_candidates,
        )

        if action is not None:
            return self._validate_action(action)

        # Next search visible controls.
        action = self._find_control_for_goal(
            goal,
            visible_controls,
            safe_labels,
        )

        if action is not None:
            return self._validate_action(action)

        # If no safe action can be determined, don't guess.
        raise ValueError(
            "No safe action could be determined from the "
            "sanitized context."
        )

    # ---------------------------------------------------------------
    # Context validation
    # ---------------------------------------------------------------

    def _validate_context(self, context: Dict[str, Any]) -> None:
        if not isinstance(context, dict):
            raise ValueError("Context must be a JSON object.")

        allowed_fields = {
            "goal",
            "visible_controls",
            "safe_labels",
            "redacted_regions",
            "action_candidates",
        }

        unknown_fields = set(context.keys()) - allowed_fields

        if unknown_fields:
            raise ValueError(
                f"Unsupported context fields: {sorted(unknown_fields)}"
            )

        for field in (
            "visible_controls",
            "safe_labels",
            "redacted_regions",
            "action_candidates",
        ):
            value = context.get(field, [])

            if not isinstance(value, list):
                raise ValueError(
                    f"{field} must be a list."
                )

    # ---------------------------------------------------------------
    # Candidate actions
    # ---------------------------------------------------------------

    def _use_action_candidate(
        self,
        goal: str,
        candidates: List[Dict[str, Any]],
    ) -> Optional[AgentAction]:

        for candidate in candidates:
            if not isinstance(candidate, dict):
                continue

            action_type = candidate.get("action")

            if action_type not in self.ALLOWED_ACTIONS:
                continue

            selector = candidate.get("selector")

            if action_type == "click" and selector:
                if self._goal_matches_click(goal):
                    return AgentAction(
                        action="click",
                        selector=selector,
                        requires_confirmation=False,
                    )

        return None

    # ---------------------------------------------------------------
    # Visible controls
    # ---------------------------------------------------------------

    def _find_control_for_goal(
        self,
        goal: str,
        visible_controls: List[Dict[str, Any]],
        safe_labels: List[Dict[str, Any]],
    ) -> Optional[AgentAction]:

        # -----------------------------------------------------------
        # Click actions
        # -----------------------------------------------------------

        if self._goal_matches_click(goal):

            control = self._find_matching_control(
                goal,
                visible_controls,
            )

            if control:
                selector = control.get("selector")

                if selector:
                    return AgentAction(
                        action="click",
                        selector=selector,
                        requires_confirmation=False,
                    )

            label = self._find_matching_safe_label(
                goal,
                safe_labels,
            )

            if label:
                selector = label.get("selector")

                if selector:
                    return AgentAction(
                        action="click",
                        selector=selector,
                        requires_confirmation=False,
                    )

        # -----------------------------------------------------------
        # Navigation
        # -----------------------------------------------------------

        if self._goal_matches_navigation(goal):

            url = self._extract_url(goal)

            if url:
                return AgentAction(
                    action="navigate",
                    url=url,
                    requires_confirmation=True,
                )

        return None

    # ---------------------------------------------------------------
    # Control matching
    # ---------------------------------------------------------------

    def _find_matching_control(
        self,
        goal: str,
        controls: List[Dict[str, Any]],
    ) -> Optional[Dict[str, Any]]:

        goal_words = self._keywords(goal)

        best_control = None
        best_score = 0

        for control in controls:

            if not isinstance(control, dict):
                continue

            if control.get("enabled") is False:
                continue

            label = self._clean_text(
                str(control.get("label", ""))
            )

            control_type = self._clean_text(
                str(control.get("type", ""))
            )

            if not label:
                continue

            label_words = self._keywords(label)

            score = len(goal_words & label_words)

            # Buttons are preferred for click requests.
            if control_type in {
                "button",
                "submit",
                "link",
            }:
                score += 1

            if score > best_score:
                best_score = score
                best_control = control

        return best_control if best_score > 0 else None

    def _find_matching_safe_label(
        self,
        goal: str,
        labels: List[Dict[str, Any]],
    ) -> Optional[Dict[str, Any]]:

        goal_words = self._keywords(goal)

        best_label = None
        best_score = 0

        for label in labels:

            if not isinstance(label, dict):
                continue

            text = self._clean_text(
                str(label.get("text", ""))
            )

            if not text:
                continue

            label_words = self._keywords(text)

            score = len(goal_words & label_words)

            if score > best_score:
                best_score = score
                best_label = label

        return best_label if best_score > 0 else None

    # ---------------------------------------------------------------
    # Goal interpretation
    # ---------------------------------------------------------------

    def _goal_matches_click(self, goal: str) -> bool:

        click_words = {
            "click",
            "press",
            "select",
            "tap",
            "submit",
            "open",
            "add",
            "buy",
        }

        return bool(
            self._keywords(goal) & click_words
        )

    def _goal_matches_navigation(self, goal: str) -> bool:

        navigation_words = {
            "navigate",
            "visit",
            "go",
            "open",
        }

        return bool(
            self._keywords(goal) & navigation_words
        )

    # ---------------------------------------------------------------
    # URL handling
    # ---------------------------------------------------------------

    def _extract_url(self, goal: str) -> Optional[str]:

        match = re.search(
            r"https?://[^\s]+",
            goal,
            re.IGNORECASE,
        )

        if not match:
            return None

        return match.group(0).rstrip(".,)")

    # ---------------------------------------------------------------
    # Utility functions
    # ---------------------------------------------------------------

    @staticmethod
    def _clean_text(value: str) -> str:
        return " ".join(value.strip().lower().split())

    @staticmethod
    def _keywords(value: str) -> set[str]:
        words = re.findall(
            r"[a-z0-9_-]+",
            value.lower(),
        )

        stop_words = {
            "the",
            "a",
            "an",
            "to",
            "on",
            "at",
            "please",
            "button",
        }

        return {
            word
            for word in words
            if word not in stop_words
        }

    # ---------------------------------------------------------------
    # Action validation
    # ---------------------------------------------------------------

    def _validate_action(
        self,
        action: AgentAction,
    ) -> AgentAction:

        if action.action not in self.ALLOWED_ACTIONS:
            raise ValueError(
                f"Unsupported action: {action.action}"
            )

        if action.action == "click":
            if not action.selector:
                raise ValueError(
                    "Click action requires a selector."
                )

        if action.action == "navigate":
            if not action.url:
                raise ValueError(
                    "Navigate action requires a URL."
                )

            if not action.url.startswith(
                ("http://", "https://")
            ):
                raise ValueError(
                    "Only HTTP/HTTPS URLs are allowed."
                )

        return action


# -------------------------------------------------------------------
# Convenience function
# -------------------------------------------------------------------

_agent = PrivAgent()


def run_agent(
    context: Dict[str, Any],
) -> Dict[str, Any]:

    action = _agent.process(context)

    return action.to_dict()
