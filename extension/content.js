function isVisible(element) {
  const style = window.getComputedStyle(element);
  const rectangle = element.getBoundingClientRect();

  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.opacity !== "0" &&
    rectangle.width > 0 &&
    rectangle.height > 0
  );
}

function extractPageInformation() {
  const buttons = Array.from(document.querySelectorAll("button"))
    .filter(isVisible)
    .map((button) => ({
      text: button.innerText.trim(),
      id: button.id || null,
      disabled: button.disabled
    }));

  const inputs = Array.from(
    document.querySelectorAll("input, textarea, select")
  )
    .filter(isVisible)
    .map((element) => ({
      tag: element.tagName.toLowerCase(),
      type: element.type || null,
      id: element.id || null,
      name: element.name || null,
      placeholder: element.placeholder || null,
      ariaLabel: element.getAttribute("aria-label") || null,
      value: element.value || ""
    }));

  const links = Array.from(document.querySelectorAll("a"))
    .filter(isVisible)
    .map((link) => ({
      text: link.innerText.trim(),
      href: link.href
    }));

  const visibleText = document.body.innerText
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 3000);

  return {
    pageTitle: document.title,
    url: window.location.href,
    buttons,
    inputs,
    links,
    visibleText
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "EXTRACT_PAGE") {
    try {
      const pageInformation = extractPageInformation();
      sendResponse(pageInformation);
    } catch (error) {
      sendResponse({
        error: error.message
      });
    }
  }

  return true;
});
