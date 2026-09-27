function findElement(target) {
  if (!target) {
    return null;
  }

  const targetText = target.trim().toLowerCase();

  const elements = Array.from(
    document.querySelectorAll(
      "button, input, textarea, select, a"
    )
  );

  // 1. Find by ID
  const elementById = document.getElementById(target);

  if (elementById) {
    return elementById;
  }

  // 2. Find by visible text
  const elementByText = elements.find((element) => {
    const text = element.innerText?.trim().toLowerCase();

    return text === targetText;
  });

  if (elementByText) {
    return elementByText;
  }

  // 3. Find by placeholder
  const elementByPlaceholder = elements.find((element) => {
    const placeholder =
      element.placeholder?.trim().toLowerCase();

    return placeholder === targetText;
  });

  if (elementByPlaceholder) {
    return elementByPlaceholder;
  }

  // 4. Find input using its label
  const labels = Array.from(
    document.querySelectorAll("label")
  );

  const matchingLabel = labels.find((label) => {
    return (
      label.innerText?.trim().toLowerCase() ===
      targetText
    );
  });

  if (matchingLabel) {
    const inputId =
      matchingLabel.getAttribute("for");

    if (inputId) {
      const elementByLabel =
        document.getElementById(inputId);

      if (elementByLabel) {
        return elementByLabel;
      }
    }
  }

  // 5. Find by aria-label
  const elementByAriaLabel = elements.find((element) => {
    const ariaLabel =
      element
        .getAttribute("aria-label")
        ?.trim()
        .toLowerCase();

    return ariaLabel === targetText;
  });

  if (elementByAriaLabel) {
    return elementByAriaLabel;
  }

  return null;
}


async function executeAction(action) {

  if (!action || !action.action) {
    return {
      success: false,
      message: "Invalid action."
    };
  }


  switch (action.action) {

    case "click": {

      const element =
        findElement(action.target);

      if (!element) {
        return {
          success: false,
          message:
            `Element not found: ${action.target}`
        };
      }

      if (element.disabled) {
        return {
          success: false,
          message:
            `Element is disabled: ${action.target}`
        };
      }

      element.click();

      return {
        success: true,
        message:
          `Clicked: ${action.target}`
      };
    }


    case "type": {

      const element =
        findElement(action.target);

      if (!element) {
        return {
          success: false,
          message:
            `Input not found: ${action.target}`
        };
      }

      element.focus();

      element.value =
        action.value || "";

      element.dispatchEvent(
        new Event("input", {
          bubbles: true
        })
      );

      element.dispatchEvent(
        new Event("change", {
          bubbles: true
        })
      );

      return {
        success: true,
        message:
          `Typed into: ${action.target}`
      };
    }


    case "scroll": {

      const amount =
        Number(action.value) || 500;

      window.scrollBy({
        top: amount,
        behavior: "smooth"
      });

      return {
        success: true,
        message:
          `Scrolled by ${amount}px`
      };
    }


    case "navigate": {

      window.location.href =
        action.target;

      return {
        success: true,
        message:
          `Navigating to: ${action.target}`
      };
    }


    case "select": {

      const element =
        findElement(action.target);

      if (
        !element ||
        element.tagName.toLowerCase() !==
          "select"
      ) {
        return {
          success: false,
          message:
            `Select element not found: ${action.target}`
        };
      }

      element.value =
        action.value || "";

      element.dispatchEvent(
        new Event("change", {
          bubbles: true
        })
      );

      return {
        success: true,
        message:
          `Selected: ${action.value}`
      };
    }


    case "wait": {

      const duration =
        Number(action.value) || 1000;

      await new Promise((resolve) => {
        setTimeout(resolve, duration);
      });

      return {
        success: true,
        message:
          `Waited ${duration}ms`
      };
    }


    default: {

      return {
        success: false,
        message:
          `Unsupported action: ${action.action}`
      };
    }
  }
}


chrome.runtime.onMessage.addListener(
  (request, sender, sendResponse) => {

    if (
      request.type ===
      "EXECUTE_ACTION"
    ) {

      executeAction(request.action)
        .then((result) => {
          sendResponse(result);
        })
        .catch((error) => {
          sendResponse({
            success: false,
            message: error.message
          });
        });

      return true;
    }
  }
);